/**
 * Shoe storage helpers (store `shoes`) and pure mileage/wear statistics.
 * Importers call `defaultShoeId()` to tag new runs.
 */
import { get, getAll, listActivities, put, putMany, remove } from './db';
import type { Activity, ActivityType, Shoe } from './types';

const DAY = 86_400_000;

/** Default distance (m) at which a new shoe should be retired. */
export const DEFAULT_RETIRE_DISTANCE = 700_000;

/** Window used to estimate the recent rate of use for the retirement projection. */
export const RECENT_WINDOW_DAYS = 56;

/** Activity types that wear running shoes and get the default shoe on import. */
export const isRunType = (type: ActivityType) => type === 'run' || type === 'trail-run';

export const listShoes = () => getAll<Shoe>('shoes');

export const getShoe = (id: string) => get<Shoe>('shoes', id);

/** Id of the shoe marked as default (and not retired), if any. */
export async function defaultShoeId(): Promise<string | undefined> {
  const shoes = await listShoes();
  return shoes.find((s) => s.isDefault && !s.retiredAt)?.id;
}

/** Saves a shoe. When it is the default, any other default loses the flag (at most one default). */
export async function saveShoe(shoe: Shoe): Promise<void> {
  const value: Shoe = shoe.retiredAt ? { ...shoe, isDefault: false } : shoe;
  if (!value.isDefault) {
    await put('shoes', value);
    return;
  }
  const others = (await listShoes())
    .filter((s) => s.id !== value.id && s.isDefault)
    .map((s) => ({ ...s, isDefault: false }));
  await putMany('shoes', [...others, value]);
}

/** Makes `id` the only default shoe; `null` clears the default. */
export async function setDefaultShoe(id: string | null): Promise<void> {
  const shoes = await listShoes();
  const changed = shoes
    .filter((s) => (s.id === id ? !s.isDefault && !s.retiredAt : !!s.isDefault))
    .map((s) => ({ ...s, isDefault: s.id === id }));
  if (changed.length) await putMany('shoes', changed);
}

export async function retireShoe(id: string, at = Date.now()): Promise<void> {
  const shoe = await getShoe(id);
  if (shoe) await put('shoes', { ...shoe, retiredAt: at, isDefault: false });
}

export async function unretireShoe(id: string): Promise<void> {
  const shoe = await getShoe(id);
  if (!shoe) return;
  const { retiredAt: _r, ...rest } = shoe;
  await put('shoes', rest);
}

/** Sets (or clears, with `undefined`) the shoe of the given activities. Only summaries are written. */
export async function assignShoe(activities: Activity[], shoeId: string | undefined): Promise<number> {
  const changed = activities
    .filter((a) => a.shoeId !== shoeId)
    .map((a) => {
      const { shoeId: _s, ...rest } = a;
      return shoeId ? { ...rest, shoeId } : rest;
    });
  if (changed.length) await putMany('activities', changed);
  return changed.length;
}

/** Deletes a shoe and unassigns it from its activities. Returns how many activities were unassigned. */
export async function deleteShoe(id: string): Promise<number> {
  const used = (await listActivities()).filter((a) => a.shoeId === id);
  const count = await assignShoe(used, undefined);
  await remove('shoes', id);
  return count;
}

// ---- Statistics (pure) ----

export type ShoeStatus = 'ok' | 'worn' | 'replace' | 'retired';

export interface ShoeStats {
  /** startDistance + distance of every activity with this shoe, in metres. */
  distance: number;
  /** Distance logged in the app (without startDistance). */
  loggedDistance: number;
  runs: number;
  /** Seconds. */
  movingTime: number;
  firstUsed?: number;
  lastUsed?: number;
  /** distance / retireDistance (can exceed 1). */
  wear: number;
  status: ShoeStatus;
  /** Seconds per km over activities with timestamps. */
  avgPace?: number;
  /** Metres per day over the last RECENT_WINDOW_DAYS. */
  recentDailyDistance: number;
  /** Estimated epoch ms when the shoe reaches its retire distance at the recent rate. */
  projectedRetireAt?: number;
}

export function wearStatus(wear: number, retired = false): ShoeStatus {
  if (retired) return 'retired';
  if (wear > 1) return 'replace';
  if (wear >= 0.75) return 'worn';
  return 'ok';
}

export function shoeStats(shoe: Shoe, activities: Activity[], now = Date.now()): ShoeStats {
  const mine = activities.filter((a) => a.shoeId === shoe.id);
  let logged = 0;
  let movingTime = 0;
  let timedDistance = 0;
  let timedSeconds = 0;
  let recent = 0;
  let firstUsed: number | undefined;
  let lastUsed: number | undefined;
  const recentFrom = now - RECENT_WINDOW_DAYS * DAY;
  for (const a of mine) {
    const s = a.summary;
    logged += s.distance;
    movingTime += s.movingTime;
    if (s.has.time && s.movingTime > 0) {
      timedDistance += s.distance;
      timedSeconds += s.movingTime;
    }
    if (a.startTime >= recentFrom && a.startTime <= now) recent += s.distance;
    firstUsed = firstUsed === undefined ? a.startTime : Math.min(firstUsed, a.startTime);
    lastUsed = lastUsed === undefined ? a.startTime : Math.max(lastUsed, a.startTime);
  }
  const distance = (shoe.startDistance || 0) + logged;
  const wear = shoe.retireDistance > 0 ? distance / shoe.retireDistance : 0;
  const recentDailyDistance = recent / RECENT_WINDOW_DAYS;
  const remaining = shoe.retireDistance - distance;
  const projectedRetireAt =
    !shoe.retiredAt && remaining > 0 && recentDailyDistance > 0
      ? now + (remaining / recentDailyDistance) * DAY
      : undefined;
  return {
    distance,
    loggedDistance: logged,
    runs: mine.length,
    movingTime,
    firstUsed,
    lastUsed,
    wear,
    status: wearStatus(wear, !!shoe.retiredAt),
    avgPace: timedDistance > 0 ? timedSeconds / (timedDistance / 1000) : undefined,
    recentDailyDistance,
    projectedRetireAt,
  };
}

/** Local calendar day "YYYY-MM-DD" of a timestamp. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface AssignFilter {
  shoeId: string;
  /** Inclusive local dates "YYYY-MM-DD"; empty or missing means unbounded. */
  from?: string;
  to?: string;
  /** Skip runs that already have a (different) shoe. */
  onlyUnassigned: boolean;
}

/** Runs that a bulk "assign shoe to past runs" would change. */
export function assignCandidates(activities: Activity[], f: AssignFilter): Activity[] {
  return activities.filter((a) => {
    if (!isRunType(a.type) || a.shoeId === f.shoeId) return false;
    if (f.onlyUnassigned && a.shoeId) return false;
    const day = localDay(a.startTime);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}
