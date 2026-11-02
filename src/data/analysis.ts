import { elevationGainLoss, haversine } from '../geo';
import type { ActivitySummary, TrackPoint } from './types';

/** Below this speed (m/s) a stretch counts as stopped. ~1.8 km/h. */
export const MOVING_SPEED = 0.5;

/** Cumulative distance in metres at each point (first point is 0). */
export function cumulativeDistance(points: TrackPoint[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversine([points[i - 1].lon, points[i - 1].lat], [points[i].lon, points[i].lat]);
    out[i] = total;
  }
  return out;
}

/**
 * Moving time in seconds at each point (first point is 0): elapsed time with
 * stops removed. All zeros when the file has no timestamps.
 */
export function cumulativeMovingTime(points: TrackPoint[], dist = cumulativeDistance(points)): number[] {
  const out = new Array<number>(points.length).fill(0);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].time, b = points[i].time;
    if (a !== undefined && b !== undefined && b > a) {
      const dt = (b - a) / 1000;
      if ((dist[i] - dist[i - 1]) / dt >= MOVING_SPEED) total += dt;
    }
    out[i] = total;
  }
  return out;
}

/**
 * Fastest time (seconds) to cover `meters` anywhere in the activity, using
 * moving time. Undefined if the run is shorter or has no timestamps.
 */
export function bestEffort(dist: number[], moving: number[], meters: number): number | undefined {
  if (!dist.length || dist[dist.length - 1] < meters || moving[moving.length - 1] === 0) return undefined;
  let best = Infinity;
  let j = 0;
  for (let i = 0; i < dist.length; i++) {
    while (j < dist.length && dist[j] - dist[i] < meters) j++;
    if (j >= dist.length) break;
    // Scale to exactly `meters` on the last stretch.
    const covered = dist[j] - dist[i];
    const time = ((moving[j] - moving[i]) * meters) / covered;
    if (time > 0 && time < best) best = time;
  }
  return Number.isFinite(best) ? best : undefined;
}

function timeWeightedStats(points: TrackPoint[], key: 'hr' | 'cad' | 'temp' | 'power') {
  let sum = 0, weight = 0, max = -Infinity, count = 0, plainSum = 0;
  for (let i = 0; i < points.length; i++) {
    const v = points[i][key];
    if (v === undefined) continue;
    count++;
    plainSum += v;
    if (v > max) max = v;
    const next = points[i + 1];
    const t0 = points[i].time, t1 = next?.time;
    if (t0 !== undefined && t1 !== undefined && t1 > t0) {
      const dt = Math.min((t1 - t0) / 1000, 30); // Don't let long pauses dominate.
      sum += v * dt;
      weight += dt;
    }
  }
  if (!count) return { avg: undefined, max: undefined };
  return { avg: weight > 0 ? sum / weight : plainSum / count, max };
}

/** Computes the headline numbers for an activity. */
export function computeSummary(points: TrackPoint[]): ActivitySummary {
  const dist = cumulativeDistance(points);
  const moving = cumulativeMovingTime(points, dist);
  const distance = dist[dist.length - 1] ?? 0;

  const times = points.map((p) => p.time).filter((t): t is number => t !== undefined);
  const elapsedTime = times.length >= 2 ? (times[times.length - 1] - times[0]) / 1000 : 0;
  const movingTime = moving[moving.length - 1] || elapsedTime;

  const ele = elevationGainLoss(points.map((p) => [p.lon, p.lat, p.ele]));
  const eles = points.map((p) => p.ele).filter((e): e is number => e !== undefined);

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }

  const hr = timeWeightedStats(points, 'hr');
  const cad = timeWeightedStats(points, 'cad');
  const temp = timeWeightedStats(points, 'temp');
  const power = timeWeightedStats(points, 'power');
  const has = {
    time: times.length >= 2,
    ele: eles.length > 0,
    hr: hr.avg !== undefined,
    cad: cad.avg !== undefined,
    temp: temp.avg !== undefined,
    power: power.avg !== undefined,
  };

  return {
    distance,
    elapsedTime,
    movingTime,
    avgPace: has.time && distance > 0 ? movingTime / (distance / 1000) : undefined,
    bestPace: has.time ? bestEffort(dist, moving, 1000) : undefined,
    elevationGain: ele.gain,
    elevationLoss: ele.loss,
    minEle: eles.length ? Math.min(...eles) : undefined,
    maxEle: eles.length ? Math.max(...eles) : undefined,
    avgHr: hr.avg,
    maxHr: hr.max,
    avgCadence: cad.avg,
    maxCadence: cad.max,
    avgTemp: temp.avg,
    avgPower: power.avg,
    maxPower: power.max,
    has,
    bounds: [[w, s], [e, n]],
  };
}
