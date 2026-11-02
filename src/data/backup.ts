/**
 * Backup and restore of all local data (IndexedDB stores plus the app's
 * localStorage keys) to a single JSON file, optionally gzip-compressed.
 *
 * File shape (format 1):
 *   { app: 'lapwing', format: 1, dbVersion, exportedAt (ISO), secrets,
 *     stores: { [store]: records[] }, localStorage: { [key]: value } }
 */
import { bulkWrite, get, readStores, SCHEMA_VERSION, STORES, type StoreName, type StoreWrite } from './db';

export const BACKUP_APP = 'lapwing';
/** Backups made before the app was renamed to Lapwing; restored like current ones. */
const LEGACY_BACKUP_APP = 'route-maker';
const LEGACY_LOCAL_STORAGE_PREFIX = 'route-maker:';
export const BACKUP_FORMAT = 1;
/** Only localStorage keys with this prefix are backed up and restored. */
export const LOCAL_STORAGE_PREFIX = 'lapwing:';

type BackupRecord = { id: string | number } & Record<string, unknown>;

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  dbVersion: number;
  /** ISO date-time of the export. */
  exportedAt: string;
  /** Whether sensitive fields (tokens, client secrets) were kept. */
  secrets: boolean;
  stores: Record<string, BackupRecord[]>;
  localStorage: Record<string, string>;
}

/** Records holding credentials; their listed fields are removed unless secrets are included. */
export const SENSITIVE_RECORDS: { store: StoreName; id: string; fields: string[] }[] = [
  { store: 'settings', id: 'strava', fields: ['clientSecret', 'accessToken', 'refreshToken'] },
];

export type BackupErrorCode = 'not-a-backup' | 'newer-format' | 'malformed' | 'no-gzip';

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'BackupError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isKnownStore = (name: string): name is StoreName => (STORES as string[]).includes(name);

// ---- Export ----

/** Copies of `stores` without the sensitive fields listed in SENSITIVE_RECORDS. */
export function stripSecrets<S extends Record<string, BackupRecord[]>>(stores: S): S {
  const out: Record<string, BackupRecord[]> = { ...stores };
  for (const { store, id, fields } of SENSITIVE_RECORDS) {
    const list = out[store];
    if (!list) continue;
    out[store] = list.map((r) => {
      if (r.id !== id) return r;
      const copy = { ...r };
      fields.forEach((f) => delete copy[f]);
      return copy;
    });
  }
  return out as S;
}

function readLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_STORAGE_PREFIX)) out[key] = localStorage.getItem(key) ?? '';
    }
  } catch {
    // Storage unavailable: back up the database only.
  }
  return out;
}

/** Reads every store (and the app's localStorage keys) into a backup object. */
export async function createBackup(opts: { includeSecrets?: boolean; now?: Date } = {}): Promise<BackupFile> {
  const includeSecrets = opts.includeSecrets ?? false;
  const raw = (await readStores(STORES)) as Record<StoreName, BackupRecord[]>;
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    dbVersion: SCHEMA_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    secrets: includeSecrets,
    stores: includeSecrets ? raw : stripSecrets(raw),
    localStorage: readLocalStorage(),
  };
}

export const compressionSupported = () => typeof CompressionStream !== 'undefined';
export const decompressionSupported = () => typeof DecompressionStream !== 'undefined';

/** The backup as a downloadable file body (gzip only when supported). */
export async function encodeBackup(backup: BackupFile, opts: { gzip?: boolean } = {}): Promise<Blob> {
  const json = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (!opts.gzip || !compressionSupported()) return json;
  const stream = json.stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  return new Blob([bytes], { type: 'application/gzip' });
}

/** `lapwing-backup-YYYY-MM-DD.json[.gz]`, in local time. */
export function backupFileName(date: Date, gzip = false): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `lapwing-backup-${day}.json${gzip ? '.gz' : ''}`;
}

// ---- Reading and validating ----

/** Whether the bytes start with the gzip magic number (1f 8b). */
export const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!decompressionSupported()) throw new BackupError('no-gzip');
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new BackupError('malformed', 'Corrupted gzip data');
  }
}

/**
 * Checks that `json` is a backup this version can restore and returns it
 * typed. Throws BackupError: `not-a-backup` (some other JSON), `newer-format`
 * (made by a newer app), `malformed` (a backup with broken content).
 */
export function validateBackup(json: unknown): BackupFile {
  if (!isObject(json) || (json.app !== BACKUP_APP && json.app !== LEGACY_BACKUP_APP)) {
    throw new BackupError('not-a-backup');
  }
  const { format, stores, localStorage: ls } = json;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    throw new BackupError('malformed', 'Missing or invalid format');
  }
  if (format > BACKUP_FORMAT) throw new BackupError('newer-format');
  if (!isObject(stores)) throw new BackupError('malformed', 'Missing stores');

  const cleanStores: Record<string, BackupRecord[]> = {};
  for (const [name, records] of Object.entries(stores)) {
    if (!Array.isArray(records)) throw new BackupError('malformed', `Store "${name}" is not a list`);
    if (isKnownStore(name)) {
      const bad = records.findIndex(
        (r) => !isObject(r) || !(typeof r.id === 'string' || (typeof r.id === 'number' && Number.isFinite(r.id))),
      );
      if (bad >= 0) throw new BackupError('malformed', `Record ${bad} of "${name}" has no id`);
    }
    cleanStores[name] = records as BackupRecord[];
  }

  const cleanLs: Record<string, string> = {};
  if (ls !== undefined) {
    if (!isObject(ls)) throw new BackupError('malformed', 'Invalid localStorage section');
    for (const [key, value] of Object.entries(ls)) {
      if (typeof value !== 'string') continue;
      if (key.startsWith(LOCAL_STORAGE_PREFIX)) cleanLs[key] = value;
      else if (key.startsWith(LEGACY_LOCAL_STORAGE_PREFIX)) {
        cleanLs[LOCAL_STORAGE_PREFIX + key.slice(LEGACY_LOCAL_STORAGE_PREFIX.length)] = value;
      }
    }
  }

  return {
    app: BACKUP_APP,
    format,
    dbVersion: typeof json.dbVersion === 'number' ? json.dbVersion : 0,
    exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '',
    secrets: json.secrets === true,
    stores: cleanStores,
    localStorage: cleanLs,
  };
}

/** Reads a `.json` or gzipped (`.json.gz`) backup file and validates it. */
export async function parseBackupFile(file: Blob): Promise<BackupFile> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BackupError('not-a-backup', 'Not JSON');
  }
  return validateBackup(json);
}

export interface BackupSummary {
  /** Records per known store. */
  counts: Record<StoreName, number>;
  /** Store names in the file this app does not know (ignored on restore). */
  unknownStores: string[];
  /** Export time in ms, or undefined when missing/invalid. */
  exportedAt?: number;
  /** Whether the file comes from a newer database schema. */
  newerSchema: boolean;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  const counts = Object.fromEntries(STORES.map((s) => [s, backup.stores[s]?.length ?? 0])) as Record<StoreName, number>;
  const time = Date.parse(backup.exportedAt);
  return {
    counts,
    unknownStores: Object.keys(backup.stores).filter((s) => !isKnownStore(s)),
    exportedAt: Number.isFinite(time) ? time : undefined,
    newerSchema: backup.dbVersion > SCHEMA_VERSION,
  };
}

// ---- Restore ----

export type RestoreMode = 'merge' | 'replace';

export interface RestorePlan {
  writes: StoreWrite[];
  /** Ignored store names. */
  ignored: string[];
  localStorage: Record<string, string>;
}

/**
 * What a restore writes. `current` gives this device's sensitive records, so
 * secrets missing from the file (exported without them) are kept instead of
 * being erased.
 */
export function planRestore(backup: BackupFile, current: Partial<Record<string, BackupRecord>> = {}): RestorePlan {
  const writes: StoreWrite[] = [];
  const ignored: string[] = [];
  for (const [name, records] of Object.entries(backup.stores)) {
    if (!isKnownStore(name)) {
      ignored.push(name);
      continue;
    }
    const list = records.map((r) => {
      const rule = SENSITIVE_RECORDS.find((s) => s.store === name && s.id === r.id);
      const existing = rule && current[`${rule.store}/${rule.id}`];
      if (!rule || !existing) return r;
      const merged = { ...r };
      for (const f of rule.fields) if (!(f in merged) && f in existing) merged[f] = existing[f];
      return merged;
    });
    writes.push({ store: name, records: list });
  }
  return { writes, ignored, localStorage: backup.localStorage };
}

export interface RestoreResult {
  counts: Partial<Record<StoreName, number>>;
  ignored: string[];
  /** Number of localStorage keys restored. */
  localStorage: number;
}

/**
 * Writes a validated backup. `merge` puts records by id (same id: the file
 * wins); `replace` first empties each store present in the file. All stores
 * are written in one transaction.
 */
export async function restoreBackup(backup: BackupFile, mode: RestoreMode): Promise<RestoreResult> {
  const current: Record<string, BackupRecord> = {};
  for (const { store, id } of SENSITIVE_RECORDS) {
    if (!backup.stores[store]) continue;
    const rec = await get<BackupRecord>(store, id);
    if (rec) current[`${store}/${id}`] = rec;
  }
  const plan = planRestore(backup, current);
  await bulkWrite(plan.writes, { replace: mode === 'replace' });

  let lsCount = 0;
  try {
    for (const [key, value] of Object.entries(plan.localStorage)) {
      localStorage.setItem(key, value);
      lsCount++;
    }
  } catch {
    // Storage unavailable: preferences are not essential.
  }
  return {
    counts: Object.fromEntries(plan.writes.map((w) => [w.store, w.records.length])),
    ignored: plan.ignored,
    localStorage: lsCount,
  };
}
