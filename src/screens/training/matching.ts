import type { Activity } from '../../data/types';
import { localDateOf } from './dates';
import { estimateSteps } from './structure';
import type { PlannedWorkout, WorkoutStatus, WorkoutStep } from './types';

/** A run that reaches less than this share of the target counts as partial. */
export const PARTIAL_THRESHOLD = 0.8;

const RUN_TYPES = new Set(['run', 'trail-run']);
const MATCHABLE_KINDS = new Set(['easy', 'long', 'tempo', 'intervals', 'recovery', 'race']);

export interface WorkoutResult {
  workout: PlannedWorkout;
  status: WorkoutStatus;
  activity?: Activity;
  /** True when the run was linked by hand. */
  manual: boolean;
}

export interface MatchResult {
  byWorkout: Map<string, WorkoutResult>;
  /** Activity id → workout id it was matched to. */
  byActivity: Map<string, string>;
  /** Runs not matched to any workout. */
  extras: Activity[];
}

/** Target distance in metres, estimated from structured steps or duration and pace when needed. */
export function plannedDistance(w: Pick<PlannedWorkout, 'distance' | 'duration' | 'pace'> & { steps?: WorkoutStep[] }): number | undefined {
  if (w.distance) return w.distance;
  if (w.steps?.length) {
    const d = estimateSteps(w.steps).distance;
    if (d > 0) return d;
  }
  if (w.duration && w.pace) return (w.duration / w.pace) * 1000;
  return undefined;
}

/**
 * Metres credited as run for a workout marked done by hand without a linked
 * run (e.g. a run not imported): its planned distance. 0 otherwise, and for
 * cross-training, which isn't running.
 */
export function manualDoneDistance(r: Pick<WorkoutResult, 'status' | 'activity' | 'workout'>): number {
  if (r.status !== 'done' || r.activity || r.workout.kind === 'cross') return 0;
  return plannedDistance(r.workout) ?? 0;
}

export function statusOf(w: PlannedWorkout, activity: Activity | undefined, today: string): WorkoutStatus {
  if (w.status === 'skipped') return 'skipped';
  if (w.kind === 'rest') return 'rest';
  if (activity) {
    const target = plannedDistance(w);
    if (target && activity.summary.distance < PARTIAL_THRESHOLD * target) return 'partial';
    if (!target && w.duration && activity.summary.movingTime < PARTIAL_THRESHOLD * w.duration) return 'partial';
    return 'done';
  }
  if (w.status === 'done') return 'done';
  return w.date < today ? 'missed' : 'upcoming';
}

/**
 * Pairs planned workouts with imported runs.
 *  1. Manual links win.
 *  2. Then, per day, each running workout takes the unused run whose distance
 *     is closest to its target (greedy over all pairs of that day).
 * Rest, cross-training, skipped and unlinked workouts never match automatically.
 */
export function matchWorkouts(
  workouts: PlannedWorkout[],
  activities: Activity[],
  today: string,
  timeZone?: string,
): MatchResult {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const used = new Set<string>();
  const matched = new Map<string, { activity: Activity; manual: boolean }>();

  for (const w of workouts) {
    const a = w.linkedActivityId ? byId.get(w.linkedActivityId) : undefined;
    if (a && !used.has(a.id)) {
      used.add(a.id);
      matched.set(w.id, { activity: a, manual: true });
    }
  }

  const runsByDate = new Map<string, Activity[]>();
  for (const a of activities) {
    if (used.has(a.id) || !RUN_TYPES.has(a.type)) continue;
    const d = localDateOf(a.startTime, timeZone);
    runsByDate.set(d, [...(runsByDate.get(d) ?? []), a]);
  }

  const candidatesByDate = new Map<string, PlannedWorkout[]>();
  for (const w of workouts) {
    // A manual link to a run that was deleted falls back to automatic matching.
    if (matched.has(w.id) || w.unlinked || w.status === 'skipped') continue;
    if (!MATCHABLE_KINDS.has(w.kind)) continue;
    candidatesByDate.set(w.date, [...(candidatesByDate.get(w.date) ?? []), w]);
  }

  for (const [date, ws] of candidatesByDate) {
    const runs = runsByDate.get(date);
    if (!runs?.length) continue;
    const pairs: { w: PlannedWorkout; a: Activity; cost: number }[] = [];
    for (const w of ws) {
      const target = plannedDistance(w);
      for (const a of runs) {
        pairs.push({ w, a, cost: target === undefined ? 0 : Math.abs(a.summary.distance - target) });
      }
    }
    pairs.sort((x, y) => x.cost - y.cost);
    for (const { w, a } of pairs) {
      if (matched.has(w.id) || used.has(a.id)) continue;
      used.add(a.id);
      matched.set(w.id, { activity: a, manual: false });
    }
  }

  const byWorkout = new Map<string, WorkoutResult>();
  const byActivity = new Map<string, string>();
  for (const w of workouts) {
    const m = matched.get(w.id);
    byWorkout.set(w.id, {
      workout: w,
      activity: m?.activity,
      manual: m?.manual ?? false,
      status: statusOf(w, m?.activity, today),
    });
    if (m) byActivity.set(m.activity.id, w.id);
  }
  const extras = activities.filter((a) => !used.has(a.id) && RUN_TYPES.has(a.type));
  return { byWorkout, byActivity, extras };
}
