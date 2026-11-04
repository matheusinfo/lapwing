/**
 * Estimates the athlete's references (max HR, threshold HR and threshold
 * pace) from the imported runs, and the zones that follow from them.
 *
 * - Max HR: the highest 10-second average heart rate in the tracks of the 5
 *   runs with the highest max HR of the last 365 days, so a lone sensor spike
 *   (one or two readings) doesn't count. Readings above 225 bpm are ignored.
 * - Threshold HR (LTHR): the best 30-minute average heart rate among the
 *   hardest runs (by average HR) of the last 180 days. Below 85 % of the max
 *   HR there was no hard effort, so it falls back to 90 % of the max HR.
 * - Threshold pace: Jack Daniels' T pace from the best VDOT of the last 180
 *   days (the same source as the race predictions in Insights).
 */
import { cumulativeDistance, cumulativeMovingTime } from '../../data/analysis';
import { getTrack } from '../../data/db';
import type { Activity, TrackPoint } from '../../data/types';
import { bestWindowHr, hrZonesFromLthr, paceZonesFromThreshold, type ZoneStarts } from '../../data/zones';
import { loadEfforts } from '../history/efforts';
import { bestVdot, collectEfforts, predictionRuns, type Effort } from '../insights/predictions';

const DAY = 86_400_000;
export const MAX_HR_DAYS = 365;
export const THRESHOLD_DAYS = 180;
/** Hardest runs (by average HR) whose tracks are read for the threshold HR. */
export const LTHR_CANDIDATES = 12;
/** Runs with the highest max HR whose tracks are read for the max HR. */
export const MAX_HR_CANDIDATES = 5;
export const MAX_HR_WINDOW = 10;
export const MAX_HR_CAP = 225;
export const LTHR_WINDOW = 1800;
export const HARD_EFFORT_SHARE = 0.85;
export const LTHR_FALLBACK_SHARE = 0.9;

export interface ZoneEstimate {
  maxHr?: { value: number; activity: Activity };
  /** `activity` is missing when it fell back to a share of the max HR. */
  lthr?: { value: number; activity?: Activity };
  thresholdPace?: { value: number; vdot: number; effort: Effort };
  hrZoneStarts?: ZoneStarts;
  paceZoneStarts?: ZoneStarts;
}

const isRun = (a: Activity) => a.type === 'run' || a.type === 'trail-run';

export async function estimateZones(
  activities: Activity[],
  now: number,
  signal: AbortSignal,
  loadTrack: (id: string) => Promise<TrackPoint[]> = getTrack,
): Promise<ZoneEstimate> {
  const out: ZoneEstimate = {};
  const runs = activities.filter(isRun);

  const cache = new Map<string, { points: TrackPoint[]; moving: number[] }>();
  const read = async (a: Activity) => {
    let t = cache.get(a.id);
    if (!t) {
      const points = await loadTrack(a.id);
      t = { points, moving: cumulativeMovingTime(points, cumulativeDistance(points)) };
      cache.set(a.id, t);
    }
    return t;
  };

  const maxCandidates = runs
    .filter((a) => a.startTime >= now - MAX_HR_DAYS * DAY && a.summary.has.hr && a.summary.maxHr !== undefined)
    .sort((a, b) => b.summary.maxHr! - a.summary.maxHr!)
    .slice(0, MAX_HR_CANDIDATES);
  for (const a of maxCandidates) {
    if (signal.aborted) return out;
    const { points, moving } = await read(a);
    const capped = points.map((p) => (p.hr !== undefined && p.hr > MAX_HR_CAP ? { ...p, hr: undefined } : p));
    const hr = bestWindowHr(capped, moving, MAX_HR_WINDOW);
    if (hr !== undefined && (!out.maxHr || hr > out.maxHr.value)) out.maxHr = { value: Math.round(hr), activity: a };
  }

  const since = now - THRESHOLD_DAYS * DAY;
  const candidates = runs
    .filter((a) => a.startTime >= since && a.summary.has.hr && a.summary.avgHr !== undefined && a.summary.movingTime >= LTHR_WINDOW)
    .sort((a, b) => b.summary.avgHr! - a.summary.avgHr!)
    .slice(0, LTHR_CANDIDATES);
  let best: { value: number; activity: Activity } | undefined;
  for (const a of candidates) {
    if (signal.aborted) return out;
    const { points, moving } = await read(a);
    const hr = bestWindowHr(points, moving, LTHR_WINDOW);
    if (hr !== undefined && (!best || hr > best.value)) best = { value: hr, activity: a };
  }
  const max = out.maxHr?.value;
  if (best && (max === undefined || best.value >= HARD_EFFORT_SHARE * max)) {
    out.lthr = { value: Math.round(best.value), activity: best.activity };
  } else if (max !== undefined) {
    out.lthr = { value: Math.round(LTHR_FALLBACK_SHARE * max) };
  }
  if (out.lthr) out.hrZoneStarts = hrZonesFromLthr(out.lthr.value);

  const paceRuns = predictionRuns(activities, since);
  const efforts = collectEfforts(paceRuns, await loadEfforts(paceRuns, signal));
  if (signal.aborted) return out;
  const vdot = bestVdot(efforts);
  if (vdot) {
    out.thresholdPace = { value: Math.round(vdot.paces.threshold), vdot: vdot.value, effort: vdot.source };
    out.paceZoneStarts = paceZonesFromThreshold(out.thresholdPace.value);
  }
  return out;
}
