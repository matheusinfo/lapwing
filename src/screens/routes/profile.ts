import { haversine } from '../../geo';
import type { Coord } from '../../types';

/** One sample of the elevation profile. */
export interface ProfilePoint {
  /** Distance from the start, in metres. */
  d: number;
  /** Elevation in metres, lightly smoothed. */
  ele: number;
  /** Grade around this point, in percent (uphill is positive). */
  grade: number;
  lng: number;
  lat: number;
}

export interface ElevationProfile {
  /** Samples evenly spaced by distance, from 0 to `distance`. */
  points: ProfilePoint[];
  /** Length of the whole track, in metres (same as `trackDistance`). */
  distance: number;
  /** Lowest and highest elevation found in the track itself (not smoothed). */
  min: number;
  max: number;
}

export interface ProfileOptions {
  /** Most samples to keep (a GPX file can have tens of thousands of points). */
  maxPoints?: number;
  /**
   * Width of the moving average that hides GPS and elevation-model noise, in
   * metres. It is never narrower than twice the distance between samples.
   */
  smoothing?: number;
}

export const MAX_PROFILE_POINTS = 800;
/** Short routes get a sample every this many metres. */
const MIN_STEP = 5;
const SMOOTHING = 30;
/** Grade is measured over about this distance, in metres. */
const GRADE_SPAN = 100;

/**
 * Elevation along the track, resampled at even distances so a chart can
 * draw it, or null when there is nothing to draw (fewer than 2 points, no
 * length, or fewer than 2 points with elevation).
 *
 * Points without elevation (e.g. a segment still waiting for the router)
 * take values interpolated from their neighbours. Each sample is the average
 * of the elevation line over a short window centred on it, which smooths
 * noise without moving the start and finish elevations. Gain and loss should
 * still come from `elevationGainLoss` on the raw track.
 */
export function buildProfile(track: Coord[], options: ProfileOptions = {}): ElevationProfile | null {
  const n = track.length;
  if (n < 2) return null;
  const maxPoints = Math.max(2, options.maxPoints ?? MAX_PROFILE_POINTS);
  const smoothing = Math.max(0, options.smoothing ?? SMOOTHING);

  // Distance from the start of every point.
  const d = new Float64Array(n);
  for (let i = 1; i < n; i++) d[i] = d[i - 1] + haversine(track[i - 1], track[i]);
  const total = d[n - 1];
  if (!(total > 0)) return null;

  // Elevation of every point, filling the gaps.
  const e = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  let prev = -1;
  let known = 0;
  for (let i = 0; i < n; i++) {
    const ele = track[i][2];
    if (ele === undefined || !Number.isFinite(ele)) continue;
    known++;
    e[i] = ele;
    if (ele < min) min = ele;
    if (ele > max) max = ele;
    if (prev === -1) {
      e.fill(ele, 0, i); // Before the first known elevation: keep it level.
    } else {
      const span = d[i] - d[prev];
      for (let j = prev + 1; j < i; j++) {
        e[j] = span > 0 ? e[prev] + ((e[i] - e[prev]) * (d[j] - d[prev])) / span : e[prev];
      }
    }
    prev = i;
  }
  if (known < 2) return null;
  e.fill(e[prev], prev + 1); // After the last known elevation: keep it level.

  // Area under the elevation line up to each point, to average it over any window.
  const area = new Float64Array(n);
  for (let i = 1; i < n; i++) area[i] = area[i - 1] + ((e[i - 1] + e[i]) / 2) * (d[i] - d[i - 1]);

  /** Index i of the edge [i, i + 1] that holds distance x. */
  const edgeAt = (x: number) => {
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (d[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const fraction = (i: number, x: number) => {
    const len = d[i + 1] - d[i];
    return len > 0 ? Math.min(1, Math.max(0, (x - d[i]) / len)) : 0;
  };
  const areaTo = (x: number) => {
    const i = edgeAt(x);
    const eleX = e[i] + (e[i + 1] - e[i]) * fraction(i, x);
    return area[i] + ((x - d[i]) * (e[i] + eleX)) / 2;
  };

  const count = Math.min(maxPoints, Math.max(2, Math.ceil(total / MIN_STEP) + 1));
  const step = total / (count - 1);
  // At least two samples wide, so samples don't alias the noise between them.
  const half = Math.max(2 * step, smoothing) / 2;
  const points: ProfilePoint[] = [];
  for (let k = 0; k < count; k++) {
    const x = k === count - 1 ? total : k * step;
    const i = edgeAt(x);
    const f = fraction(i, x);
    // Shrink the window near the ends so it stays centred on x.
    const h = Math.min(half, x, total - x);
    const ele = h > 0 ? (areaTo(x + h) - areaTo(x - h)) / (2 * h) : e[i] + (e[i + 1] - e[i]) * f;
    const a = track[i];
    const b = track[i + 1];
    points.push({ d: x, ele, grade: 0, lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f });
  }

  const reach = Math.max(1, Math.round(GRADE_SPAN / 2 / step));
  for (let k = 0; k < count; k++) {
    const lo = points[Math.max(0, k - reach)];
    const hi = points[Math.min(count - 1, k + reach)];
    const run = hi.d - lo.d;
    points[k].grade = run > 0 ? ((hi.ele - lo.ele) / run) * 100 : 0;
  }

  return { points, distance: total, min, max };
}
