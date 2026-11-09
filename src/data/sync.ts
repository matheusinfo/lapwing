/**
 * Optional sync of the local data with a Lapwing sync server (`sync/server.py`)
 * running on the same site, under `/api/sync/`.
 *
 * - Detection: at startup the app asks `GET /api/sync/status`. On a plain
 *   static host there is no such endpoint, sync stays off and nothing changes.
 * - Push: every local write (through `data/db.ts`) marks its keys in an outbox.
 *   The outbox is sent in batches; each record is read at send time, so a
 *   missing record means "deleted".
 * - Pull: the server numbers every change (`seq`). The app asks for what
 *   changed since its cursor, skipping its own changes, and applies it locally.
 *   A key still waiting in the outbox wins over the server copy (it is sent next).
 * - Conflicts: last writer wins, per record.
 * - Kept per device: the Strava login (`settings/strava`). Its tokens rotate on
 *   refresh, so two devices sharing them would log each other out.
 *
 * Sync state lives in localStorage under `lapwing-sync:`, outside the
 * `lapwing:` prefix on purpose: backups must not carry the device id or cursor.
 */
import {
  applyRemoteChanges,
  getMany,
  listKeys,
  setWriteHook,
  STORES,
  type RemoteChange,
  type StoreName,
} from './db';

export const SYNC_BASE = '/api/sync';
export const SYNC_APP = 'lapwing-sync';
export const SYNC_PROTOCOL = 1;

const LS_PREFIX = 'lapwing-sync:';
const DEVICE_KEY = `${LS_PREFIX}device`;
const CURSOR_KEY = `${LS_PREFIX}cursor`;
const EPOCH_KEY = `${LS_PREFIX}epoch`;
const OUTBOX_KEY = `${LS_PREFIX}outbox`;
const LAST_SYNC_KEY = `${LS_PREFIX}last`;

/** Records that never leave the device. */
export const LOCAL_ONLY: { store: StoreName; id: IDBValidKey }[] = [{ store: 'settings', id: 'strava' }];

/** Approximate size of one push request (the server accepts much more). */
const PUSH_BYTES = 2_000_000;
const PUSH_RECORDS = 200;
/** Keys read from IndexedDB at a time while building a push. */
const READ_CHUNK = 50;

export const isSyncable = (store: string, id: IDBValidKey): boolean =>
  (STORES as string[]).includes(store) && !LOCAL_ONLY.some((l) => l.store === store && l.id === id);

const outboxKey = (store: StoreName, id: IDBValidKey) => `${store}|${JSON.stringify(id)}`;
function parseOutboxKey(key: string): { store: StoreName; id: IDBValidKey } {
  const bar = key.indexOf('|');
  return { store: key.slice(0, bar) as StoreName, id: JSON.parse(key.slice(bar + 1)) as IDBValidKey };
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'offline' | 'auth';

export interface SyncStatus {
  state: SyncState;
  /** Epoch ms of the last complete sync, or null. */
  lastSync: number | null;
  /** Local changes not yet sent. */
  pending: number;
  /** Short technical detail of the last error. */
  error?: string;
}

/** The server redirected to a login page (e.g. an expired Cloudflare Access session). */
export class SyncAuthError extends Error {
  constructor() {
    super('Sign-in required');
    this.name = 'SyncAuthError';
  }
}

interface ServerStatus {
  app: string;
  protocol: number;
  epoch: string;
  seq: number;
}

interface ChangesPage {
  epoch: string;
  changes: { store: string; id: IDBValidKey; deleted: boolean; data?: { id: IDBValidKey } }[];
  next: number;
  more: boolean;
}

export interface SyncEngineOptions {
  fetch?: typeof fetch;
  storage?: Storage | null;
  base?: string;
  /** Gzip push bodies when the browser can (default: true). */
  compress?: boolean;
  now?: () => number;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function defaultStorage(): Storage {
  try {
    const s = globalThis.localStorage;
    s.getItem(DEVICE_KEY);
    return s;
  } catch {
    return memoryStorage();
  }
}

const newDeviceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

async function gzipBody(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

export class SyncEngine {
  private readonly fetchFn: typeof fetch;
  private readonly storage: Storage;
  private readonly base: string;
  private readonly compress: boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  /** key → version; a key is removed after a push only if its version didn't change meanwhile. */
  private outbox: Record<string, number>;
  private version = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  readonly device: string;
  status: SyncStatus;

  constructor(opts: SyncEngineOptions = {}) {
    this.fetchFn = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.storage = opts.storage === undefined ? defaultStorage() : (opts.storage ?? memoryStorage());
    this.base = opts.base ?? SYNC_BASE;
    this.compress = opts.compress ?? true;
    this.now = opts.now ?? Date.now;
    let device = this.storage.getItem(DEVICE_KEY);
    if (!device) {
      device = newDeviceId();
      this.storage.setItem(DEVICE_KEY, device);
    }
    this.device = device;
    this.outbox = this.loadOutbox();
    const last = Number(this.storage.getItem(LAST_SYNC_KEY));
    this.status = { state: 'off', lastSync: last > 0 ? last : null, pending: this.pendingCount() };
  }

  // ---- Status ----

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch, pending: this.pendingCount() };
    if (!('error' in patch) && patch.state && patch.state !== 'error') delete this.status.error;
    this.listeners.forEach((fn) => fn(this.status));
  }

  get enabled(): boolean {
    return this.status.state !== 'off';
  }

  // ---- Outbox ----

  private loadOutbox(): Record<string, number> {
    try {
      const raw = JSON.parse(this.storage.getItem(OUTBOX_KEY) ?? '{}') as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out: Record<string, number> = {};
        for (const k of Object.keys(raw)) out[k] = 0;
        return out;
      }
    } catch {
      // Corrupt outbox: start empty (the next full seed resends everything anyway).
    }
    return {};
  }

  /** Saves the outbox now (also called on page hide). */
  flush(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    try {
      this.storage.setItem(OUTBOX_KEY, JSON.stringify(this.outbox));
    } catch (err) {
      console.warn('Could not save the sync outbox:', err);
    }
  }

  private persistSoon(): void {
    if (this.persistTimer !== undefined) return;
    this.persistTimer = setTimeout(() => this.flush(), 250);
  }

  pendingCount(): number {
    return Object.keys(this.outbox).length;
  }

  /** Marks local writes to be sent (the db write hook). */
  record(store: StoreName, ids: IDBValidKey[]): void {
    let added = false;
    for (const id of ids) {
      if (!isSyncable(store, id)) continue;
      this.outbox[outboxKey(store, id)] = ++this.version;
      added = true;
    }
    if (!added) return;
    this.persistSoon();
    if (this.enabled) this.setStatus({});
  }

  /** Puts every local record in the outbox (first sync, or a reset server). */
  async seed(): Promise<void> {
    for (const store of STORES) {
      this.record(store, await listKeys(store));
    }
    this.flush();
  }

  // ---- HTTP ----

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(this.base + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new SyncAuthError();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Checks whether this site has a sync server. Turns sync on (and seeds the
   * outbox when the server is new to this device) if it does.
   */
  async probe(): Promise<boolean> {
    let status: ServerStatus;
    try {
      status = await this.request<ServerStatus>('/status');
    } catch (err) {
      if (err instanceof SyncAuthError) {
        this.setStatus({ state: 'auth' });
        return true;
      }
      // 404, an HTML page or no network: no sync on this site (or not now).
      return false;
    }
    if (status?.app !== SYNC_APP || typeof status.epoch !== 'string') return false;
    if (status.protocol !== SYNC_PROTOCOL) {
      this.setStatus({ state: 'error', error: `protocol ${status.protocol}` });
      return true;
    }
    if (this.storage.getItem(EPOCH_KEY) !== status.epoch) {
      // A server we haven't synced with (or one that was reset): send everything, read everything.
      await this.seed();
      this.storage.setItem(CURSOR_KEY, '0');
      this.storage.setItem(EPOCH_KEY, status.epoch);
    }
    this.setStatus({ state: 'idle' });
    return true;
  }

  // ---- Sync ----

  /** Pushes pending changes, then pulls everyone else's. Concurrent calls share one run. */
  sync(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          this.setStatus({ state: 'syncing' });
          // Never reached the server yet (e.g. the session had expired at startup).
          if (this.storage.getItem(EPOCH_KEY) === null) {
            if (!(await this.probe())) throw new Error('No sync server');
            if (this.status.state === 'auth') throw new SyncAuthError();
            this.setStatus({ state: 'syncing' });
          }
          await this.push();
          await this.pull();
        } while (this.again);
        const now = this.now();
        this.storage.setItem(LAST_SYNC_KEY, String(now));
        this.setStatus({ state: 'idle', lastSync: now });
      } catch (err) {
        if (err instanceof SyncAuthError) this.setStatus({ state: 'auth' });
        else if (typeof navigator !== 'undefined' && navigator.onLine === false) this.setStatus({ state: 'offline' });
        else this.setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) });
        throw err;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async push(): Promise<void> {
    const keys = Object.keys(this.outbox);
    let batch: { key: string; version: number; change: object }[] = [];
    let bytes = 0;

    const send = async () => {
      if (!batch.length) return;
      const text = JSON.stringify({ device: this.device, changes: batch.map((b) => b.change) });
      const gz = this.compress ? await gzipBody(text) : null;
      await this.request('/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) },
        body: gz ?? text,
      });
      for (const b of batch) if (this.outbox[b.key] === b.version) delete this.outbox[b.key];
      this.flush();
      this.setStatus({});
      batch = [];
      bytes = 0;
    };

    for (let i = 0; i < keys.length; i += READ_CHUNK) {
      const slice = keys.slice(i, i + READ_CHUNK).filter((k) => k in this.outbox);
      const byStore = new Map<StoreName, { key: string; id: IDBValidKey }[]>();
      for (const key of slice) {
        const { store, id } = parseOutboxKey(key);
        if (!(STORES as string[]).includes(store)) {
          delete this.outbox[key];
          continue;
        }
        byStore.set(store, [...(byStore.get(store) ?? []), { key, id }]);
      }
      for (const [store, items] of byStore) {
        const versions = items.map((it) => this.outbox[it.key]);
        const records = await getMany<{ id: IDBValidKey }>(store, items.map((it) => it.id));
        items.forEach((it, j) => {
          const data = records[j];
          const change = data ? { store, id: it.id, deleted: false, data } : { store, id: it.id, deleted: true };
          const size = data ? JSON.stringify(data).length : 64;
          batch.push({ key: it.key, version: versions[j], change });
          bytes += size;
        });
        if (bytes >= PUSH_BYTES || batch.length >= PUSH_RECORDS) await send();
      }
    }
    await send();
  }

  private async pull(): Promise<void> {
    let cursor = Number(this.storage.getItem(CURSOR_KEY)) || 0;
    for (;;) {
      const page = await this.request<ChangesPage>(
        `/changes?since=${cursor}&device=${encodeURIComponent(this.device)}`,
      );
      if (page.epoch !== this.storage.getItem(EPOCH_KEY)) {
        // The server was reset while we were running: resend everything, read from the start.
        await this.seed();
        this.storage.setItem(EPOCH_KEY, page.epoch);
        this.storage.setItem(CURSOR_KEY, '0');
        this.again = true;
        return;
      }
      const apply: RemoteChange[] = [];
      for (const c of page.changes) {
        if (!isSyncable(c.store, c.id)) continue;
        // A local edit not sent yet wins; it goes out on the next push.
        if (outboxKey(c.store as StoreName, c.id) in this.outbox) continue;
        apply.push({ store: c.store as StoreName, id: c.id, deleted: c.deleted, data: c.data });
      }
      await applyRemoteChanges(apply);
      cursor = page.next;
      this.storage.setItem(CURSOR_KEY, String(cursor));
      if (!page.more) break;
    }
  }
}

// ---- App wiring ----

let engine: SyncEngine | null = null;
const PULL_EVERY_MS = 60_000;
const PUSH_DELAY_MS = 2_000;
const RETRY_MS = 30_000;

/** The running engine, or null before `startSync()`. */
export const getSync = () => engine;

/**
 * Starts sync for the app: installs the write hook right away (so nothing
 * written during startup is missed), then probes the server. Without a
 * server the hook is removed and everything stays local.
 */
export async function startSync(opts: SyncEngineOptions = {}): Promise<SyncEngine | null> {
  if (engine) return engine;
  const e = new SyncEngine(opts);
  engine = e;
  setWriteHook((store, ids) => e.record(store, ids));

  if (!(await e.probe())) {
    setWriteHook(null);
    return e;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = undefined;
    e.sync().catch((err) => {
      if (!(err instanceof SyncAuthError)) timer = setTimeout(run, RETRY_MS);
    });
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(run, PUSH_DELAY_MS);
  };

  setWriteHook((store, ids) => {
    e.record(store, ids);
    soon();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
    else e.flush();
  });
  window.addEventListener('pagehide', () => e.flush());
  window.addEventListener('online', run);
  setInterval(() => {
    if (document.visibilityState === 'visible' && timer === undefined) run();
  }, PULL_EVERY_MS);
  run();
  return e;
}
