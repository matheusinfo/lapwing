/** Data model of the training screen (stores `plans` and `workouts`). */

export type WorkoutKind =
  | 'easy'
  | 'long'
  | 'tempo'
  | 'intervals'
  | 'recovery'
  | 'race'
  | 'rest'
  | 'cross';

export const WORKOUT_KINDS: WorkoutKind[] = [
  'easy',
  'long',
  'tempo',
  'intervals',
  'recovery',
  'race',
  'rest',
  'cross',
];

export type PlanGoal = '5k' | '10k' | 'half' | 'marathon' | 'other';
export const PLAN_GOALS: PlanGoal[] = ['5k', '10k', 'half', 'marathon', 'other'];

export interface TrainingPlan {
  id: string;
  name: string;
  goal: PlanGoal;
  /** Local date YYYY-MM-DD. */
  raceDate?: string;
  createdAt: number;
}

export interface PlannedWorkout {
  id: string;
  planId: string;
  /** Local date YYYY-MM-DD. */
  date: string;
  kind: WorkoutKind;
  /** May be empty: the kind's name is shown instead. */
  title: string;
  /** Target distance in metres. */
  distance?: number;
  /** Target duration in seconds. */
  duration?: number;
  /** Target pace in seconds per km. */
  pace?: number;
  description?: string;
  /** Manual override: done without a run (e.g. strength) or skipped. */
  status?: 'done' | 'skipped';
  /** Run linked by hand; wins over automatic matching. */
  linkedActivityId?: string;
  /** The user unlinked it: never match a run automatically. */
  unlinked?: boolean;
  /**
   * Structured workout (warm-up, blocks, recovery, cool-down). Optional: a
   * workout without steps is a single continuous run. When set, `distance`
   * and `duration` usually hold estimates derived from the steps.
   */
  steps?: WorkoutStep[];
}

// ---- Structured workouts ----

export type StepKind = 'warmup' | 'active' | 'recovery' | 'cooldown' | 'rest';
export const STEP_KINDS: StepKind[] = ['warmup', 'active', 'recovery', 'cooldown', 'rest'];

/** How long a step lasts: metres, seconds, or until the lap button is pressed. */
export type StepDuration =
  | { type: 'distance'; meters: number }
  | { type: 'time'; seconds: number }
  | { type: 'open' };

/**
 * Intensity target. Pace in seconds per km, `min` ≤ `max` (min is the faster
 * end). Heart rate as a zone 1–5 or a bpm range.
 */
export type StepTarget =
  | { type: 'pace'; min: number; max: number }
  | { type: 'hr'; zone: number }
  | { type: 'hr'; min: number; max: number };

export interface SimpleStep {
  type: 'step';
  id: string;
  kind: StepKind;
  duration: StepDuration;
  target?: StepTarget;
  note?: string;
}

/** A block of steps repeated `times` times (one nesting level). */
export interface RepeatStep {
  type: 'repeat';
  id: string;
  times: number;
  steps: SimpleStep[];
}

export type WorkoutStep = SimpleStep | RepeatStep;

/** A workout before it is saved into a plan. */
export type WorkoutDraft = Omit<PlannedWorkout, 'id' | 'planId'>;

export type WorkoutStatus = 'done' | 'partial' | 'missed' | 'upcoming' | 'rest' | 'skipped';
