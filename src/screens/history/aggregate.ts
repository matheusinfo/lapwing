/**
 * Pure calculations for the History screen: periods, totals, weekly buckets,
 * fitness/fatigue, records and the calendar heatmap. No DOM, no database.
 * All dates use the browser's local time; weeks start on Monday.
 */
import type { Activity, AthleteSettings } from '../../data/types';
import { trimpFromSummary } from '../../data/metrics';

const DAY_MS = 86_400_000;

export type RangeId = '4w' | '12w' | 'year' | 'all';
export const RANGES: RangeId[] = ['4w', '12w', 'year', 'all'];

export interface Period {
  /** Inclusive start, ms. */
  start: number;
  /** Exclusive end, ms. */
  end: number;
}

// ---- Calendar helpers (local time, DST-safe) ----

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Adds whole calendar days (keeps local midnight across DST changes). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Local midnight of the Monday of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const day = startOfDay(ms);
  const weekday = (new Date(day).getDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

/** "YYYY-MM-DD" in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- Periods ----

/**
 * The period a range covers, ending at the end of today:
 * - 4w / 12w: whole weeks (Monday start), including the current week
 * - year: from 1 January
 * - all: from the first activity's day
 */
export function periodFor(range: RangeId, now: number, activities: Activity[]): Period {
  const end = addDays(startOfDay(now), 1);
  switch (range) {
    case '4w':
      return { start: addDays(startOfWeek(now), -7 * 3), end };
    case '12w':
      return { start: addDays(startOfWeek(now), -7 * 11), end };
    case 'year':
      return { start: new Date(new Date(now).getFullYear(), 0, 1).getTime(), end };
    case 'all': {
      const first = activities.reduce((min, a) => Math.min(min, a.startTime), Infinity);
      return { start: Number.isFinite(first) ? startOfDay(Math.min(first, now)) : startOfDay(now), end };
    }
  }
}

/** The period of the same length right before `p`, or null for "all". */
export function previousPeriod(range: RangeId, p: Period): Period | null {
  if (range === 'all') return null;
  return { start: p.start - (p.end - p.start), end: p.start };
}

export const inPeriod = (a: Activity, p: Period) => a.startTime >= p.start && a.startTime < p.end;

// ---- Totals ----

export interface Totals {
  runs: number;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
  elevationGain: number;
  /** Seconds per km over runs with timestamps; undefined when none. */
  avgPace?: number;
  /** Moving-time-weighted average heart rate; undefined when no run has HR. */
  avgHr?: number;
  /** Sum of training load (TRIMP); undefined when no run has HR. */
  load?: number;
}

export function loadOf(a: Activity, settings: AthleteSettings): number | undefined {
  return trimpFromSummary(a.summary, settings);
}

export function totals(activities: Activity[], settings: AthleteSettings): Totals {
  let distance = 0, movingTime = 0, elevationGain = 0;
  let timedDist = 0, timedTime = 0, hrSum = 0, hrTime = 0, load = 0, hasLoad = false;
  for (const a of activities) {
    const s = a.summary;
    distance += s.distance;
    movingTime += s.movingTime;
    elevationGain += s.elevationGain;
    if (s.has.time && s.movingTime > 0) {
      timedDist += s.distance;
      timedTime += s.movingTime;
    }
    if (s.avgHr !== undefined && s.movingTime > 0) {
      hrSum += s.avgHr * s.movingTime;
      hrTime += s.movingTime;
    }
    const l = loadOf(a, settings);
    if (l !== undefined) {
      load += l;
      hasLoad = true;
    }
  }
  return {
    runs: activities.length,
    distance,
    movingTime,
    elevationGain,
    avgPace: timedDist > 0 ? timedTime / (timedDist / 1000) : undefined,
    avgHr: hrTime > 0 ? hrSum / hrTime : undefined,
    load: hasLoad ? load : undefined,
  };
}

/** Relative change in percent, or undefined when there's nothing to compare. */
export function percentChange(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

// ---- Weekly volume ----

export interface WeekBucket {
  /** Monday 00:00 local, ms. */
  weekStart: number;
  distance: number;
  movingTime: number;
  runs: number;
}

/** One bucket per week from the week of `p.start` to the week before `p.end`, zeros included. */
export function weeklyBuckets(activities: Activity[], p: Period): WeekBucket[] {
  const buckets = new Map<number, WeekBucket>();
  const last = startOfWeek(p.end - 1);
  for (let w = startOfWeek(p.start); w <= last; w = addDays(w, 7)) {
    buckets.set(w, { weekStart: w, distance: 0, movingTime: 0, runs: 0 });
  }
  for (const a of activities) {
    if (!inPeriod(a, p)) continue;
    const b = buckets.get(startOfWeek(a.startTime));
    if (!b) continue;
    b.distance += a.summary.distance;
    b.movingTime += a.summary.movingTime;
    b.runs++;
  }
  return [...buckets.values()];
}

// ---- Pace trend ----

export interface PacePoint {
  time: number;
  pace: number;
  id: string;
  name: string;
}

/** Average pace of each timed run in the period, oldest first. */
export function pacePoints(activities: Activity[], p: Period): PacePoint[] {
  return activities
    .filter((a) => inPeriod(a, p) && a.summary.avgPace !== undefined && a.summary.distance >= 500)
    .sort((a, b) => a.startTime - b.startTime)
    .map((a) => ({ time: a.startTime, pace: a.summary.avgPace!, id: a.id, name: a.name }));
}

/** Centered moving average over `window` neighbouring values (shrinks at the edges). */
export function movingAverage(values: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const from = Math.max(0, i - half), to = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += values[j];
    return sum / (to - from);
  });
}

// ---- Fitness and fatigue ----

export interface LoadDay {
  /** Local midnight, ms. */
  day: number;
  load: number;
  /** 42-day exponentially weighted load (chronic). */
  fitness: number;
  /** 7-day exponentially weighted load (acute). */
  fatigue: number;
  /** fitness − fatigue. Positive = fresh, negative = tired. */
  form: number;
}

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

/**
 * Daily training load and its fitness/fatigue/form curves, from the first
 * activity up to `today` (inclusive). Uses every activity, regardless of the
 * period shown, so the curves are warmed up correctly.
 */
export function fitnessFatigue(activities: Activity[], settings: AthleteSettings, today: number): LoadDay[] {
  const daily = new Map<number, number>();
  for (const a of activities) {
    const l = loadOf(a, settings);
    if (l === undefined) continue;
    const d = startOfDay(a.startTime);
    daily.set(d, (daily.get(d) ?? 0) + l);
  }
  if (!daily.size) return [];

  const first = Math.min(...daily.keys());
  const last = startOfDay(today);
  const kFit = 1 - Math.exp(-1 / FITNESS_DAYS);
  const kFat = 1 - Math.exp(-1 / FATIGUE_DAYS);
  const out: LoadDay[] = [];
  let fitness = 0, fatigue = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const load = daily.get(d) ?? 0;
    fitness += (load - fitness) * kFit;
    fatigue += (load - fatigue) * kFat;
    out.push({ day: d, load, fitness, fatigue, form: fitness - fatigue });
  }
  return out;
}

// ---- Records ----

export const EFFORT_DISTANCES = [1000, 5000, 10000, 21097.5] as const;
export type EffortDistance = (typeof EFFORT_DISTANCES)[number];

/** Best time (s) per effort distance for one run; missing when the run is too short. */
export type Efforts = Partial<Record<EffortDistance, number>>;

export interface EffortRecord {
  distance: EffortDistance;
  time: number;
  activity: Activity;
}

/** Fastest effort per distance across runs. */
export function effortRecords(activities: Activity[], efforts: Map<string, Efforts>): EffortRecord[] {
  const out: EffortRecord[] = [];
  for (const distance of EFFORT_DISTANCES) {
    let best: EffortRecord | undefined;
    for (const a of activities) {
      const time = efforts.get(a.id)?.[distance];
      if (time !== undefined && (!best || time < best.time)) best = { distance, time, activity: a };
    }
    if (best) out.push(best);
  }
  return out;
}

export interface SummaryRecords {
  longest?: Activity;
  biggestClimb?: Activity;
  /** Fastest average pace among runs of 5 km or more. */
  fastestPace?: Activity;
}

export function summaryRecords(activities: Activity[]): SummaryRecords {
  const max = (list: Activity[], value: (a: Activity) => number) =>
    list.reduce<Activity | undefined>((best, a) => (!best || value(a) > value(best) ? a : best), undefined);
  const climbs = activities.filter((a) => a.summary.elevationGain > 0);
  const paced = activities.filter((a) => a.summary.distance >= 5000 && a.summary.avgPace !== undefined);
  return {
    longest: max(activities, (a) => a.summary.distance),
    biggestClimb: max(climbs, (a) => a.summary.elevationGain),
    fastestPace: max(paced, (a) => -a.summary.avgPace!),
  };
}

// ---- Calendar heatmap ----

export interface HeatCell {
  day: number;
  /** Metres run that day (0 = rest). */
  distance: number;
  runs: number;
  /** Day is after today (drawn empty). */
  future: boolean;
}

/**
 * Weeks × 7 days (Monday first) ending with the current week, covering
 * `p` but at least `minWeeks` and at most `maxWeeks` weeks.
 */
export function heatmap(activities: Activity[], p: Period, now: number, minWeeks = 12, maxWeeks = 53): HeatCell[][] {
  const lastWeek = startOfWeek(now);
  const periodWeeks = Math.round((lastWeek - startOfWeek(p.start)) / (7 * DAY_MS)) + 1;
  const weeks = Math.max(minWeeks, Math.min(maxWeeks, periodWeeks));
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));

  const byDay = new Map<number, { distance: number; runs: number }>();
  for (const a of activities) {
    const d = startOfDay(a.startTime);
    const cur = byDay.get(d) ?? { distance: 0, runs: 0 };
    cur.distance += a.summary.distance;
    cur.runs++;
    byDay.set(d, cur);
  }

  const today = startOfDay(now);
  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(firstWeek, w * 7 + i);
      const v = byDay.get(day);
      week.push({ day, distance: v?.distance ?? 0, runs: v?.runs ?? 0, future: day > today });
    }
    grid.push(week);
  }
  return grid;
}

/** Heatmap colour class 0–4 for a day's distance (0 = no run). */
export function heatLevel(distanceM: number): number {
  if (distanceM <= 0) return 0;
  const km = distanceM / 1000;
  if (km < 5) return 1;
  if (km < 10) return 2;
  if (km < 15) return 3;
  return 4;
}

// ---- Table: sort and search ----

export type SortKey =
  | 'date' | 'name' | 'type' | 'distance' | 'time' | 'pace' | 'hr' | 'elevation' | 'cadence' | 'load';

export function sortValue(a: Activity, key: SortKey, settings: AthleteSettings): number | string | undefined {
  const s = a.summary;
  switch (key) {
    case 'date': return a.startTime;
    case 'name': return a.name.toLocaleLowerCase();
    case 'type': return a.type;
    case 'distance': return s.distance;
    case 'time': return s.movingTime;
    case 'pace': return s.avgPace;
    case 'hr': return s.avgHr;
    case 'elevation': return s.elevationGain;
    case 'cadence': return s.avgCadence;
    case 'load': return loadOf(a, settings);
  }
}

/** Sorted copy. Missing values always go last, whatever the direction. */
export function sortActivities(
  list: Activity[],
  key: SortKey,
  dir: 'asc' | 'desc',
  settings: AthleteSettings,
): Activity[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key, settings), vb = sortValue(b, key, settings);
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
    return cmp * sign || b.startTime - a.startTime;
  });
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Case- and accent-insensitive name search. */
export function searchByName(list: Activity[], query: string): Activity[] {
  const q = fold(query.trim());
  return q ? list.filter((a) => fold(a.name).includes(q)) : list;
}
