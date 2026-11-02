import type { Activity } from '../../data/types';
import { addDays, diffDays, localDateOf, weekStart } from './dates';
import { manualDoneDistance, plannedDistance, type MatchResult } from './matching';
import type { PlannedWorkout, TrainingPlan } from './types';

export interface WeekVolume {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Metres planned (sum of workout targets). */
  planned: number;
  /** Metres run that week (all runs, matched or not, plus workouts marked done by hand without a run). */
  actual: number;
}

export interface PlanProgress {
  /** Workouts that count (not rest). */
  total: number;
  done: number;
  partial: number;
  missed: number;
  skipped: number;
  /** Share of all workouts completed (done + partial), 0–1. */
  completion: number;
  /** Share of workouts already due that were completed, 0–1; undefined if none due yet. */
  consistency?: number;
  /** Completed workouts in a row, counting back from the latest due one. */
  streak: number;
  plannedTotal: number;
  /** Metres run in matched workouts, plus planned metres of workouts marked done by hand without a run. */
  doneTotal: number;
  weeks: WeekVolume[];
  /** Days until the race (negative once it has passed). */
  daysToRace?: number;
}

const COMPLETED = new Set(['done', 'partial']);

export function computeProgress(
  plan: TrainingPlan,
  workouts: PlannedWorkout[],
  activities: Activity[],
  match: MatchResult,
  today: string,
  timeZone?: string,
): PlanProgress {
  const counted = workouts.filter((w) => w.kind !== 'rest').sort((a, b) => a.date.localeCompare(b.date));
  const results = counted.map((w) => match.byWorkout.get(w.id)!);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const done = count('done');
  const partial = count('partial');

  // Due = in the past, or already completed / skipped today or earlier.
  const due = results.filter(
    (r) => r.workout.date < today || (r.workout.date === today && r.status !== 'upcoming'),
  );
  const dueCompleted = due.filter((r) => COMPLETED.has(r.status)).length;

  let streak = 0;
  for (let i = due.length - 1; i >= 0; i--) {
    if (!COMPLETED.has(due[i].status)) break;
    streak++;
  }

  let weeks: WeekVolume[] = [];
  const dates = workouts.map((w) => w.date).sort();
  if (dates.length) {
    const first = weekStart(dates[0]);
    const last = weekStart(plan.raceDate && plan.raceDate > dates[dates.length - 1] ? plan.raceDate : dates[dates.length - 1]);
    const index = new Map<string, WeekVolume>();
    for (let d = first; d <= last; d = addDays(d, 7)) {
      const wk = { start: d, planned: 0, actual: 0 };
      weeks.push(wk);
      index.set(d, wk);
    }
    for (const w of counted) {
      const wk = index.get(weekStart(w.date));
      if (wk) wk.planned += plannedDistance(w) ?? 0;
    }
    for (const a of activities) {
      if (a.type !== 'run' && a.type !== 'trail-run') continue;
      const wk = index.get(weekStart(localDateOf(a.startTime, timeZone)));
      if (wk) wk.actual += a.summary.distance;
    }
    for (const r of results) {
      const wk = index.get(weekStart(r.workout.date));
      if (wk) wk.actual += manualDoneDistance(r);
    }
  } else {
    weeks = [];
  }

  return {
    total: counted.length,
    done,
    partial,
    missed: count('missed'),
    skipped: count('skipped'),
    completion: counted.length ? (done + partial) / counted.length : 0,
    consistency: due.length ? dueCompleted / due.length : undefined,
    streak,
    plannedTotal: counted.reduce((s, w) => s + (plannedDistance(w) ?? 0), 0),
    doneTotal: results.reduce(
      (s, r) => s + (r.activity && COMPLETED.has(r.status) ? r.activity.summary.distance : manualDoneDistance(r)),
      0,
    ),
    weeks,
    daysToRace: plan.raceDate ? diffDays(today, plan.raceDate) : undefined,
  };
}
