/**
 * Calculations for comparing two runs side by side: summary deltas, best
 * efforts, per-km split differences, distance-aligned chart samples and the
 * time gap between the runs. Pure functions, no DOM, so they're easy to test.
 *
 * Convention: every delta is B − A, and "better"/"worse" describes run B
 * relative to run A.
 */
import { trimp } from '../../data/metrics';
import type { Activity, AthleteSettings, TrackPoint } from '../../data/types';
import {
  EFFORT_DISTANCES,
  bestEfforts,
  kmSplits,
  sampleByDistance,
  valueAt,
  type Sample,
  type Split,
  type Streams,
} from '../activity/calc';

/** Which direction is an improvement for a metric. */
export type Better = 'lower' | 'higher' | 'neutral';
export type Verdict = 'better' | 'worse' | 'same' | 'neutral';

export interface Delta {
  /** B − A. */
  diff: number;
  verdict: Verdict;
}

/**
 * B − A with a verdict. `tolerance` is the absolute difference treated as a
 * tie (e.g. 1 s/km for pace). Undefined when either value is missing.
 */
export function compareValues(a: number | undefined, b: number | undefined, better: Better, tolerance = 0): Delta | undefined {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  const diff = b - a;
  if (better === 'neutral') return { diff, verdict: 'neutral' };
  if (Math.abs(diff) <= tolerance) return { diff, verdict: 'same' };
  const improved = better === 'lower' ? diff < 0 : diff > 0;
  return { diff, verdict: improved ? 'better' : 'worse' };
}

/** Kind of value, so the screen knows how to format it. */
export type MetricKind = 'date' | 'distance' | 'duration' | 'pace' | 'meters' | 'bpm' | 'spm' | 'watts' | 'number';

export type MetricKey =
  | 'date'
  | 'distance'
  | 'movingTime'
  | 'elapsedTime'
  | 'avgPace'
  | 'bestKm'
  | 'elevGain'
  | 'elevLoss'
  | 'avgHr'
  | 'maxHr'
  | 'avgCad'
  | 'avgPower'
  | 'load'
  | 'rpe';

export type RunMetrics = Partial<Record<MetricKey, number>>;

interface MetricDef {
  key: MetricKey;
  kind: MetricKind;
  better: Better;
  tolerance?: number;
}

/**
 * Rows of the summary table, in order. Only pace-like metrics get a
 * better/worse verdict: a longer, hillier or higher-HR run is not
 * inherently better or worse.
 */
export const METRICS: MetricDef[] = [
  { key: 'date', kind: 'date', better: 'neutral' },
  { key: 'distance', kind: 'distance', better: 'neutral' },
  { key: 'movingTime', kind: 'duration', better: 'neutral' },
  { key: 'elapsedTime', kind: 'duration', better: 'neutral' },
  { key: 'avgPace', kind: 'pace', better: 'lower', tolerance: 0.5 },
  { key: 'bestKm', kind: 'pace', better: 'lower', tolerance: 0.5 },
  { key: 'elevGain', kind: 'meters', better: 'neutral' },
  { key: 'elevLoss', kind: 'meters', better: 'neutral' },
  { key: 'avgHr', kind: 'bpm', better: 'neutral' },
  { key: 'maxHr', kind: 'bpm', better: 'neutral' },
  { key: 'avgCad', kind: 'spm', better: 'neutral' },
  { key: 'avgPower', kind: 'watts', better: 'neutral' },
  { key: 'load', kind: 'number', better: 'neutral' },
  { key: 'rpe', kind: 'number', better: 'neutral' },
];

/** The headline numbers of one run, ready for the summary table. */
export function runMetrics(activity: Activity, points: TrackPoint[], settings: AthleteSettings): RunMetrics {
  const s = activity.summary;
  const m: RunMetrics = { distance: s.distance };
  if (activity.hasStartTime) m.date = activity.startTime;
  if (s.has.time) {
    m.movingTime = s.movingTime;
    m.elapsedTime = s.elapsedTime;
    m.avgPace = s.avgPace;
    m.bestKm = s.bestPace;
  }
  if (s.has.ele) {
    m.elevGain = s.elevationGain;
    m.elevLoss = s.elevationLoss;
  }
  if (s.has.hr) {
    m.avgHr = s.avgHr;
    m.maxHr = s.maxHr;
    m.load = trimp(points, settings);
  }
  if (s.has.cad) m.avgCad = s.avgCadence;
  if (s.has.power) m.avgPower = s.avgPower;
  if (activity.rpe !== undefined) m.rpe = activity.rpe;
  for (const k of Object.keys(m) as MetricKey[]) if (m[k] === undefined) delete m[k];
  return m;
}

export interface MetricRow {
  key: MetricKey;
  kind: MetricKind;
  a?: number;
  b?: number;
  delta?: Delta;
}

/** Summary rows where at least one run has a value. */
export function metricRows(a: RunMetrics, b: RunMetrics): MetricRow[] {
  return METRICS.filter((d) => a[d.key] !== undefined || b[d.key] !== undefined).map((d) => ({
    key: d.key,
    kind: d.kind,
    a: a[d.key],
    b: b[d.key],
    delta: compareValues(a[d.key], b[d.key], d.better, d.tolerance),
  }));
}

export type EffortKey = (typeof EFFORT_DISTANCES)[number]['key'];

export interface EffortRow {
  key: EffortKey;
  meters: number;
  /** Seconds. */
  a: number;
  b: number;
  delta: Delta;
}

/** Best efforts for the standard distances both runs cover (faster is better). */
export function effortRows(a: Streams, b: Streams): EffortRow[] {
  const ea = new Map(bestEfforts(a).map((e) => [e.key, e.time]));
  const eb = new Map(bestEfforts(b).map((e) => [e.key, e.time]));
  const rows: EffortRow[] = [];
  for (const e of EFFORT_DISTANCES) {
    const ta = ea.get(e.key), tb = eb.get(e.key);
    if (ta === undefined || tb === undefined) continue;
    rows.push({ key: e.key, meters: e.meters, a: ta, b: tb, delta: compareValues(ta, tb, 'lower', 0.5)! });
  }
  return rows;
}

export interface SplitRow {
  /** 1-based km number. */
  km: number;
  a?: Split;
  b?: Split;
  /** B − A pace for this km (s/km), when both have it. */
  paceDelta?: Delta;
}

/** Per-km splits of both runs side by side, as long as the longer run. */
export function splitRows(a: Split[], b: Split[]): SplitRow[] {
  const n = Math.max(a.length, b.length);
  const rows: SplitRow[] = [];
  for (let i = 0; i < n; i++) {
    const sa = a[i], sb = b[i];
    const row: SplitRow = { km: i + 1, a: sa, b: sb };
    const delta = compareValues(sa?.pace, sb?.pace, 'lower', 0.5);
    if (delta) row.paceDelta = delta;
    rows.push(row);
  }
  return rows;
}

/** Convenience: km splits of two runs, compared. */
export const compareSplits = (a: Streams, b: Streams) => splitRows(kmSplits(a), kmSplits(b));

/** A sample step for two runs that keeps charts around 300–600 points. */
export const sharedStep = (a: Streams, b: Streams) =>
  Math.max(20, Math.ceil(Math.max(a.total, b.total) / 500 / 10) * 10);

/**
 * Samples both runs on the same distance grid (index i is at i × step
 * metres in both), so overlay charts line up and tooltips show both runs at
 * the same distance. Pace is smoothed over `paceWindow` metres.
 */
export function alignedSamples(a: Streams, b: Streams, step = sharedStep(a, b), paceWindow = 250): { step: number; a: Sample[]; b: Sample[] } {
  return { step, a: sampleByDistance(a, step, paceWindow), b: sampleByDistance(b, step, paceWindow) };
}

export interface GapPoint {
  /** Distance in metres. */
  d: number;
  /**
   * Seconds run B is ahead of run A at this distance (moving time):
   * positive = B got here sooner, negative = B is behind.
   */
  ahead: number;
}

/**
 * How far ahead or behind run B is compared with run A at each distance,
 * from cumulative moving time, over the distance both runs cover. Empty if
 * either run has no timestamps.
 */
export function timeGap(a: Streams, b: Streams, step = sharedStep(a, b)): GapPoint[] {
  if (!a.hasTime || !b.hasTime || step <= 0) return [];
  const end = Math.min(a.total, b.total);
  const out: GapPoint[] = [];
  for (let d = 0; d <= end + 1e-6; d += step) {
    out.push({ d, ahead: valueAt(a.dist, a.moving, d) - valueAt(b.dist, b.moving, d) });
  }
  if (out.length && out[out.length - 1].d < end - 1e-6) {
    out.push({ d: end, ahead: valueAt(a.dist, a.moving, end) - valueAt(b.dist, b.moving, end) });
  }
  return out;
}

/**
 * Other runs closest in distance to `ref` (same activity type first), for
 * suggesting what to compare with. Excludes `ref` and any ids in `exclude`.
 */
export function similarRuns(activities: Activity[], ref: Activity, limit = 3, exclude: string[] = []): Activity[] {
  const skip = new Set([ref.id, ...exclude]);
  const target = ref.summary.distance;
  const score = (x: Activity) => {
    const rel = target > 0 ? Math.abs(x.summary.distance - target) / target : Math.abs(x.summary.distance);
    return rel + (x.type === ref.type ? 0 : 1);
  };
  return activities
    .filter((x) => !skip.has(x.id))
    .map((x) => ({ x, s: score(x) }))
    .sort((p, q) => p.s - q.s || q.x.startTime - p.x.startTime)
    .slice(0, limit)
    .map((p) => p.x);
}
