import { bestEffort, cumulativeDistance, cumulativeMovingTime } from '../../data/analysis';
import { getTrack } from '../../data/db';
import type { Activity } from '../../data/types';
import { EFFORT_DISTANCES, type Efforts } from './aggregate';

/** Best efforts per activity id. Lives for the whole session (ids never change meaning). */
const cache = new Map<string, Efforts>();

async function effortsFor(a: Activity): Promise<Efforts> {
  const cached = cache.get(a.id);
  if (cached) return cached;
  const efforts: Efforts = {};
  if (a.summary.has.time && a.summary.distance >= EFFORT_DISTANCES[0]) {
    const points = await getTrack(a.id);
    const dist = cumulativeDistance(points);
    const moving = cumulativeMovingTime(points, dist);
    for (const d of EFFORT_DISTANCES) {
      const time = bestEffort(dist, moving, d);
      if (time !== undefined) efforts[d] = time;
    }
  }
  cache.set(a.id, efforts);
  return efforts;
}

const idle = () =>
  new Promise<void>((resolve) =>
    'requestIdleCallback' in window ? requestIdleCallback(() => resolve()) : setTimeout(resolve, 0),
  );

/**
 * Computes best efforts for every activity, one track at a time between
 * frames so the page stays responsive. Returns early (with what it has)
 * when `signal` is aborted.
 */
export async function loadEfforts(activities: Activity[], signal: AbortSignal): Promise<Map<string, Efforts>> {
  const out = new Map<string, Efforts>();
  for (const a of activities) {
    if (signal.aborted) break;
    if (!cache.has(a.id)) await idle();
    try {
      out.set(a.id, await effortsFor(a));
    } catch (err) {
      console.warn('Could not compute efforts for', a.id, err);
    }
  }
  return out;
}

/** True when every activity's efforts are already cached (no loading needed). */
export const effortsCached = (activities: Activity[]) => activities.every((a) => cache.has(a.id));

export function cachedEfforts(activities: Activity[]): Map<string, Efforts> {
  const out = new Map<string, Efforts>();
  for (const a of activities) {
    const e = cache.get(a.id);
    if (e) out.set(a.id, e);
  }
  return out;
}
