import { haversine, trackDistance } from '../../../geo';
import type { Coord, LngLat } from '../../../types';
import type { RouteState, Segment } from './state';

const BROUTER_URL = 'https://brouter.de/brouter';
/**
 * The most direct path along mapped ways, instead of a profile that takes
 * detours for "nicer" ways. Combined with `chooseGeometry`, the line stays
 * as straight as possible without crossing buildings or walls.
 */
const PROFILE = 'shortest';
const TIMEOUT_MS = 15_000;
const MAX_CONCURRENT = 4;

/** A routed path at most this much longer than the straight line is drawn straight. */
export const STRAIGHT_RATIO = 1.12;
/** Segments shorter than this (metres) are always drawn straight. */
export const STRAIGHT_MIN_DISTANCE = 30;
/** A clicked point moves onto the path when the path starts at most this far away (metres). */
export const SNAP_MAX_DISTANCE = 50;

const withEle = (p: LngLat | Coord, ele: number | undefined): Coord =>
  ele === undefined ? [p[0], p[1]] : [p[0], p[1], ele];

/**
 * Picks the geometry for a segment from `from` to `to` given the routed
 * path: the straight line when the path is almost the same (or the segment
 * is tiny), otherwise the full routed path. The straight line keeps the
 * elevations BRouter reported at both ends.
 */
export function chooseGeometry(
  from: LngLat,
  to: LngLat,
  routed: Coord[],
): { coords: Coord[]; straight: boolean } {
  const direct = haversine(from, to);
  const length = trackDistance(routed);
  if (direct < STRAIGHT_MIN_DISTANCE || length <= direct * STRAIGHT_RATIO) {
    return {
      coords: [withEle(from, routed[0]?.[2]), withEle(to, routed[routed.length - 1]?.[2])],
      straight: true,
    };
  }
  return { coords: routed, straight: false };
}

const cache = new Map<string, Coord[]>();
const cacheKey = (a: LngLat, b: LngLat) =>
  `${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}`;

/** Asks BRouter for a walking/running path from `a` to `b`. */
export async function routeSegment(a: LngLat, b: LngLat, signal?: AbortSignal): Promise<Coord[]> {
  const key = cacheKey(a, b);
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    lonlats: `${a[0]},${a[1]}|${b[0]},${b[1]}`,
    profile: PROFILE,
    alternativeidx: '0',
    format: 'geojson',
  });
  const signals = [AbortSignal.timeout(TIMEOUT_MS)];
  if (signal) signals.push(signal);

  const res = await fetch(`${BROUTER_URL}?${params}`, { signal: AbortSignal.any(signals) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BRouter ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw: unknown = data?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) throw new Error('BRouter returned no route');

  const coords: Coord[] = raw.map((c: number[]) =>
    Number.isFinite(c[2]) ? [c[0], c[1], c[2]] : [c[0], c[1]],
  );
  cache.set(key, coords);
  return coords;
}

/**
 * Keeps routing requests in step with the route: starts requests for pending
 * segments and cancels requests for segments that were removed or replaced.
 * Call `sync()` after every state change.
 */
export class RoutingQueue {
  private inflight = new Map<Segment, AbortController>();

  constructor(
    private state: RouteState,
    private onFailure: (error: unknown) => void,
  ) {}

  get busy(): boolean {
    return this.inflight.size > 0;
  }

  sync(): void {
    const current = new Set(this.state.segments);
    for (const [seg, ctrl] of this.inflight) {
      if (!current.has(seg)) {
        ctrl.abort();
        this.inflight.delete(seg);
      }
    }
    for (const seg of this.state.segments) {
      if (this.inflight.size >= MAX_CONCURRENT) break;
      if (seg.kind === 'routed' && seg.status === 'pending' && !this.inflight.has(seg)) {
        this.start(seg);
      }
    }
  }

  private start(seg: Segment): void {
    const ctrl = new AbortController();
    this.inflight.set(seg, ctrl);
    routeSegment(seg.from, seg.to, ctrl.signal)
      .then((routed) => {
        const { coords, straight } = chooseGeometry(seg.from, seg.to, routed);
        seg.coords = straight ? coords : [...coords];
        seg.status = 'ready';
        if (!straight) this.snapEnds(seg);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        seg.status = 'failed';
        this.onFailure(err);
      })
      .finally(() => {
        if (this.inflight.get(seg) !== ctrl) return;
        this.inflight.delete(seg);
        // Redraw, and start any segments that were waiting for a free slot.
        this.state.emit();
      });
  }

  /**
   * Moves the segment's waypoints onto the start and end of its routed path
   * (BRouter starts at the nearest way), and joins the neighbouring segments
   * to the new positions. Points clicked far from any way stay put and the
   * line is extended to reach them instead.
   *
   * Waypoint tuples are updated in place, like segments, so undo history
   * shares the snapped positions.
   */
  private snapEnds(seg: Segment): void {
    const s = this.state;
    const i = s.segments.indexOf(seg);
    if (i === -1) return;
    const loop = s.waypoints.length > 2 && same(s.waypoints[0], s.waypoints[s.waypoints.length - 1]);

    const snap = (wpIndex: number, end: 'start' | 'end') => {
      const c = end === 'start' ? seg.coords[0] : seg.coords[seg.coords.length - 1];
      const wp = s.waypoints[wpIndex];
      const d = haversine(wp, c);
      if (d === 0) return;
      if (d > SNAP_MAX_DISTANCE) {
        const joined = withEle(wp, c[2]);
        if (end === 'start') seg.coords.unshift(joined);
        else seg.coords.push(joined);
        return;
      }
      // A closed loop's start and finish are the same place: move both.
      const targets = loop && (wpIndex === 0 || wpIndex === s.waypoints.length - 1)
        ? [0, s.waypoints.length - 1]
        : [wpIndex];
      for (const j of targets) {
        const old = s.waypoints[j];
        old[0] = c[0];
        old[1] = c[1];
        // Segments may hold copies of the tuple (e.g. after restoring from storage).
        const before = s.segments[j - 1];
        const after = s.segments[j];
        if (before && before !== seg) moveEnd(before, 'end', c);
        if (after && after !== seg) moveEnd(after, 'start', c);
        if (before === seg) seg.to = old;
        if (after === seg) seg.from = old;
      }
    };
    snap(i, 'start');
    snap(i + 1, 'end');
  }
}

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/** Moves one end of a neighbouring segment to `c`, keeping its own elevation. */
function moveEnd(seg: Segment, end: 'start' | 'end', c: Coord): void {
  const k = end === 'start' ? 0 : seg.coords.length - 1;
  const point = seg[end === 'start' ? 'from' : 'to'];
  point[0] = c[0];
  point[1] = c[1];
  // A pending segment gets new coords when its request finishes.
  if (seg.status === 'pending' || !seg.coords.length) return;
  const old = seg.coords[k];
  seg.coords = [...seg.coords];
  seg.coords[k] = withEle(c, old[2] ?? c[2]);
}
