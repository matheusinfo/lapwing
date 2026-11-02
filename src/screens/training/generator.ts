/**
 * Builds a whole training plan from a goal race and date. The rules are kept
 * simple and in data so they're easy to adjust:
 *  - distances grow linearly from the template's start to its peak;
 *  - every 4th build week is an easier (deload) week at 75 %;
 *  - the last 1–3 weeks taper down to the race.
 */
import { addDays, diffDays, weekday, weekStart } from './dates';
import { distance as dist, paceRange, repeatStep, simpleStep } from './structure';
import type { PlanGoal, WorkoutDraft, WorkoutKind } from './types';

export type GenGoal = Exclude<PlanGoal, 'other'>;

interface Template {
  /** Race distance, metres. */
  distance: number;
  /** Ideal plan length in weeks. */
  weeks: number;
  /** Week multipliers for the taper, the last one is race week. */
  taper: number[];
  /** Long run km at the start and at the peak. */
  long: [number, number];
  /** Continuous tempo km at the start and at the peak. */
  tempo: [number, number];
  /** Interval sets [reps, metres], from easiest to hardest. */
  intervals: [number, number][];
  /** Pace as a multiple of goal race pace. */
  pace: Record<'easy' | 'long' | 'recovery' | 'tempo' | 'intervals', number>;
}

export const TEMPLATES: Record<GenGoal, Template> = {
  '5k': {
    distance: 5000,
    weeks: 8,
    taper: [0.6],
    long: [5, 9],
    tempo: [2, 4],
    intervals: [[6, 400], [5, 600], [8, 400], [5, 800], [6, 800], [4, 1000]],
    pace: { easy: 1.25, long: 1.25, recovery: 1.35, tempo: 1.08, intervals: 0.97 },
  },
  '10k': {
    distance: 10000,
    weeks: 10,
    taper: [0.6],
    long: [7, 14],
    tempo: [3, 6],
    intervals: [[6, 800], [5, 1000], [8, 600], [6, 1000], [4, 1600], [3, 2000]],
    pace: { easy: 1.22, long: 1.2, recovery: 1.32, tempo: 1.03, intervals: 0.96 },
  },
  half: {
    distance: 21097,
    weeks: 12,
    taper: [0.75, 0.5],
    long: [10, 19],
    tempo: [4, 9],
    intervals: [[5, 1000], [4, 1600], [6, 1000], [3, 2000], [5, 1600], [3, 3000]],
    pace: { easy: 1.2, long: 1.15, recovery: 1.3, tempo: 0.98, intervals: 0.92 },
  },
  marathon: {
    distance: 42195,
    weeks: 16,
    taper: [0.8, 0.6, 0.45],
    long: [14, 32],
    tempo: [6, 14],
    intervals: [[5, 1000], [4, 1600], [6, 1000], [3, 2000], [5, 1600], [3, 3000]],
    pace: { easy: 1.15, long: 1.1, recovery: 1.25, tempo: 0.95, intervals: 0.88 },
  },
};

type Slot = 'quality' | 'intervals' | 'tempo' | 'easy' | 'recovery' | 'long';

/** Weekday (0 = Monday) → session, by runs per week. "quality" alternates intervals/tempo. */
const LAYOUTS: Record<3 | 4 | 5, [number, Slot][]> = {
  3: [[1, 'quality'], [3, 'easy'], [6, 'long']],
  4: [[1, 'quality'], [2, 'easy'], [4, 'easy'], [6, 'long']],
  5: [[1, 'intervals'], [2, 'easy'], [3, 'tempo'], [5, 'recovery'], [6, 'long']],
};

const DELOAD_FACTOR = 0.75;
const WARMUP_KM = 2;
const COOLDOWN_KM = 1.5;
const JOG_M = 400;
const MIN_RUN_KM = 3;

export type GenKey =
  | 'genEasyTitle' | 'genEasyDesc' | 'genEasyPaceDesc'
  | 'genLongTitle' | 'genLongDesc' | 'genLongPaceDesc'
  | 'genRecoveryTitle' | 'genRecoveryDesc'
  | 'genTempoTitle' | 'genTempoDesc' | 'genTempoPaceDesc'
  | 'genIntervalsTitle' | 'genIntervalsDesc' | 'genIntervalsPaceDesc'
  | 'genStridesTitle' | 'genStridesDesc'
  | 'genRaceTitle' | 'genRaceDesc';

/** Text for titles and descriptions; `pace` is seconds per km, `km` a number, `goal` the goal id. */
export type GenText = (key: GenKey, params?: { km?: number; pace?: number; reps?: number; meters?: number; goal?: GenGoal }) => string;

export interface GeneratorInput {
  goal: GenGoal;
  /** Race day, YYYY-MM-DD. */
  raceDate: string;
  runsPerWeek: 3 | 4 | 5;
  /** Goal finish time in seconds; enables target paces. */
  targetTime?: number;
  /** Today, YYYY-MM-DD. Days before it are left out. */
  today: string;
}

export type WeekPhase = 'build' | 'deload' | 'taper' | 'race';

export interface GeneratedPlan {
  workouts: WorkoutDraft[];
  weeks: { start: string; phase: WeekPhase }[];
  /** True when there wasn't time for the template's full length. */
  shortened: boolean;
  idealWeeks: number;
}

export type GeneratorError = 'raceInPast';

const roundKm = (km: number) => Math.max(MIN_RUN_KM, Math.round(km * 2) / 2);
const roundPace = (s: number) => Math.round(s / 5) * 5;

export function generatePlan(input: GeneratorInput, text: GenText): GeneratedPlan | GeneratorError {
  const tpl = TEMPLATES[input.goal];
  if (input.raceDate <= input.today) return 'raceInPast';

  const raceWeek = weekStart(input.raceDate);
  const available = diffDays(weekStart(input.today), raceWeek) / 7 + 1;
  const weeks = Math.min(tpl.weeks, available);
  const firstWeek = addDays(raceWeek, -(weeks - 1) * 7);
  const taperWeeks = Math.min(tpl.taper.length, Math.max(1, weeks - 1));
  const buildWeeks = weeks - taperWeeks;
  const racePace = input.targetTime ? input.targetTime / (tpl.distance / 1000) : undefined;
  const paceFor = (k: keyof Template['pace']) => (racePace ? roundPace(racePace * tpl.pace[k]) : undefined);
  const lerp = ([a, b]: [number, number], p: number) => a + (b - a) * p;

  const workouts: WorkoutDraft[] = [];
  const weekMeta: GeneratedPlan['weeks'] = [];
  let qualityToggle = 0;

  for (let w = 0; w < weeks; w++) {
    const start = addDays(firstWeek, w * 7);
    const inTaper = w >= buildWeeks;
    const isRaceWeek = w === weeks - 1;
    const deload = !inTaper && w > 0 && (w + 1) % 4 === 0 && w < buildWeeks - 1;
    const phase: WeekPhase = isRaceWeek ? 'race' : inTaper ? 'taper' : deload ? 'deload' : 'build';
    weekMeta.push({ start, phase });

    // Progress through the build (0 → 1); taper weeks scale the peak down.
    const p = inTaper ? 1 : buildWeeks > 1 ? w / (buildWeeks - 1) : 1;
    const factor = inTaper ? tpl.taper[tpl.taper.length - taperWeeks + (w - buildWeeks)] : deload ? DELOAD_FACTOR : 1;
    const longKm = lerp(tpl.long, p) * factor;
    const tempoKm = Math.max(1.5, Math.round(lerp(tpl.tempo, p) * factor * 2) / 2);
    const set = tpl.intervals[Math.min(tpl.intervals.length - 1, Math.floor(p * tpl.intervals.length))];
    const reps = Math.max(3, Math.round(set[0] * (deload || inTaper ? factor : 1)));

    for (const [day, slot] of LAYOUTS[input.runsPerWeek]) {
      const date = addDays(start, day);
      if (date < input.today) continue;
      if (isRaceWeek && date >= input.raceDate) continue;

      let kind: WorkoutKind;
      let draft: Omit<WorkoutDraft, 'date' | 'kind'>;
      const resolved: Slot = slot === 'quality' ? (qualityToggle++ % 2 === 0 ? 'intervals' : 'tempo') : slot;

      if (isRaceWeek) {
        // Race week: short easy runs with strides only.
        kind = 'easy';
        const km = roundKm(Math.min(longKm * 0.35, 6));
        draft = { title: text('genStridesTitle', { km }), distance: km * 1000, pace: paceFor('easy'), description: text('genStridesDesc') };
      } else if (resolved === 'long') {
        kind = 'long';
        const km = roundKm(longKm);
        const pace = paceFor('long');
        draft = {
          title: text('genLongTitle', { km }),
          distance: km * 1000,
          pace,
          description: text(pace ? 'genLongPaceDesc' : 'genLongDesc', { pace }),
          steps: [simpleStep('active', dist(km * 1000), pace ? paceRange(pace, 10) : undefined)],
        };
      } else if (resolved === 'easy' || resolved === 'recovery') {
        kind = resolved;
        const km = roundKm(longKm * (resolved === 'easy' ? 0.55 : 0.4));
        const pace = paceFor(resolved);
        draft = resolved === 'easy'
          ? { title: text('genEasyTitle', { km }), distance: km * 1000, pace, description: text(pace ? 'genEasyPaceDesc' : 'genEasyDesc', { pace }) }
          : { title: text('genRecoveryTitle', { km }), distance: km * 1000, pace, description: text('genRecoveryDesc') };
      } else if (resolved === 'tempo') {
        kind = 'tempo';
        const pace = paceFor('tempo');
        draft = {
          title: text('genTempoTitle', { km: tempoKm }),
          distance: (WARMUP_KM + tempoKm + COOLDOWN_KM) * 1000,
          description: text(pace ? 'genTempoPaceDesc' : 'genTempoDesc', { km: tempoKm, pace }),
          steps: [
            simpleStep('warmup', dist(WARMUP_KM * 1000)),
            simpleStep('active', dist(tempoKm * 1000), pace ? paceRange(pace) : undefined),
            simpleStep('cooldown', dist(COOLDOWN_KM * 1000)),
          ],
        };
      } else {
        kind = 'intervals';
        const pace = paceFor('intervals');
        const km = WARMUP_KM + COOLDOWN_KM + (reps * (set[1] + JOG_M)) / 1000;
        draft = {
          title: text('genIntervalsTitle', { reps, meters: set[1] }),
          distance: Math.round(km * 10) * 100,
          description: text(pace ? 'genIntervalsPaceDesc' : 'genIntervalsDesc', { reps, meters: set[1], pace }),
          steps: [
            simpleStep('warmup', dist(WARMUP_KM * 1000)),
            repeatStep(reps, [
              simpleStep('active', dist(set[1]), pace ? paceRange(pace) : undefined),
              simpleStep('recovery', dist(JOG_M)),
            ]),
            simpleStep('cooldown', dist(COOLDOWN_KM * 1000)),
          ],
        };
      }
      workouts.push({ date, kind, ...stripUndefined(draft) });
    }
  }

  workouts.push({
    date: input.raceDate,
    kind: 'race',
    title: text('genRaceTitle', { goal: input.goal }),
    distance: tpl.distance,
    duration: input.targetTime,
    pace: racePace ? Math.round(racePace) : undefined,
    description: text('genRaceDesc'),
  });
  workouts.sort((a, b) => a.date.localeCompare(b.date) || weekday(a.date) - weekday(b.date));

  return {
    workouts: workouts.map(stripUndefined),
    weeks: weekMeta,
    shortened: weeks < tpl.weeks,
    idealWeeks: tpl.weeks,
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
