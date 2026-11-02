/**
 * Race time predictions from best efforts. Pure logic: no DOM, no database.
 *
 * Sources ("efforts") are the best 1K/5K/10K/half-marathon segments found in
 * each run's track (computed by the History screen's `loadEfforts`), plus
 * each timed run as a whole (its distance and moving time), so long runs can
 * feed the half-marathon and marathon predictions.
 *
 * Prediction: Riegel, T2 = T1 × (D2 / D1)^1.06.
 *
 * Source choice for each target distance D:
 * 1. Only efforts of at least 3 km are used when any exist (short efforts
 *    overpredict endurance); otherwise shorter ones are used and the
 *    prediction is flagged `shortOnly`.
 * 2. Closeness is measured as |ln(D / d)|. Candidates within a factor of
 *    1.5 of the closest available distance are kept (|ln(D/d)| ≤ min +
 *    ln 1.5), so a well-matched distance always wins over a far one.
 * 3. Among those, the fastest prediction wins: a hard 8 km beats an easy
 *    10 km jog, but a 5K never predicts the marathon when a 25 km run exists.
 *
 * VDOT follows Jack Daniels' formulas; training paces use fixed fractions of
 * VDOT (E 62–70 %, T 88 %, I 97.5 %, R 107 %; M is the VDOT marathon time).
 */
import type { Activity } from '../../data/types';
import { EFFORT_DISTANCES, type Efforts } from '../history/aggregate';

export const RIEGEL_EXPONENT = 1.06;
export const HALF_MARATHON = 21097.5;
export const MARATHON = 42195;
export const RACE_DISTANCES = [5000, 10000, HALF_MARATHON, MARATHON] as const;
export type RaceDistance = (typeof RACE_DISTANCES)[number];

/** Efforts shorter than this make less reliable predictions. */
export const MIN_RELIABLE_DISTANCE = 3000;
/** Without a run this long in the window, marathon predictions are flagged. */
export const LONG_RUN_FOR_MARATHON = 25000;
/** Extrapolating further than this ratio is flagged. */
export const MAX_RELIABLE_RATIO = 4;
const CLOSENESS_TOLERANCE = Math.log(1.5);
/** Activity types used for predictions (trail terrain makes times incomparable). */
export const PREDICTION_TYPES = ['run'] as const;
export const DEFAULT_WINDOW_DAYS = 90;

export interface Effort {
  /** Metres. */
  distance: number;
  /** Seconds. */
  time: number;
  activity: Activity;
  /** True for a whole run, false for a best segment inside a run. */
  wholeRun: boolean;
}

export const riegel = (time: number, from: number, to: number, exponent = RIEGEL_EXPONENT) =>
  time * Math.pow(to / from, exponent);

/** Runs that can feed predictions: road runs with timestamps, started on or after `since`. */
export function predictionRuns(activities: Activity[], since = -Infinity): Activity[] {
  return activities.filter(
    (a) =>
      (PREDICTION_TYPES as readonly string[]).includes(a.type) &&
      a.summary.has.time &&
      a.summary.movingTime > 0 &&
      a.summary.distance > 0 &&
      a.startTime >= since,
  );
}

/** Every effort of the given runs: best segments from `efforts` plus whole runs. */
export function collectEfforts(runs: Activity[], efforts: Map<string, Efforts>): Effort[] {
  const out: Effort[] = [];
  for (const a of runs) {
    const e = efforts.get(a.id);
    if (e) {
      for (const d of EFFORT_DISTANCES) {
        const time = e[d];
        if (time !== undefined && time > 0) out.push({ distance: d, time, activity: a, wholeRun: false });
      }
    }
    // Whole runs below 1 km are noise (warm-ups, GPS glitches).
    if (a.summary.distance >= 1000) {
      out.push({ distance: a.summary.distance, time: a.summary.movingTime, activity: a, wholeRun: true });
    }
  }
  return out;
}

export type PredictionCaveat = 'noLongRun' | 'shortOnly' | 'farExtrapolation';

export interface Prediction {
  distance: RaceDistance;
  /** Seconds. */
  time: number;
  /** Seconds per km. */
  pace: number;
  source: Effort;
  caveats: PredictionCaveat[];
}

/** Picks the source effort for one target distance (see the rule at the top). */
export function chooseSource(target: number, efforts: Effort[]): Effort | undefined {
  const reliable = efforts.filter((e) => e.distance >= MIN_RELIABLE_DISTANCE);
  const pool = reliable.length ? reliable : efforts;
  if (!pool.length) return undefined;
  const gap = (e: Effort) => Math.abs(Math.log(target / e.distance));
  const closest = Math.min(...pool.map(gap));
  let best: Effort | undefined;
  let bestTime = Infinity;
  for (const e of pool) {
    if (gap(e) > closest + CLOSENESS_TOLERANCE + 1e-9) continue;
    const time = riegel(e.time, e.distance, target);
    if (time < bestTime) {
      bestTime = time;
      best = e;
    }
  }
  return best;
}

/**
 * Predictions for 5K, 10K, half and marathon. Empty when there are no
 * efforts (no timed runs).
 */
export function predictRaces(efforts: Effort[], runs: Activity[]): Prediction[] {
  if (!efforts.length) return [];
  const shortOnly = efforts.every((e) => e.distance < MIN_RELIABLE_DISTANCE);
  const longest = runs.reduce((max, a) => Math.max(max, a.summary.distance), 0);
  const out: Prediction[] = [];
  for (const distance of RACE_DISTANCES) {
    const source = chooseSource(distance, efforts);
    if (!source) continue;
    const time = riegel(source.time, source.distance, distance);
    const caveats: PredictionCaveat[] = [];
    if (distance === MARATHON && longest < LONG_RUN_FOR_MARATHON) caveats.push('noLongRun');
    if (shortOnly) caveats.push('shortOnly');
    if (distance / source.distance > MAX_RELIABLE_RATIO) caveats.push('farExtrapolation');
    out.push({ distance, time, pace: time / (distance / 1000), source, caveats });
  }
  return out;
}

// ---- VDOT (Jack Daniels & Jimmy Gilbert) ----

/** Oxygen cost (ml/kg/min) of running at `v` metres per minute. */
const vo2At = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;

/** Fraction of VO2max sustainable for `minutes`. */
const sustainable = (minutes: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);

/** VDOT of a performance (`distance` metres in `time` seconds). */
export function vdot(distance: number, time: number): number {
  const minutes = time / 60;
  return vo2At(distance / minutes) / sustainable(minutes);
}

/** Speed (m/min) whose oxygen cost is `vo2`. */
const speedForVo2 = (vo2: number) =>
  (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (4.6 + vo2))) / (2 * 0.000104);

/** Race time (s) at `distance` for a given VDOT, by bisection. */
export function vdotRaceTime(value: number, distance: number): number {
  // VDOT falls as the time grows, so search between very fast and very slow.
  let lo = distance / 600; // 36 km/h
  let hi = distance / 1.5; // 5.4 km/h
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distance, mid) > value) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Pace (s/km) at a fraction of VDOT. */
const paceAt = (value: number, fraction: number) => 60_000 / speedForVo2(value * fraction);

export interface TrainingPaces {
  /** Easy pace range, s/km: [slower, faster]. */
  easy: [number, number];
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
}

export function trainingPaces(value: number): TrainingPaces {
  return {
    easy: [paceAt(value, 0.62), paceAt(value, 0.7)],
    marathon: vdotRaceTime(value, MARATHON) / (MARATHON / 1000),
    threshold: paceAt(value, 0.88),
    interval: paceAt(value, 0.975),
    repetition: paceAt(value, 1.07),
  };
}

export interface VdotResult {
  value: number;
  source: Effort;
  paces: TrainingPaces;
}

/**
 * Highest VDOT among efforts of at least 3 km (shorter ones overstate it);
 * undefined when there are none.
 */
export function bestVdot(efforts: Effort[]): VdotResult | undefined {
  let best: VdotResult | undefined;
  for (const e of efforts) {
    if (e.distance < MIN_RELIABLE_DISTANCE) continue;
    const value = vdot(e.distance, e.time);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) best = { value, source: e, paces: trainingPaces(value) };
  }
  return best;
}
