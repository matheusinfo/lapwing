import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseGeometry, RoutingQueue, STRAIGHT_MIN_DISTANCE } from '../src/screens/routes/route/router';
import { RouteState, type Segment } from '../src/screens/routes/route/state';
import type { Coord, LngLat } from '../src/types';

// ~111 m per 0.001° of latitude at the equator.
const A: LngLat = [0, 0];
const B: LngLat = [0, 0.002];

describe('chooseGeometry', () => {
  it('uses the straight line when the path is almost the same, keeping elevations', () => {
    const routed: Coord[] = [[0, 0, 10], [0.00005, 0.001, 12], [0, 0.002, 15]];
    const out = chooseGeometry(A, B, routed);
    expect(out.straight).toBe(true);
    expect(out.coords).toEqual([[0, 0, 10], [0, 0.002, 15]]);
  });

  it('uses the routed path when it is clearly longer (e.g. around a building)', () => {
    const routed: Coord[] = [[0, 0], [0.001, 0], [0.001, 0.002], [0, 0.002]];
    const out = chooseGeometry(A, B, routed);
    expect(out.straight).toBe(false);
    expect(out.coords).toBe(routed);
  });

  it('always draws tiny segments straight', () => {
    const near: LngLat = [0, (STRAIGHT_MIN_DISTANCE - 5) / 111_195];
    const routed: Coord[] = [[0, 0], [0.001, 0], [0.001, near[1]], near];
    expect(chooseGeometry(A, near, routed).straight).toBe(true);
  });
});

describe('RoutingQueue', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (coords: number[][]) =>
    vi.fn(async () => new Response(JSON.stringify({ features: [{ geometry: { coordinates: coords } }] })));

  async function routeOnce(state: RouteState, failures: unknown[] = []) {
    const queue = new RoutingQueue(state, (e) => failures.push(e));
    queue.sync();
    await vi.waitFor(() => expect(queue.busy).toBe(false));
  }

  it('snaps clicked points onto the routed path and joins neighbours', async () => {
    // Path detours east, starting/ending ~11 m from the clicked points.
    const from: LngLat = [0.0001, 0.01];
    const to: LngLat = [0.0001, 0.012];
    vi.stubGlobal('fetch', respond([[0, 0.01, 5], [0.002, 0.01, 6], [0.002, 0.012, 7], [0, 0.012, 8]]));

    const state = new RouteState();
    const prev: Segment = { from: [0.0001, 0.009], to: [...from], kind: 'straight', status: 'ready', coords: [[0.0001, 0.009], [...from]] };
    const seg: Segment = { from, to, kind: 'routed', status: 'pending', coords: [from, to] };
    state.load([[0.0001, 0.009], from, to], [prev, seg]);

    await routeOnce(state);

    expect(seg.status).toBe('ready');
    expect(state.waypoints[1]).toEqual([0, 0.01]);
    expect(state.waypoints[2]).toEqual([0, 0.012]);
    expect(seg.coords).toHaveLength(4);
    // The forced-straight neighbour now ends where the path starts.
    expect(prev.coords[prev.coords.length - 1].slice(0, 2)).toEqual([0, 0.01]);
    expect(prev.to).toEqual([0, 0.01]);
  });

  it('keeps the clicked points and the straight line when the path is direct', async () => {
    vi.stubGlobal('fetch', respond([[0.00001, 0.02, 3], [0.00001, 0.022, 4]]));
    const from: LngLat = [0, 0.02];
    const to: LngLat = [0, 0.022];
    const state = new RouteState();
    const seg: Segment = { from, to, kind: 'routed', status: 'pending', coords: [from, to] };
    state.load([from, to], [seg]);

    await routeOnce(state);

    expect(state.waypoints).toEqual([[0, 0.02], [0, 0.022]]);
    expect(seg.coords).toEqual([[0, 0.02, 3], [0, 0.022, 4]]);
  });

  it('falls back to a failed straight segment when routing fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const from: LngLat = [0, 0.03];
    const to: LngLat = [0, 0.032];
    const state = new RouteState();
    const seg: Segment = { from, to, kind: 'routed', status: 'pending', coords: [from, to] };
    state.load([from, to], [seg]);
    const failures: unknown[] = [];

    await routeOnce(state, failures);

    expect(seg.status).toBe('failed');
    expect(seg.coords).toEqual([from, to]);
    expect(failures).toHaveLength(1);
  });
});
