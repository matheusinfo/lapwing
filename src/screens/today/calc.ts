/**
 * Everything the Today screen shows, computed from the stored data. Pure
 * logic: no DOM, no database. It reuses the rules of the other screens
 * (workout matching from Training, form from History, alerts and goals from
 * Insights), so the numbers here always match theirs.
 */
import type { Activity, AthleteSettings } from '../../data/types';
import { fitnessFatigue, FITNESS_DAYS } from '../history/aggregate';
import { goalProgress, sortGoals, type Goal, type GoalProgress } from '../insights/goals';
import { overloadReport, type OverloadAlert, type OverloadStats } from '../insights/overload';
import { pickActivePlan } from '../training/active-plan';
import { addDays, diffDays, localDateOf, weekStart } from '../training/dates';
import { manualDoneDistance, matchWorkouts, plannedDistance, type WorkoutResult } from '../training/matching';
import type { PlannedWorkout, TrainingPlan } from '../training/types';

/** How many workouts after today the "next workouts" list shows. */
export const UPCOMING_COUNT = 3;
/** Form above this is "fresh", below FORM_TIRED "tired" (same as History). */
export const FORM_FRESH = 5;
export const FORM_TIRED = -10;

const RUN_TYPES = new Set(['run', 'trail-run']);
const isRun = (a: Activity) => RUN_TYPES.has(a.type);

export interface WeekTotals {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Planned metres (workouts that aren't rest). */
  planned: number;
  /** Metres run this week (any run, plus workouts marked done by hand without a run). */
  run: number;
  /** Workouts done or partly done. */
  done: number;
  /** Workouts that aren't rest. */
  total: number;
}

export interface PlanDay {
  plan: TrainingPlan;
  /** Today's workouts (rest days included), with their status and run. */
  today: WorkoutResult[];
  /** The next workouts after today (no rest, nothing marked by hand), soonest first. */
  upcoming: PlannedWorkout[];
  week: WeekTotals;
  /** Days until the race; undefined without a race date or once it has passed. */
  daysToRace?: number;
  /** Activity id → the workout of this plan it counts for. */
  workoutOfRun: Map<string, PlannedWorkout>;
}

/** Today in the active plan, or undefined without plans. */
export function planDay(
  plans: TrainingPlan[],
  activePlanId: string | null,
  workouts: PlannedWorkout[],
  activities: Activity[],
  today: string,
): PlanDay | undefined {
  const plan = pickActivePlan(plans, activePlanId);
  if (!plan) return undefined;
  const planWorkouts = workouts.filter((w) => w.planId === plan.id).sort((a, b) => a.date.localeCompare(b.date));
  const match = matchWorkouts(planWorkouts, activities, today);
  const result = (w: PlannedWorkout) => match.byWorkout.get(w.id)!;

  const start = weekStart(today);
  const end = addDays(start, 6);
  const week: WeekTotals = { start, planned: 0, run: 0, done: 0, total: 0 };
  for (const w of planWorkouts) {
    if (w.date < start || w.date > end) continue;
    week.run += manualDoneDistance(result(w));
    if (w.kind === 'rest') continue;
    week.total++;
    week.planned += plannedDistance(w) ?? 0;
    const s = result(w).status;
    if (s === 'done' || s === 'partial') week.done++;
  }
  for (const a of activities) {
    const d = localDateOf(a.startTime);
    if (isRun(a) && d >= start && d <= end) week.run += a.summary.distance;
  }

  const byId = new Map(planWorkouts.map((w) => [w.id, w]));
  const workoutOfRun = new Map<string, PlannedWorkout>();
  for (const [activityId, workoutId] of match.byActivity) workoutOfRun.set(activityId, byId.get(workoutId)!);

  const daysToRace = plan.raceDate ? diffDays(today, plan.raceDate) : undefined;
  return {
    plan,
    today: planWorkouts.filter((w) => w.date === today).map(result),
    upcoming: planWorkouts.filter((w) => w.date > today && w.kind !== 'rest' && !w.status).slice(0, UPCOMING_COUNT),
    week,
    daysToRace: daysToRace !== undefined && daysToRace >= 0 ? daysToRace : undefined,
    workoutOfRun,
  };
}

export type FormState = 'fresh' | 'balanced' | 'tired';

export interface FormToday {
  /** Fitness − fatigue (TRIMP per day). */
  value: number;
  state: FormState;
}

export const formState = (form: number): FormState =>
  form > FORM_FRESH ? 'fresh' : form < FORM_TIRED ? 'tired' : 'balanced';

/**
 * Today's form (History's fitness − fatigue). Undefined without heart-rate
 * load in the last 42 days: an old value decays towards 0 and would read as
 * "balanced" when it really means "no data".
 */
export function formToday(activities: Activity[], settings: AthleteSettings, now: number): FormToday | undefined {
  const days = fitnessFatigue(activities, settings, now);
  if (!days.slice(-FITNESS_DAYS).some((d) => d.load > 0)) return undefined;
  const value = days[days.length - 1].form;
  return { value, state: formState(value) };
}

export interface Readiness {
  form?: FormToday;
  /** Overload alerts, most severe first. */
  alerts: OverloadAlert[];
  stats: OverloadStats;
  /** Some training in the last 8 weeks (otherwise the alerts say nothing). */
  hasTraining: boolean;
}

export function readiness(activities: Activity[], settings: AthleteSettings, now: number): Readiness {
  const report = overloadReport(activities, settings, now);
  return {
    form: formToday(activities, settings, now),
    alerts: report.alerts,
    stats: report.stats,
    hasTraining: report.days.some((d) => d.sessions > 0),
  };
}

export interface GoalToday {
  goal: Goal;
  progress: GoalProgress;
}

export const goalsToday = (goals: Goal[], activities: Activity[], now: number): GoalToday[] =>
  sortGoals(goals).map((goal) => ({ goal, progress: goalProgress(goal, activities, now) }));

/** The most recent run (road or trail) up to `now`. */
export function lastRun(activities: Activity[], now: number): Activity | undefined {
  let best: Activity | undefined;
  for (const a of activities) {
    if (isRun(a) && a.startTime <= now && (!best || a.startTime > best.startTime)) best = a;
  }
  return best;
}

/** Whole calendar days from the run's day to today (0 = today, 1 = yesterday). */
export const daysAgo = (a: Activity, today: string) => diffDays(localDateOf(a.startTime), today);

export type LoadLevel = 'easy' | 'moderate' | 'hard' | 'veryHard';

/** Same bands as the run report: < 50 easy, < 100 moderate, < 200 hard. */
export const loadLevel = (trimp: number): LoadLevel =>
  trimp < 50 ? 'easy' : trimp < 100 ? 'moderate' : trimp < 200 ? 'hard' : 'veryHard';
