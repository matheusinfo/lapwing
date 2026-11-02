import type { ActivitySummary, AthleteSettings, TrackPoint } from './types';

/** Zone index 0–4 for a heart rate, from the athlete's zone bounds. */
export function hrZone(hr: number, settings: AthleteSettings): number {
  const frac = hr / settings.maxHr;
  const i = settings.hrZoneBounds.findIndex((bound) => frac < bound);
  return i === -1 ? 4 : i;
}

/** Zone limits in bpm: [[low, high] × 5]. */
export function hrZoneRanges(settings: AthleteSettings): [number, number][] {
  const b = settings.hrZoneBounds.map((f) => Math.round(f * settings.maxHr));
  return [[0, b[0]], [b[0], b[1]], [b[1], b[2]], [b[2], b[3]], [b[3], settings.maxHr]];
}

/** Seconds spent in each of the 5 heart-rate zones (pauses over 30 s ignored). */
export function hrZoneSeconds(points: TrackPoint[], settings: AthleteSettings): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], t1 = points[i + 1].time;
    if (p.hr === undefined || p.time === undefined || t1 === undefined || t1 <= p.time) continue;
    out[hrZone(p.hr, settings)] += Math.min((t1 - p.time) / 1000, 30);
  }
  return out;
}

const trimpWeight = (hr: number, s: AthleteSettings) => {
  const r = Math.max(0, Math.min(1, (hr - s.restingHr) / (s.maxHr - s.restingHr)));
  // Banister TRIMP, male coefficients (the common default).
  return r * 0.64 * Math.exp(1.92 * r);
};

/**
 * Training load (Banister TRIMP) from the heart-rate stream: minutes weighted
 * by how hard the heart worked. ~50 for an easy hour, 150+ for a hard
 * long run. Undefined without heart rate.
 */
export function trimp(points: TrackPoint[], settings: AthleteSettings): number | undefined {
  let total = 0, any = false;
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], t1 = points[i + 1].time;
    if (p.hr === undefined || p.time === undefined || t1 === undefined || t1 <= p.time) continue;
    any = true;
    total += (Math.min((t1 - p.time) / 1000, 30) / 60) * trimpWeight(p.hr, settings);
  }
  return any ? total : undefined;
}

/**
 * Quick training-load estimate from the summary only (average HR × moving
 * time), for lists and charts that shouldn't load every track. Slightly
 * lower than `trimp()` for uneven efforts such as intervals.
 */
export function trimpFromSummary(summary: ActivitySummary, settings: AthleteSettings): number | undefined {
  if (summary.avgHr === undefined || !summary.movingTime) return undefined;
  return (summary.movingTime / 60) * trimpWeight(summary.avgHr, settings);
}
