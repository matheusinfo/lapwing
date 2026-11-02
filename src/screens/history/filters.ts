/**
 * Advanced run filters for the History table. Pure: no DOM, no database.
 *
 * Internal units: distances and elevation in metres, paces in seconds per km,
 * heart rate in bpm, dates as local "YYYY-MM-DD". The URL uses compact keys
 * with human-friendly units (distance in km) so links stay short and readable.
 */
import { parsePace } from '../../format';
import type { Activity, ActivityType } from '../../data/types';
import type { PlannedWorkout, TrainingPlan, WorkoutKind } from '../training/types';
import { matchWorkouts } from '../training/matching';
import { dayKey, searchByName } from './aggregate';

export const ACTIVITY_TYPES: ActivityType[] = ['run', 'trail-run', 'walk', 'other'];

/** Workout kinds a run can be matched to, plus runs with no planned workout. */
export type WorkoutFilter = Extract<WorkoutKind, 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'race'> | 'unplanned';
export const WORKOUT_FILTERS: WorkoutFilter[] = ['easy', 'long', 'tempo', 'intervals', 'recovery', 'race', 'unplanned'];

export interface RunFilters {
  /** Name search (case- and accent-insensitive). */
  query: string;
  /** Metres. */
  distanceMin?: number;
  distanceMax?: number;
  /** Seconds per km (lower = faster). */
  paceMin?: number;
  paceMax?: number;
  /** Elevation gain in metres. */
  elevationMin?: number;
  elevationMax?: number;
  /** Average heart rate in bpm. `hrMin: 0` alone means "has heart rate". */
  hrMin?: number;
  hrMax?: number;
  /** Empty = any type. */
  activityTypes: ActivityType[];
  /** Empty = any workout kind. */
  workoutKinds: WorkoutFilter[];
  /** Inclusive local dates "YYYY-MM-DD". */
  dateFrom?: string;
  dateTo?: string;
}

export interface FilterContext {
  /** Activity id → kind of the planned workout it was matched to. */
  kindOf?: Map<string, WorkoutKind>;
}

export const emptyFilters = (): RunFilters => ({ query: '', activityTypes: [], workoutKinds: [] });

/** Numeric range groups: filter fields and their URL keys. */
export const RANGE_GROUPS = [
  { id: 'distance', min: 'distanceMin', max: 'distanceMax', qMin: 'dmin', qMax: 'dmax' },
  { id: 'pace', min: 'paceMin', max: 'paceMax', qMin: 'pmin', qMax: 'pmax' },
  { id: 'elevation', min: 'elevationMin', max: 'elevationMax', qMin: 'emin', qMax: 'emax' },
  { id: 'hr', min: 'hrMin', max: 'hrMax', qMin: 'hmin', qMax: 'hmax' },
] as const;
export type RangeGroup = (typeof RANGE_GROUPS)[number]['id'];
type RangeField = (typeof RANGE_GROUPS)[number]['min' | 'max'];

/** Value of a metric for one run, or undefined when the run lacks it. */
export function metricOf(a: Activity, group: RangeGroup): number | undefined {
  const s = a.summary;
  switch (group) {
    case 'distance':
      return s.distance;
    case 'pace':
      return s.avgPace;
    case 'elevation':
      return s.has.ele ? s.elevationGain : undefined;
    case 'hr':
      return s.avgHr;
  }
}

const inRange = (v: number, min?: number, max?: number) => {
  // Accept reversed bounds (e.g. a pace typed fast-first or slow-first).
  const lo = min !== undefined && max !== undefined ? Math.min(min, max) : min;
  const hi = min !== undefined && max !== undefined ? Math.max(min, max) : max;
  return (lo === undefined || v >= lo) && (hi === undefined || v <= hi);
};

export const groupActive = (f: RunFilters, g: (typeof RANGE_GROUPS)[number]) =>
  f[g.min] !== undefined || f[g.max] !== undefined;

/** The workout-kind bucket of a run. */
export function workoutFilterOf(a: Activity, ctx: FilterContext): WorkoutFilter {
  const kind = ctx.kindOf?.get(a.id);
  return kind && (WORKOUT_FILTERS as string[]).includes(kind) ? (kind as WorkoutFilter) : 'unplanned';
}

/**
 * Runs passing every active filter. A run missing a metric (no HR, no
 * timestamps → no pace, no elevation data) is dropped only when that
 * metric's filter is active.
 */
export function applyFilters(activities: Activity[], f: RunFilters, ctx: FilterContext = {}): Activity[] {
  const groups = RANGE_GROUPS.filter((g) => groupActive(f, g));
  const types = f.activityTypes.length ? new Set(f.activityTypes) : null;
  const kinds = f.workoutKinds.length ? new Set(f.workoutKinds) : null;
  return searchByName(activities, f.query).filter((a) => {
    for (const g of groups) {
      const v = metricOf(a, g.id);
      if (v === undefined || !inRange(v, f[g.min], f[g.max])) return false;
    }
    if (types && !types.has(a.type)) return false;
    if (kinds && !kinds.has(workoutFilterOf(a, ctx))) return false;
    if (f.dateFrom || f.dateTo) {
      const day = dayKey(a.startTime);
      if (f.dateFrom && day < f.dateFrom) return false;
      if (f.dateTo && day > f.dateTo) return false;
    }
    return true;
  });
}

/** Number of active filter groups in the panel (the name search is not counted). */
export function activeFilterCount(f: RunFilters): number {
  let n = RANGE_GROUPS.filter((g) => groupActive(f, g)).length;
  if (f.activityTypes.length) n++;
  if (f.workoutKinds.length) n++;
  if (f.dateFrom || f.dateTo) n++;
  return n;
}

export const hasAnyFilter = (f: RunFilters) => activeFilterCount(f) > 0 || f.query.trim() !== '';

// ---- URL query ----

/** Keys this module writes; anything else in the query (e.g. `range`) is left alone. */
export const FILTER_KEYS = ['q', 'dmin', 'dmax', 'pmin', 'pmax', 'emin', 'emax', 'hmin', 'hmax', 't', 'k', 'from', 'to'];

const round = (v: number, digits: number) => String(Number(v.toFixed(digits)));

/** Compact query: distance in km, pace in s/km, elevation in m, HR in bpm. */
export function filtersToQuery(f: RunFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.query.trim()) p.set('q', f.query.trim());
  for (const g of RANGE_GROUPS) {
    for (const [field, key] of [[g.min, g.qMin], [g.max, g.qMax]] as const) {
      const v = f[field];
      if (v === undefined) continue;
      p.set(key, g.id === 'distance' ? round(v / 1000, 3) : round(v, 0));
    }
  }
  if (f.activityTypes.length) p.set('t', f.activityTypes.join(','));
  if (f.workoutKinds.length) p.set('k', f.workoutKinds.join(','));
  if (f.dateFrom) p.set('from', f.dateFrom);
  if (f.dateTo) p.set('to', f.dateTo);
  return p;
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Reads filters from a query, ignoring unknown or malformed values. */
export function filtersFromQuery(p: URLSearchParams): RunFilters {
  const f = emptyFilters();
  f.query = p.get('q') ?? '';
  for (const g of RANGE_GROUPS) {
    for (const [field, key] of [[g.min, g.qMin], [g.max, g.qMax]] as const) {
      const raw = p.get(key);
      if (raw === null || raw.trim() === '') continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) continue;
      (f as Record<RangeField, number | undefined>)[field] = g.id === 'distance' ? v * 1000 : v;
    }
  }
  const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] => {
    const parts = (raw ?? '').split(',');
    return allowed.filter((v) => parts.includes(v));
  };
  f.activityTypes = list(p.get('t'), ACTIVITY_TYPES);
  f.workoutKinds = list(p.get('k'), WORKOUT_FILTERS);
  const from = p.get('from'), to = p.get('to');
  if (isDate(from)) f.dateFrom = from;
  if (isDate(to)) f.dateTo = to;
  return f;
}

// ---- Form input parsing ----
// Each parser returns undefined for an empty field (no filter), null when the
// text is invalid, or the value in internal units.

const numberText = (text: string) => text.trim().replace(',', '.');

/** "15", "10,5" (km) → metres. */
export function parseKmInput(text: string): number | undefined | null {
  const v = numberText(text);
  if (v === '') return undefined;
  const km = Number(v);
  return Number.isFinite(km) && km >= 0 && km < 10_000 ? Math.round(km * 1000) : null;
}

/** "5:30" (or minutes, "5.5") → seconds per km. */
export function parsePaceInput(text: string): number | undefined | null {
  if (text.trim() === '') return undefined;
  return parsePace(text);
}

/** Whole non-negative number (metres of elevation, bpm). */
export function parseWholeInput(text: string, max = 100_000): number | undefined | null {
  const v = numberText(text);
  if (v === '') return undefined;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Math.round(Number(v));
  return n <= max ? n : null;
}

export function parseDateInput(text: string): string | undefined | null {
  const v = text.trim();
  if (v === '') return undefined;
  return isDate(v) ? v : null;
}

// ---- Workout kinds from training plans ----

/**
 * Maps each activity to the kind of the planned workout it matches, using the
 * training screen's matching per plan (as the training screen does). When a
 * run matches workouts in several plans, the oldest plan wins.
 */
export function workoutKindsByActivity(
  plans: TrainingPlan[],
  workouts: PlannedWorkout[],
  activities: Activity[],
  today: string,
): Map<string, WorkoutKind> {
  const out = new Map<string, WorkoutKind>();
  const ordered = [...plans].sort((a, b) => a.createdAt - b.createdAt);
  for (const plan of ordered) {
    const own = workouts.filter((w) => w.planId === plan.id);
    if (!own.length) continue;
    const byId = new Map(own.map((w) => [w.id, w]));
    for (const [activityId, workoutId] of matchWorkouts(own, activities, today).byActivity) {
      const w = byId.get(workoutId);
      if (w && !out.has(activityId)) out.set(activityId, w.kind);
    }
  }
  return out;
}
