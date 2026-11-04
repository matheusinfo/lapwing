/**
 * Heart-rate and pace training zones (5 each). Pure logic: no DOM, no database.
 *
 * Zones are stored as the value where zones 2–5 start:
 * - heart rate in bpm, ascending: [159, 167, 177, 186] means Z1 ≤ 158,
 *   Z2 159–166, Z3 167–176, Z4 177–185, Z5 ≥ 186;
 * - pace in s/km, descending: [410, 375, 345, 315] means Z1 slower than 6:50,
 *   Z2 6:50–6:15, Z3 6:15–5:45, Z4 5:45–5:15, Z5 faster than 5:15.
 *
 * Calculated zones follow Joe Friel's run zones:
 * - heart rate from the lactate threshold heart rate (LTHR):
 *   Z2 from 85 %, Z3 from 90 %, Z4 from 95 %, Z5 from 100 %;
 * - pace from the threshold pace (T): Z2 from 129 %, Z3 from 114 %,
 *   Z4 from 106 %, Z5 from 100 % of T (as pace, so higher = slower).
 */
import type { AthleteSettings, TrackPoint } from './types';

export type ZoneStarts = [number, number, number, number];

export const HR_FROM_LTHR = [0.85, 0.9, 0.95, 1] as const;
export const PACE_FROM_THRESHOLD = [1.29, 1.14, 1.06, 1] as const;

/** Valid input ranges. */
export const HR_MIN = 30;
export const HR_MAX = 230;
export const PACE_MIN = 120; // 2:00 /km
export const PACE_MAX = 1200; // 20:00 /km

/** Heart rate where zones 2–5 start: the saved bpm, or the % of max HR. */
export function hrStarts(s: AthleteSettings): ZoneStarts {
  if (s.hrZoneStarts && validHrStarts(s.hrZoneStarts)) return [...s.hrZoneStarts];
  return s.hrZoneBounds.map((f) => Math.round(f * s.maxHr)) as ZoneStarts;
}

/** Pace where zones 2–5 start, or undefined when no pace zones are set. */
export function paceStarts(s: AthleteSettings): ZoneStarts | undefined {
  return s.paceZoneStarts && validPaceStarts(s.paceZoneStarts) ? [...s.paceZoneStarts] : undefined;
}

/** Zone index 0–4 for a heart rate. */
export function zoneOfHr(hr: number, starts: ZoneStarts): number {
  const v = Math.round(hr);
  let z = 0;
  for (const start of starts) if (v >= start) z++;
  return z;
}

/** Zone index 0–4 for a pace (s/km). A pace on a boundary belongs to the faster zone. */
export function zoneOfPace(pace: number, starts: ZoneStarts): number {
  let z = 0;
  for (const start of starts) if (pace <= start) z++;
  return z;
}

export const validHrStarts = (v: readonly number[]) =>
  v.length === 4 && v.every((x, i) => Number.isInteger(x) && x > HR_MIN && x <= HR_MAX && (i === 0 || x > v[i - 1]));

export const validPaceStarts = (v: readonly number[]) =>
  v.length === 4 && v.every((x, i) => Number.isFinite(x) && x >= PACE_MIN && x <= PACE_MAX && (i === 0 || x < v[i - 1]));

/** HR zones from the lactate threshold heart rate. */
export const hrZonesFromLthr = (lthr: number): ZoneStarts =>
  HR_FROM_LTHR.map((f) => Math.round(f * lthr)) as ZoneStarts;

/** Pace zones from the threshold pace, rounded to 5 s. */
export const paceZonesFromThreshold = (pace: number): ZoneStarts =>
  PACE_FROM_THRESHOLD.map((f) => Math.round((f * pace) / 5) * 5) as ZoneStarts;

// ---- Time in zones ----

/** Seconds spent in each pace zone, measured over `chunk`-metre pieces of the run (moving time). */
export function paceZoneSeconds(dist: number[], moving: number[], starts: ZoneStarts, chunk = 100): number[] {
  const out = [0, 0, 0, 0, 0];
  const total = dist[dist.length - 1] ?? 0;
  let i = 0;
  const timeAt = (x: number) => {
    while (i < dist.length - 2 && dist[i + 1] < x) i++;
    const d0 = dist[i], d1 = dist[i + 1] ?? d0;
    const f = d1 > d0 ? (x - d0) / (d1 - d0) : 0;
    return moving[i] + f * ((moving[i + 1] ?? moving[i]) - moving[i]);
  };
  let prevT = timeAt(0);
  for (let a = 0; a < total; a += chunk) {
    const b = Math.min(total, a + chunk);
    const t = timeAt(b);
    const dt = t - prevT;
    prevT = t;
    if (dt <= 0 || b - a < chunk / 2) continue;
    out[zoneOfPace(dt / ((b - a) / 1000), starts)] += dt;
  }
  return out;
}

// ---- Estimates from runs ----

/**
 * Highest average heart rate over `window` seconds of moving time, or
 * undefined when the run has less heart-rate time than that.
 */
export function bestWindowHr(points: TrackPoint[], moving: number[], window = 1800): number | undefined {
  // Prefix sums of hr × dt and dt over moving time.
  const n = points.length;
  const t = new Array<number>(n).fill(0);
  const area = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dt = Math.max(0, moving[i + 1] - moving[i]);
    const hr = points[i].hr;
    const ok = hr !== undefined && hr > HR_MIN && hr < HR_MAX + 20;
    t[i + 1] = t[i] + (ok ? dt : 0);
    area[i + 1] = area[i] + (ok ? hr! * dt : 0);
  }
  if (t[n - 1] < window) return undefined;
  let best = -Infinity;
  let a = 0;
  for (let b = 1; b < n; b++) {
    while (t[b] - t[a + 1] >= window) a++;
    if (t[b] - t[a] >= window) best = Math.max(best, (area[b] - area[a]) / (t[b] - t[a]));
  }
  return Number.isFinite(best) ? best : undefined;
}
