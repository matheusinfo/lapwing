/**
 * Overload alerts from volume, intensity and consecutive training days.
 * Pure logic: no DOM, no database. Days are local calendar days; "the last
 * 7 days" means today and the 6 days before it.
 *
 * Rules (all thresholds are exported below):
 * - Acute:chronic workload ratio (ACWR) = last 7 days ÷ (last 28 days ÷ 4),
 *   on distance and on training load (TRIMP from average HR; only when at
 *   least 75 % of the sessions in the last 28 days have HR).
 *   > 1.5 high, 1.3–1.5 caution, < 0.8 info (detraining). Needs 21+ days of
 *   history and a chronic average of at least 5 km/week (or 50 TRIMP/week).
 * - Weekly jump: last 7 days vs the average of the 3 weeks (days 8–28)
 *   before them. > 30 % high, > 10 % caution (the "10 % rule"). Ignored
 *   when the previous average is under 5 km or the increase is under 3 km.
 * - Consecutive training days (streak ending today or yesterday):
 *   ≥ 6 caution, ≥ 10 high. Otherwise, at most 1 rest day in the last 14
 *   days is a caution.
 * - Intensity (last 7 days): a session is hard when its average HR is in
 *   zone 4 or above, or its RPE is ≥ 8; when it has neither HR nor RPE, when
 *   its average pace is ≥ 8 % faster than the athlete's median pace (needs 5+
 *   runs in the last 90 days). ≥ 3 hard sessions caution, hard sessions on
 *   two consecutive days caution, hard share of moving time > 40 % caution
 *   (with at least 90 minutes of training).
 */
import { trimpFromSummary } from '../../data/metrics';
import type { Activity, ActivityType, AthleteSettings } from '../../data/types';
import { addDays, startOfDay } from '../history/aggregate';

/** Walks don't count as training for these alerts. */
export const TRAINING_TYPES: ActivityType[] = ['run', 'trail-run', 'other'];

export const ACWR_HIGH = 1.5;
export const ACWR_CAUTION = 1.3;
export const ACWR_LOW = 0.8;
export const MIN_HISTORY_DAYS = 21;
export const MIN_CHRONIC_KM = 5;
export const MIN_CHRONIC_LOAD = 50;
export const LOAD_HR_COVERAGE = 0.75;
export const JUMP_HIGH = 0.3;
export const JUMP_CAUTION = 0.1;
export const JUMP_MIN_BASE_KM = 5;
export const JUMP_MIN_INCREASE_KM = 3;
export const STREAK_CAUTION = 6;
export const STREAK_HIGH = 10;
export const MAX_REST_DAYS_14 = 1;
export const HARD_RPE = 8;
export const HARD_PACE_FACTOR = 0.92;
export const MEDIAN_MIN_RUNS = 5;
export const HARD_SESSIONS_CAUTION = 3;
export const HARD_SHARE_CAUTION = 0.4;
export const HARD_SHARE_MIN_TIME = 90 * 60;

export type Severity = 'info' | 'caution' | 'high';
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, caution: 1, high: 2 };

export type AlertKind =
  | 'acwrDistance'
  | 'acwrLoad'
  | 'detrainingDistance'
  | 'detrainingLoad'
  | 'weeklyJump'
  | 'streak'
  | 'fewRestDays'
  | 'hardSessions'
  | 'backToBackHard'
  | 'hardShare';

export interface OverloadAlert {
  kind: AlertKind;
  severity: Severity;
  /** The numbers behind the alert (units: metres, seconds, ratios 0–1+, counts). */
  data: Record<string, number>;
}

export interface DaySummary {
  /** Local midnight, ms. */
  day: number;
  distance: number;
  movingTime: number;
  /** Sum of TRIMP of the sessions with HR. */
  load: number;
  sessions: number;
  hard: number;
  hardTime: number;
}

export interface OverloadStats {
  /** Metres in the last 7 days. */
  acuteDistance: number;
  /** Average metres per week over the last 28 days. */
  chronicDistance: number;
  acwrDistance?: number;
  acuteLoad?: number;
  chronicLoad?: number;
  acwrLoad?: number;
  /** Average metres per week in days 8–28. */
  previousWeeksAvg: number;
  /** Relative change of the last 7 days vs previousWeeksAvg (0.1 = +10 %). */
  weeklyChange?: number;
  streak: number;
  restDays7: number;
  restDays14: number;
  hardSessions7: number;
  hardShare7?: number;
  /** Days since the first training session (Infinity-safe: 0 without data). */
  historyDays: number;
  /** Whether training load (TRIMP) is reliable enough to use. */
  loadReliable: boolean;
  /** Median pace used by the pace-based hard-session rule (s/km). */
  medianPace?: number;
}

export interface OverloadReport {
  alerts: OverloadAlert[];
  stats: OverloadStats;
  /** Last 56 days, oldest first (enough for 28-day rolling averages). */
  days: DaySummary[];
}

const isTraining = (a: Activity) => TRAINING_TYPES.includes(a.type);

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median average pace (s/km) of road and trail runs ≥ 3 km in the 90 days before `now`. */
export function medianPace(activities: Activity[], now: number): number | undefined {
  const since = addDays(startOfDay(now), -89);
  const paces = activities
    .filter(
      (a) =>
        (a.type === 'run' || a.type === 'trail-run') &&
        a.startTime >= since &&
        a.startTime <= now &&
        a.summary.distance >= 3000 &&
        a.summary.avgPace !== undefined,
    )
    .map((a) => a.summary.avgPace!);
  return paces.length >= MEDIAN_MIN_RUNS ? median(paces) : undefined;
}

export type HardReason = 'hr' | 'rpe' | 'pace';

/** Why a session counts as hard, or undefined when it doesn't. */
export function hardReason(a: Activity, settings: AthleteSettings, medPace?: number): HardReason | undefined {
  const s = a.summary;
  if (s.avgHr !== undefined && s.avgHr >= settings.hrZoneBounds[2] * settings.maxHr) return 'hr';
  if (a.rpe !== undefined && a.rpe >= HARD_RPE) return 'rpe';
  if (
    s.avgHr === undefined &&
    a.rpe === undefined &&
    medPace !== undefined &&
    s.avgPace !== undefined &&
    s.distance >= 1000 &&
    s.avgPace <= medPace * HARD_PACE_FACTOR
  ) {
    return 'pace';
  }
  return undefined;
}

/** Per-day totals for the `count` days ending today, oldest first. */
export function dailySummaries(
  activities: Activity[],
  settings: AthleteSettings,
  now: number,
  count = 56,
  medPace = medianPace(activities, now),
): DaySummary[] {
  const today = startOfDay(now);
  const first = addDays(today, -(count - 1));
  const end = addDays(today, 1);
  const byDay = new Map<number, DaySummary>();
  for (let i = 0; i < count; i++) {
    const day = addDays(first, i);
    byDay.set(day, { day, distance: 0, movingTime: 0, load: 0, sessions: 0, hard: 0, hardTime: 0 });
  }
  for (const a of activities) {
    if (!isTraining(a) || a.startTime < first || a.startTime >= end) continue;
    const d = byDay.get(startOfDay(a.startTime));
    if (!d) continue;
    d.distance += a.summary.distance;
    d.movingTime += a.summary.movingTime;
    d.load += trimpFromSummary(a.summary, settings) ?? 0;
    d.sessions++;
    if (hardReason(a, settings, medPace)) {
      d.hard++;
      d.hardTime += a.summary.movingTime;
    }
  }
  return [...byDay.values()];
}

/** Trailing average of `values` over `window` entries (shorter at the start). */
export function rollingMean(values: number[], window: number): number[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= window) sum -= values[i - window];
    return sum / Math.min(window, i + 1);
  });
}

/** Consecutive days with training ending today, or yesterday when today has none yet. */
export function trainingStreak(activities: Activity[], now: number): number {
  const days = new Set(activities.filter(isTraining).filter((a) => a.startTime <= now).map((a) => startOfDay(a.startTime)));
  let day = startOfDay(now);
  if (!days.has(day)) day = addDays(day, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

const sum = (list: DaySummary[], key: keyof DaySummary) => list.reduce((s, d) => s + (d[key] as number), 0);

function acwrSeverity(ratio: number): Severity | undefined {
  if (ratio > ACWR_HIGH) return 'high';
  if (ratio >= ACWR_CAUTION) return 'caution';
  return undefined;
}

/** Every alert for the situation at `now`, most severe first, plus the numbers behind them. */
export function overloadReport(activities: Activity[], settings: AthleteSettings, now: number): OverloadReport {
  const medPace = medianPace(activities, now);
  const days = dailySummaries(activities, settings, now, 56, medPace);
  const last7 = days.slice(-7);
  const last14 = days.slice(-14);
  const last28 = days.slice(-28);
  const prev21 = days.slice(-28, -7);

  const today = startOfDay(now);
  const firstTraining = activities.reduce(
    (min, a) => (isTraining(a) && a.startTime <= now ? Math.min(min, a.startTime) : min),
    Infinity,
  );
  const historyDays = Number.isFinite(firstTraining) ? Math.round((today - startOfDay(firstTraining)) / 86_400_000) + 1 : 0;
  const enoughHistory = historyDays >= MIN_HISTORY_DAYS;

  // Load is only trusted when most sessions in the last 28 days have HR.
  const start28 = last28[0].day;
  const sessions28 = activities.filter((a) => isTraining(a) && a.startTime >= start28 && a.startTime <= now);
  const withHr = sessions28.filter((a) => trimpFromSummary(a.summary, settings) !== undefined).length;
  const loadReliable = sessions28.length > 0 && withHr / sessions28.length >= LOAD_HR_COVERAGE;

  const acuteDistance = sum(last7, 'distance');
  const chronicDistance = sum(last28, 'distance') / 4;
  const acuteLoad = loadReliable ? sum(last7, 'load') : undefined;
  const chronicLoad = loadReliable ? sum(last28, 'load') / 4 : undefined;
  const acwrDistance =
    enoughHistory && chronicDistance >= MIN_CHRONIC_KM * 1000 ? acuteDistance / chronicDistance : undefined;
  const acwrLoad =
    enoughHistory && acuteLoad !== undefined && chronicLoad !== undefined && chronicLoad >= MIN_CHRONIC_LOAD
      ? acuteLoad / chronicLoad
      : undefined;
  const previousWeeksAvg = sum(prev21, 'distance') / 3;
  const weeklyChange = previousWeeksAvg > 0 ? acuteDistance / previousWeeksAvg - 1 : undefined;

  const streak = trainingStreak(activities, now);
  const restDays7 = last7.filter((d) => d.sessions === 0).length;
  const restDays14 = last14.filter((d) => d.sessions === 0).length;
  const hardSessions7 = sum(last7, 'hard');
  const time7 = sum(last7, 'movingTime');
  const hardShare7 = time7 > 0 ? sum(last7, 'hardTime') / time7 : undefined;

  const alerts: OverloadAlert[] = [];

  // ACWR and detraining.
  if (acwrDistance !== undefined) {
    const data = { ratio: acwrDistance, acute: acuteDistance, chronic: chronicDistance };
    const sev = acwrSeverity(acwrDistance);
    if (sev) alerts.push({ kind: 'acwrDistance', severity: sev, data });
    else if (acwrDistance < ACWR_LOW) alerts.push({ kind: 'detrainingDistance', severity: 'info', data });
  }
  if (acwrLoad !== undefined) {
    const data = { ratio: acwrLoad, acute: acuteLoad!, chronic: chronicLoad! };
    const sev = acwrSeverity(acwrLoad);
    if (sev) alerts.push({ kind: 'acwrLoad', severity: sev, data });
    else if (acwrLoad < ACWR_LOW && acwrDistance === undefined) {
      // Detraining is reported once; distance already covers it when available.
      alerts.push({ kind: 'detrainingLoad', severity: 'info', data });
    }
  }

  // Weekly jump (10 % rule).
  if (
    weeklyChange !== undefined &&
    previousWeeksAvg >= JUMP_MIN_BASE_KM * 1000 &&
    acuteDistance - previousWeeksAvg >= JUMP_MIN_INCREASE_KM * 1000
  ) {
    const severity: Severity | undefined =
      weeklyChange > JUMP_HIGH ? 'high' : weeklyChange > JUMP_CAUTION ? 'caution' : undefined;
    if (severity) {
      alerts.push({
        kind: 'weeklyJump',
        severity,
        data: { change: weeklyChange, current: acuteDistance, previous: previousWeeksAvg },
      });
    }
  }

  // Consecutive days and rest.
  if (streak >= STREAK_CAUTION) {
    alerts.push({
      kind: 'streak',
      severity: streak >= STREAK_HIGH ? 'high' : 'caution',
      data: { days: streak, restDays14 },
    });
  } else if (historyDays >= 14 && restDays14 <= MAX_REST_DAYS_14) {
    alerts.push({ kind: 'fewRestDays', severity: 'caution', data: { restDays14, restDays7 } });
  }

  // Intensity.
  if (hardSessions7 >= HARD_SESSIONS_CAUTION) {
    alerts.push({ kind: 'hardSessions', severity: 'caution', data: { count: hardSessions7, share: hardShare7 ?? 0 } });
  }
  const backToBack = last7.findIndex((d, i) => i > 0 && d.hard > 0 && last7[i - 1].hard > 0);
  if (backToBack > 0) {
    alerts.push({
      kind: 'backToBackHard',
      severity: 'caution',
      data: { firstDay: last7[backToBack - 1].day, secondDay: last7[backToBack].day },
    });
  }
  if (hardShare7 !== undefined && hardShare7 > HARD_SHARE_CAUTION && time7 >= HARD_SHARE_MIN_TIME) {
    alerts.push({ kind: 'hardShare', severity: 'caution', data: { share: hardShare7, hardTime: sum(last7, 'hardTime'), totalTime: time7 } });
  }

  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    alerts,
    days,
    stats: {
      acuteDistance,
      chronicDistance,
      acwrDistance,
      acuteLoad,
      chronicLoad,
      acwrLoad,
      previousWeeksAvg,
      weeklyChange,
      streak,
      restDays7,
      restDays14,
      hardSessions7,
      hardShare7,
      historyDays,
      loadReliable,
      medianPace: medPace,
    },
  };
}
