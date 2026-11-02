/**
 * Weekly and monthly goals (distance, moving time, number of runs).
 * Pure logic: no DOM, no database. All dates use the browser's local time;
 * weeks start on Monday, like the History screen.
 *
 * Goals are stored in the IndexedDB `goals` store with the `Goal` shape.
 */
import type { Activity, ActivityType } from '../../data/types';
import { addDays, startOfDay, startOfWeek } from '../history/aggregate';

export type GoalPeriod = 'week' | 'month';
export type GoalMetric = 'distance' | 'time' | 'runs';

export const GOAL_PERIODS: GoalPeriod[] = ['week', 'month'];
export const GOAL_METRICS: GoalMetric[] = ['distance', 'time', 'runs'];

/** Activity types a goal counts when it doesn't say otherwise. */
export const DEFAULT_GOAL_TYPES: ActivityType[] = ['run', 'trail-run'];

export interface Goal {
  id: string;
  period: GoalPeriod;
  metric: GoalMetric;
  /** Metres (distance), seconds of moving time (time) or a count (runs). */
  target: number;
  /** Activity types that count; defaults to DEFAULT_GOAL_TYPES. */
  activityTypes?: ActivityType[];
  createdAt: number;
}

export interface PeriodRange {
  /** Inclusive local midnight, ms. */
  start: number;
  /** Exclusive local midnight, ms. */
  end: number;
}

/** The week (Monday start) or calendar month containing `ms`. */
export function periodRange(period: GoalPeriod, ms: number): PeriodRange {
  if (period === 'week') {
    const start = startOfWeek(ms);
    return { start, end: addDays(start, 7) };
  }
  const d = new Date(ms);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

/** The period right before the one starting at `start`. */
export const previousRange = (period: GoalPeriod, range: PeriodRange): PeriodRange =>
  periodRange(period, range.start - 1);

/** Number of calendar days between two local midnights (DST-safe). */
export const daysBetween = (from: number, to: number) => Math.round((to - from) / 86_400_000);

/** True when the goal counts this activity. */
export function countsFor(goal: Goal, a: Activity): boolean {
  const types = goal.activityTypes?.length ? goal.activityTypes : DEFAULT_GOAL_TYPES;
  return types.includes(a.type);
}

const metricOf = (metric: GoalMetric, a: Activity) =>
  metric === 'distance' ? a.summary.distance : metric === 'time' ? a.summary.movingTime : 1;

/** Total of the goal's metric over the activities that count, inside `range`. */
export function goalValue(goal: Goal, activities: Activity[], range: PeriodRange): number {
  let total = 0;
  for (const a of activities) {
    if (a.startTime >= range.start && a.startTime < range.end && countsFor(goal, a)) {
      total += metricOf(goal.metric, a);
    }
  }
  return total;
}

export type GoalStatus = 'achieved' | 'on-track' | 'behind';

export interface GoalProgress extends PeriodRange {
  value: number;
  target: number;
  /** value / target × 100 (can exceed 100). */
  pct: number;
  /** What is still missing (0 once achieved). */
  remaining: number;
  /** Days in the period (7, or 28–31). */
  daysTotal: number;
  /** Days of the period so far, today included (1 on the first day). */
  daysElapsed: number;
  /** Days left, today included. */
  daysLeft: number;
  /** End-of-period value if the average per elapsed day continues. */
  projected: number;
  /** Remaining divided by the days left (today included); 0 once achieved. */
  perDayNeeded: number;
  /** Where a linear plan would be at the end of yesterday. */
  expectedByNow: number;
  status: GoalStatus;
}

/**
 * Progress of a goal in the period containing `now`.
 *
 * Status rule: `achieved` once value ≥ target; `on-track` when the value is
 * at least the pro-rata share of the target up to the end of yesterday
 * (so the first day of a period always starts on track), or when the
 * projection at the current rate reaches the target; otherwise `behind`.
 */
export function goalProgress(goal: Goal, activities: Activity[], now: number): GoalProgress {
  const range = periodRange(goal.period, now);
  const value = goalValue(goal, activities, range);
  const target = Math.max(goal.target, 0);
  const daysTotal = daysBetween(range.start, range.end);
  const daysElapsed = Math.min(daysTotal, daysBetween(range.start, startOfDay(now)) + 1);
  const daysLeft = daysTotal - daysElapsed + 1;
  const remaining = Math.max(0, target - value);
  const projected = (value / daysElapsed) * daysTotal;
  const expectedByNow = (target * (daysElapsed - 1)) / daysTotal;
  const status: GoalStatus =
    target > 0 && value >= target
      ? 'achieved'
      : value >= expectedByNow || projected >= target
        ? 'on-track'
        : 'behind';
  return {
    ...range,
    value,
    target,
    pct: target > 0 ? (value / target) * 100 : 0,
    remaining,
    daysTotal,
    daysElapsed,
    daysLeft,
    projected,
    perDayNeeded: remaining > 0 ? remaining / daysLeft : 0,
    expectedByNow,
    status,
  };
}

export interface GoalPeriodResult extends PeriodRange {
  value: number;
  hit: boolean;
  /** The period containing `now` (still running). */
  current: boolean;
}

/**
 * The last `n` periods, oldest first, ending with the current one. Periods
 * that ended before `since` (normally the first activity ever) are left out,
 * so a new user doesn't see a row of misses for weeks without data.
 */
export function goalHistory(
  goal: Goal,
  activities: Activity[],
  now: number,
  n = 8,
  since = -Infinity,
): GoalPeriodResult[] {
  const out: GoalPeriodResult[] = [];
  let range = periodRange(goal.period, now);
  for (let i = 0; i < n; i++) {
    if (i > 0 && range.end <= since) break;
    const value = goalValue(goal, activities, range);
    out.push({ ...range, value, hit: goal.target > 0 && value >= goal.target, current: i === 0 });
    range = previousRange(goal.period, range);
  }
  return out.reverse();
}

/**
 * Consecutive hit periods ending with the last completed one. The current
 * period adds to the streak once it's achieved, but doesn't break it while
 * it's still running.
 */
export function goalStreak(goal: Goal, activities: Activity[], now: number, maxPeriods = 520): number {
  if (goal.target <= 0) return 0;
  let range = periodRange(goal.period, now);
  let streak = goalValue(goal, activities, range) >= goal.target ? 1 : 0;
  const first = activities.reduce((min, a) => (countsFor(goal, a) ? Math.min(min, a.startTime) : min), Infinity);
  for (let i = 0; i < maxPeriods; i++) {
    range = previousRange(goal.period, range);
    if (range.end <= first) break;
    if (goalValue(goal, activities, range) < goal.target) break;
    streak++;
  }
  return streak;
}

/** Sorts goals for display: weekly before monthly, then distance, time, runs. */
export function sortGoals(goals: Goal[]): Goal[] {
  return [...goals].sort(
    (a, b) =>
      GOAL_PERIODS.indexOf(a.period) - GOAL_PERIODS.indexOf(b.period) ||
      GOAL_METRICS.indexOf(a.metric) - GOAL_METRICS.indexOf(b.metric) ||
      a.createdAt - b.createdAt,
  );
}

// ---- Form parsing (inputs use km / h:mm / count) ----

/** "42,5" / "42.5" km → metres; null when invalid. */
export function parseKm(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(v) && v > 0 && v < 100_000 ? Math.round(v * 1000) : null;
}

/** "5:30" (h:mm), "5h30", "5" or "5.5" hours → seconds; null when invalid. */
export function parseHours(text: string): number | null {
  const v = text.trim().toLowerCase().replace(',', '.');
  const hm = /^(\d{1,3})\s*[:h]\s*([0-5]?\d)?\s*m?$/.exec(v);
  if (hm) {
    const secs = Number(hm[1]) * 3600 + Number(hm[2] ?? 0) * 60;
    return secs > 0 ? secs : null;
  }
  const hours = Number(v);
  return v !== '' && Number.isFinite(hours) && hours > 0 && hours < 1000 ? Math.round(hours * 3600) : null;
}

/** Seconds → "h:mm" for the time input. */
export function hoursInput(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Whole number of runs ≥ 1; null when invalid. */
export function parseRuns(text: string): number | null {
  const v = Number(text.trim());
  return Number.isInteger(v) && v > 0 && v < 1000 ? v : null;
}

export function parseTarget(metric: GoalMetric, text: string): number | null {
  return metric === 'distance' ? parseKm(text) : metric === 'time' ? parseHours(text) : parseRuns(text);
}
