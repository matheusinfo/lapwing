/**
 * Calculations for the run report: distance-based samples for charts,
 * km splits, fast-block (interval) detection and aerobic decoupling.
 * Pure functions, no DOM, so they're easy to test.
 */
import { bestEffort, cumulativeDistance, cumulativeMovingTime } from '../../data/analysis';
import type { TrackPoint } from '../../data/types';

export interface Streams {
  points: TrackPoint[];
  /** Cumulative distance (m) at each point. */
  dist: number[];
  /** Cumulative moving time (s) at each point; all zeros without timestamps. */
  moving: number[];
  /** Elevation at each point with gaps filled from neighbours, or null if none. */
  ele: number[] | null;
  total: number;
  hasTime: boolean;
}

export function buildStreams(points: TrackPoint[]): Streams {
  const dist = cumulativeDistance(points);
  const moving = cumulativeMovingTime(points, dist);
  let ele: number[] | null = null;
  if (points.some((p) => p.ele !== undefined)) {
    ele = new Array<number>(points.length);
    let last = points.find((p) => p.ele !== undefined)!.ele!;
    for (let i = 0; i < points.length; i++) {
      last = points[i].ele ?? last;
      ele[i] = last;
    }
  }
  return {
    points,
    dist,
    moving,
    ele,
    total: dist[dist.length - 1] ?? 0,
    hasTime: (moving[moving.length - 1] ?? 0) > 0,
  };
}

/** Index of the last point whose distance is <= x. */
export function indexAt(dist: number[], x: number): number {
  let lo = 0, hi = dist.length - 1;
  if (x <= dist[0]) return 0;
  if (x >= dist[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of `values` (aligned with `dist`) at distance x. */
export function valueAt(dist: number[], values: number[], x: number): number {
  const i = indexAt(dist, x);
  if (i >= dist.length - 1) return values[dist.length - 1];
  const span = dist[i + 1] - dist[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (x - dist[i]) / span)) : 0;
  return values[i] + f * (values[i + 1] - values[i]);
}

type NumKey = 'hr' | 'cad' | 'power' | 'temp';

/** Mean of a point field over points with distance in [a, b). */
export function meanInRange(s: Streams, key: NumKey, a: number, b: number): number | undefined {
  let sum = 0, n = 0;
  for (let i = indexAt(s.dist, a); i < s.points.length && s.dist[i] < b; i++) {
    if (s.dist[i] < a) continue;
    const v = s.points[i][key];
    if (v === undefined) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : undefined;
}

/** Moving time (s) between two distances. */
export const timeBetween = (s: Streams, a: number, b: number) =>
  valueAt(s.dist, s.moving, b) - valueAt(s.dist, s.moving, a);

export interface Sample {
  /** Distance in metres. */
  d: number;
  lat: number;
  lon: number;
  /** Seconds per km over a window centred here. */
  pace?: number;
  hr?: number;
  ele?: number;
  cad?: number;
  power?: number;
}

/**
 * Evenly spaced samples along the run, for charts and the coloured map.
 * Pace is measured over `paceWindow` metres centred on each sample, which
 * smooths GPS jitter.
 */
export function sampleByDistance(s: Streams, step = 50, paceWindow = 200): Sample[] {
  const out: Sample[] = [];
  if (s.total <= 0) return out;
  const half = step / 2;
  for (let d = 0; d <= s.total + 1e-6; d += step) {
    const i = indexAt(s.dist, d);
    const p = s.points[i];
    const sample: Sample = { d, lat: p.lat, lon: p.lon };
    if (s.hasTime) {
      const a = Math.max(0, d - paceWindow / 2);
      const b = Math.min(s.total, d + paceWindow / 2);
      const dt = timeBetween(s, a, b);
      if (b - a >= Math.min(paceWindow / 2, s.total) && dt > 0) sample.pace = dt / ((b - a) / 1000);
    }
    if (s.ele) sample.ele = valueAt(s.dist, s.ele, d);
    const hr = meanInRange(s, 'hr', d - step, d + step);
    if (hr !== undefined) sample.hr = hr;
    const cad = meanInRange(s, 'cad', d - half, d + half);
    if (cad !== undefined) sample.cad = cad;
    const power = meanInRange(s, 'power', d - half, d + half);
    if (power !== undefined) sample.power = power;
    out.push(sample);
  }
  return out;
}

/** A sample step that keeps charts around 300–600 points. */
export const chartStep = (total: number) => Math.max(20, Math.ceil(total / 500 / 10) * 10);

export interface Split {
  /** 1-based km number. */
  km: number;
  /** Metres covered in this split (1000 except the last). */
  distance: number;
  /** Moving seconds. */
  time?: number;
  pace?: number;
  avgHr?: number;
  /** Metres gained (+) or lost (−) from start to end of the split. */
  eleChange?: number;
  avgCad?: number;
  partial: boolean;
}

/** One split per km; the last one is partial (dropped if under 10 m). */
export function kmSplits(s: Streams): Split[] {
  const out: Split[] = [];
  for (let k = 0; k * 1000 < s.total; k++) {
    const a = k * 1000;
    const b = Math.min(s.total, a + 1000);
    const distance = b - a;
    if (distance < 10) break;
    const split: Split = { km: k + 1, distance, partial: distance < 999.5 };
    if (s.hasTime) {
      split.time = timeBetween(s, a, b);
      if (split.time > 0) split.pace = split.time / (distance / 1000);
    }
    split.avgHr = meanInRange(s, 'hr', a, b);
    split.avgCad = meanInRange(s, 'cad', a, b);
    if (s.ele) split.eleChange = valueAt(s.dist, s.ele, b) - valueAt(s.dist, s.ele, a);
    out.push(split);
  }
  return out;
}

export interface Block {
  /** Start and end distance in metres. */
  start: number;
  end: number;
  distance: number;
  time: number;
  pace: number;
  avgHr?: number;
}

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Splits values into a low and a high group with the smallest spread inside
 * each group (Otsu's method in 1-D). Returns the means of both groups.
 */
export function twoGroups(values: number[]): { low: number; high: number; threshold: number } | null {
  if (values.length < 2) return null;
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const prefix = [0];
  for (const x of v) prefix.push(prefix[prefix.length - 1] + x);
  let best = -1, bestK = 1;
  for (let k = 1; k < n; k++) {
    const m1 = prefix[k] / k;
    const m2 = (prefix[n] - prefix[k]) / (n - k);
    // Between-group variance; maximising it minimises the spread inside groups.
    const between = k * (n - k) * (m1 - m2) ** 2;
    if (between > best) {
      best = between;
      bestK = k;
    }
  }
  const low = prefix[bestK] / bestK;
  const high = (prefix[n] - prefix[bestK]) / (n - bestK);
  return { low, high, threshold: (low + high) / 2 };
}

/**
 * Finds stretches run clearly faster than the rest of the run, e.g. the
 * reps of a "6x800" workout or the core of a tempo run.
 *
 * Heuristic: smoothed pace (100 m window, sampled every 25 m) is split into
 * a fast and a slow group. If the fast group is at least `minContrast`
 * faster, samples below the midpoint count as fast. Fast stretches separated
 * by less than 75 m are merged and stretches shorter than 200 m are dropped.
 */
export function detectFastBlocks(s: Streams, minContrast = 0.1): Block[] {
  if (!s.hasTime || s.total < 1000) return [];
  const step = 25;
  const samples = sampleByDistance(s, step, 100);
  const paces = samples.map((x) => x.pace).filter((p): p is number => p !== undefined);
  if (paces.length < 20) return [];
  // Ignore extreme samples (GPS glitches, walking) when finding the groups.
  const lo = percentile(paces, 0.02), hi = percentile(paces, 0.98);
  const groups = twoGroups(paces.filter((p) => p >= lo && p <= hi));
  if (!groups || groups.low > groups.high * (1 - minContrast)) return [];
  const threshold = groups.threshold;

  const ranges: [number, number][] = [];
  let start: number | null = null;
  for (const x of samples) {
    const fast = x.pace !== undefined && x.pace < threshold;
    if (fast && start === null) start = x.d;
    if (!fast && start !== null) {
      ranges.push([start, x.d]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, s.total]);

  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= 75) last[1] = r[1];
    else merged.push([...r]);
  }

  return merged
    .filter(([a, b]) => b - a >= 200)
    .map(([a, b]) => {
      const time = timeBetween(s, a, b);
      return { start: a, end: b, distance: b - a, time, pace: time / ((b - a) / 1000), avgHr: meanInRange(s, 'hr', a, b) };
    })
    .filter((blk) => blk.time > 0);
}

/**
 * Aerobic decoupling (Pa:HR) in %: how much efficiency (speed ÷ heart rate)
 * dropped from the first half of the run to the second, split by moving
 * time. Positive means the heart worked harder for the same pace later on.
 * Undefined without heart rate and timestamps, or for runs under 20 minutes.
 */
export function aerobicDecoupling(s: Streams): number | undefined {
  const totalTime = s.moving[s.moving.length - 1] ?? 0;
  if (!s.hasTime || totalTime < 20 * 60) return undefined;
  const half = totalTime / 2;
  const halves = [
    { dist: 0, hrSum: 0, w: 0 },
    { dist: 0, hrSum: 0, w: 0 },
  ];
  for (let i = 1; i < s.points.length; i++) {
    const dt = s.moving[i] - s.moving[i - 1];
    if (dt <= 0) continue;
    const h = halves[s.moving[i - 1] < half ? 0 : 1];
    h.dist += s.dist[i] - s.dist[i - 1];
    const hr = s.points[i - 1].hr;
    if (hr !== undefined) {
      h.hrSum += hr * dt;
      h.w += dt;
    }
  }
  if (!halves[0].w || !halves[1].w) return undefined;
  const ef = halves.map((h) => h.dist / half / (h.hrSum / h.w));
  return ((ef[0] - ef[1]) / ef[0]) * 100;
}

export const EFFORT_DISTANCES = [
  { key: 'effort400', meters: 400 },
  { key: 'effort1k', meters: 1000 },
  { key: 'effortMile', meters: 1609.344 },
  { key: 'effort5k', meters: 5000 },
  { key: 'effort10k', meters: 10000 },
  { key: 'effortHalf', meters: 21097.5 },
] as const;

/** Best times for standard distances the run is long enough to contain. */
export function bestEfforts(s: Streams) {
  if (!s.hasTime) return [];
  return EFFORT_DISTANCES.map((e) => ({ ...e, time: bestEffort(s.dist, s.moving, e.meters) })).filter(
    (e): e is (typeof e & { time: number }) => e.time !== undefined,
  );
}

/** Splits the values into `n` equal-count bins; returns the n−1 inner thresholds. */
export function quantileBreaks(values: number[], n: number): number[] {
  if (!values.length) return [];
  return Array.from({ length: n - 1 }, (_, i) => percentile(values, (i + 1) / n));
}

/** Bin index (0..breaks.length) for a value. */
export const binOf = (value: number, breaks: number[]) => {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
};
