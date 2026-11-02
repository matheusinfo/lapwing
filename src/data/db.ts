/**
 * Local storage for the app, in IndexedDB (the browser's database), so large
 * activity files fit and everything stays on the user's device.
 *
 * Stores (all keyed by `id`):
 * - `activities`: Activity (summary only, cheap to list)
 * - `tracks`:     { id, points: TrackPoint[] } (same id as the activity)
 * - `plans`:      training plans (shape owned by the training screen)
 * - `workouts`:   planned workouts (shape owned by the training screen)
 * - `settings`:   { id: 'athlete', ...AthleteSettings }, plus other keyed
 *                  records such as { id: 'strava', ... }
 * - `shoes`:      Shoe
 * - `goals`:      distance/time/run-count goals (shape owned by the insights screen)
 */
import { DEFAULT_SETTINGS, type Activity, type AthleteSettings, type TrackPoint } from './types';

const DB_NAME = 'lapwing';
/** The database's name before the app was renamed to Lapwing; copied over once, then deleted. */
const LEGACY_DB_NAME = 'route-maker';
const DB_VERSION = 2;
export type StoreName = 'activities' | 'tracks' | 'plans' | 'workouts' | 'settings' | 'shoes' | 'goals';
/** Every store, e.g. for backups. New stores are created on upgrade (bump DB_VERSION). */
export const STORES: StoreName[] = ['activities', 'tracks', 'plans', 'workouts', 'settings', 'shoes', 'goals'];

let dbPromise: Promise<IDBDatabase> | null = null;

function openCurrent(): Promise<{ db: IDBDatabase; created: boolean }> {
  return new Promise((resolve, reject) => {
    let created = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      created = e.oldVersion === 0;
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve({ db: req.result, created });
    req.onerror = () => reject(req.error);
  });
}

/** Whether the pre-rename database exists (`indexedDB.databases()` where supported). */
async function legacyDbMayExist(created: boolean): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return created;
  try {
    return (await indexedDB.databases()).some((d) => d.name === LEGACY_DB_NAME);
  } catch {
    return created;
  }
}

/**
 * Copies every record from the pre-rename `route-maker` database into the
 * current one, then deletes the old database. If copying fails, the old
 * database is kept so no data is lost (and the copy is retried next time
 * where `indexedDB.databases()` is available).
 */
async function migrateLegacyDb(target: IDBDatabase): Promise<void> {
  let legacy: IDBDatabase;
  try {
    legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(LEGACY_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Could not open the old route-maker database:', err);
    return;
  }
  try {
    const names = [...legacy.objectStoreNames].filter((n) => target.objectStoreNames.contains(n));
    if (names.length) {
      const data = await new Promise<Map<string, unknown[]>>((resolve, reject) => {
        const t = legacy.transaction(names, 'readonly');
        const out = new Map<string, unknown[]>();
        for (const n of names) {
          const req = t.objectStore(n).getAll();
          req.onsuccess = () => out.set(n, req.result);
        }
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      await new Promise<void>((resolve, reject) => {
        const t = target.transaction(names, 'readwrite');
        for (const [n, records] of data) {
          const store = t.objectStore(n);
          records.forEach((r) => store.put(r));
        }
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    legacy.close();
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch (err) {
    legacy.close();
    console.warn('Could not copy data from the old route-maker database:', err);
  }
}

function open(): Promise<IDBDatabase> {
  dbPromise ??= openCurrent().then(async ({ db, created }) => {
    if (await legacyDbMayExist(created)) await migrateLegacyDb(db);
    return db;
  });
  return dbPromise;
}

const promisify = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await open();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const result = await run(t);
  await done;
  return result;
}

// ---- Change notifications (also across browser tabs) ----

const listeners = new Set<(store: StoreName) => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lapwing-db') : null;
channel?.addEventListener('message', (e) => listeners.forEach((fn) => fn(e.data as StoreName)));

function notify(store: StoreName): void {
  listeners.forEach((fn) => fn(store));
  channel?.postMessage(store);
}

/** Runs `fn` whenever data in a store changes. Returns a function that stops it. */
export function onDataChange(fn: (store: StoreName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- Generic access (for plans, workouts and any other store) ----

export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx([store], 'readonly', (t) => promisify(t.objectStore(store).getAll() as IDBRequest<T[]>));
}

export function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx([store], 'readonly', (t) => promisify(t.objectStore(store).get(id) as IDBRequest<T | undefined>));
}

export async function put<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  await tx([store], 'readwrite', (t) => promisify(t.objectStore(store).put(value)));
  notify(store);
}

export async function putMany<T extends { id: string }>(store: StoreName, values: T[]): Promise<void> {
  await tx([store], 'readwrite', (t) => {
    const s = t.objectStore(store);
    values.forEach((v) => s.put(v));
  });
  notify(store);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await tx([store], 'readwrite', (t) => promisify(t.objectStore(store).delete(id)));
  notify(store);
}

// ---- Activities ----

/** All activities, newest first. */
export async function listActivities(): Promise<Activity[]> {
  const all = await getAll<Activity>('activities');
  return all.sort((a, b) => b.startTime - a.startTime);
}

export const getActivity = (id: string) => get<Activity>('activities', id);

export async function getTrack(id: string): Promise<TrackPoint[]> {
  return (await get<{ id: string; points: TrackPoint[] }>('tracks', id))?.points ?? [];
}

export async function saveActivity(activity: Activity, points?: TrackPoint[]): Promise<void> {
  await tx(['activities', 'tracks'], 'readwrite', (t) => {
    t.objectStore('activities').put(activity);
    if (points) t.objectStore('tracks').put({ id: activity.id, points });
  });
  notify('activities');
}

export async function deleteActivity(id: string): Promise<void> {
  await tx(['activities', 'tracks'], 'readwrite', (t) => {
    t.objectStore('activities').delete(id);
    t.objectStore('tracks').delete(id);
  });
  notify('activities');
}

// ---- Athlete settings ----

export async function getSettings(): Promise<AthleteSettings> {
  const saved = await get<AthleteSettings & { id: string }>('settings', 'athlete');
  if (!saved) return { ...DEFAULT_SETTINGS };
  const { id: _id, ...rest } = saved;
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function saveSettings(settings: AthleteSettings): Promise<void> {
  await put('settings', { id: 'athlete', ...settings });
}

/** A random id for new records. */
export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---- Bulk access (backup and restore) ----

/** Schema version of the local database (stored in backups). */
export const SCHEMA_VERSION = DB_VERSION;

/** Every record of each store, read in one transaction (a consistent snapshot). */
export function readStores(stores: StoreName[]): Promise<Record<StoreName, unknown[]>> {
  return tx(stores, 'readonly', async (t) => {
    const lists = await Promise.all(stores.map((s) => promisify(t.objectStore(s).getAll())));
    return Object.fromEntries(stores.map((s, i) => [s, lists[i]])) as Record<StoreName, unknown[]>;
  });
}

/** Number of records in each store, without loading them. */
export function countStores(stores: StoreName[]): Promise<Record<StoreName, number>> {
  return tx(stores, 'readonly', async (t) => {
    const counts = await Promise.all(stores.map((s) => promisify(t.objectStore(s).count())));
    return Object.fromEntries(stores.map((s, i) => [s, counts[i]])) as Record<StoreName, number>;
  });
}

export interface StoreWrite {
  store: StoreName;
  records: { id: IDBValidKey }[];
}

/**
 * Writes many records to several stores in one transaction: all of it is
 * saved, or nothing. With `replace`, every store in `writes` is emptied first.
 * Notifies each affected store.
 */
export async function bulkWrite(writes: StoreWrite[], opts: { replace?: boolean } = {}): Promise<void> {
  const stores = [...new Set(writes.map((w) => w.store))];
  if (!stores.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new DOMException('Transaction aborted', 'AbortError'));
    try {
      if (opts.replace) stores.forEach((s) => t.objectStore(s).clear());
      for (const w of writes) {
        const s = t.objectStore(w.store);
        w.records.forEach((r) => s.put(r));
      }
    } catch (err) {
      reject(err);
      t.abort();
    }
  });
  stores.forEach(notify);
}

/** Deletes every record in the given stores (one transaction). */
export const clearStores = (stores: StoreName[]) =>
  bulkWrite(stores.map((store) => ({ store, records: [] })), { replace: true });
