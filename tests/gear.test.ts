import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, Shoe } from '../src/data/types';

// In-memory replacement for the IndexedDB layer.
const mem = vi.hoisted(() => {
  const stores = new Map<string, Map<string, { id: string }>>();
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return { stores, store, clone };
});

vi.mock('../src/data/db', () => ({
  getAll: async (name: string) => [...mem.store(name).values()].map(mem.clone),
  get: async (name: string, id: string) => {
    const v = mem.store(name).get(id);
    return v ? mem.clone(v) : undefined;
  },
  put: async (name: string, v: { id: string }) => void mem.store(name).set(v.id, mem.clone(v)),
  putMany: async (name: string, vs: { id: string }[]) => vs.forEach((v) => mem.store(name).set(v.id, mem.clone(v))),
  remove: async (name: string, id: string) => void mem.store(name).delete(id),
  listActivities: async () => [...mem.store('activities').values()].map(mem.clone),
  saveActivity: async (a: { id: string }) => void mem.store('activities').set(a.id, mem.clone(a)),
  onDataChange: () => () => {},
  newId: () => Math.random().toString(36).slice(2),
}));

const shoesMod = await import('../src/data/shoes');
const {
  assignCandidates,
  assignShoe,
  defaultShoeId,
  deleteShoe,
  listShoes,
  retireShoe,
  saveShoe,
  setDefaultShoe,
  shoeStats,
  unretireShoe,
  wearStatus,
} = shoesMod;

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 1, 12).getTime();

let n = 0;
function act(daysAgo: number, km: number, extra: Partial<Activity> = {}): Activity {
  return {
    id: `a${++n}`,
    name: 'Run',
    type: 'run',
    startTime: NOW - daysAgo * DAY,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: {
      distance: km * 1000,
      elapsedTime: km * 330,
      movingTime: km * 300,
      avgPace: 300,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
    },
    ...extra,
  };
}

const shoe = (id: string, extra: Partial<Shoe> = {}): Shoe => ({
  id,
  name: id,
  startDistance: 0,
  retireDistance: 700_000,
  createdAt: 0,
  ...extra,
});

beforeEach(() => mem.stores.clear());

describe('shoeStats', () => {
  it('adds the start distance to logged runs and computes pace and dates', () => {
    const s = shoe('s1', { startDistance: 100_000 });
    const acts = [act(10, 10, { shoeId: 's1' }), act(3, 5, { shoeId: 's1' }), act(1, 8, { shoeId: 'other' }), act(2, 6)];
    const st = shoeStats(s, acts, NOW);
    expect(st.distance).toBe(115_000);
    expect(st.loggedDistance).toBe(15_000);
    expect(st.runs).toBe(2);
    expect(st.movingTime).toBe(15 * 300);
    expect(st.avgPace).toBeCloseTo(300);
    expect(st.firstUsed).toBe(NOW - 10 * DAY);
    expect(st.lastUsed).toBe(NOW - 3 * DAY);
    expect(st.wear).toBeCloseTo(115 / 700);
    expect(st.status).toBe('ok');
  });

  it('has no pace, dates or projection for an unused shoe', () => {
    const st = shoeStats(shoe('s1'), [], NOW);
    expect(st).toMatchObject({ distance: 0, runs: 0, wear: 0, status: 'ok' });
    expect(st.avgPace).toBeUndefined();
    expect(st.lastUsed).toBeUndefined();
    expect(st.projectedRetireAt).toBeUndefined();
  });

  it('classifies wear', () => {
    expect(wearStatus(0.74)).toBe('ok');
    expect(wearStatus(0.75)).toBe('worn');
    expect(wearStatus(1)).toBe('worn');
    expect(wearStatus(1.01)).toBe('replace');
    expect(wearStatus(0.2, true)).toBe('retired');
    const s = shoe('s1', { retireDistance: 100_000 });
    expect(shoeStats(s, [act(1, 80, { shoeId: 's1' })], NOW).status).toBe('worn');
    expect(shoeStats(s, [act(1, 101, { shoeId: 's1' })], NOW).status).toBe('replace');
    expect(shoeStats({ ...s, retiredAt: NOW }, [act(1, 10, { shoeId: 's1' })], NOW).status).toBe('retired');
  });

  it('projects retirement from the last 8 weeks only', () => {
    const s = shoe('s1', { startDistance: 300_000, retireDistance: 700_000 });
    // 56 km in the last 8 weeks = 1 km/day; the old 200 km run does not count for the rate.
    const acts = [act(100, 200, { shoeId: 's1' }), ...Array.from({ length: 8 }, (_, i) => act(i * 7 + 1, 7, { shoeId: 's1' }))];
    const st = shoeStats(s, acts, NOW);
    expect(st.distance).toBe(556_000);
    expect(st.recentDailyDistance).toBeCloseTo(1000);
    expect(st.projectedRetireAt).toBe(NOW + 144 * DAY);
  });

  it('does not project for retired, worn-out or idle shoes', () => {
    const recent = (id: string) => [act(1, 10, { shoeId: id })];
    expect(shoeStats(shoe('a', { retiredAt: NOW }), recent('a'), NOW).projectedRetireAt).toBeUndefined();
    expect(shoeStats(shoe('b', { startDistance: 800_000 }), recent('b'), NOW).projectedRetireAt).toBeUndefined();
    expect(shoeStats(shoe('c'), [act(90, 10, { shoeId: 'c' })], NOW).projectedRetireAt).toBeUndefined();
  });
});

describe('assignCandidates', () => {
  it('filters by date range, run type and existing shoe', () => {
    const acts = [
      act(1, 5),
      act(2, 5, { shoeId: 'other' }),
      act(3, 5, { type: 'walk' }),
      act(4, 5, { type: 'trail-run' }),
      act(40, 5),
      act(5, 5, { shoeId: 's1' }),
    ];
    const ids = (xs: Activity[]) => xs.map((a) => a.id);
    const day = (daysAgo: number) => shoesMod.localDay(NOW - daysAgo * DAY);
    expect(ids(assignCandidates(acts, { shoeId: 's1', onlyUnassigned: true }))).toEqual([acts[0].id, acts[3].id, acts[4].id]);
    expect(ids(assignCandidates(acts, { shoeId: 's1', onlyUnassigned: false, from: day(10), to: day(2) }))).toEqual([
      acts[1].id,
      acts[3].id,
    ]);
  });
});

describe('shoe storage', () => {
  it('keeps at most one default shoe', async () => {
    await saveShoe(shoe('a', { isDefault: true }));
    await saveShoe(shoe('b', { isDefault: true }));
    let all = await listShoes();
    expect(all.filter((s) => s.isDefault).map((s) => s.id)).toEqual(['b']);
    expect(await defaultShoeId()).toBe('b');

    await setDefaultShoe('a');
    all = await listShoes();
    expect(all.filter((s) => s.isDefault).map((s) => s.id)).toEqual(['a']);

    await setDefaultShoe(null);
    expect(await defaultShoeId()).toBeUndefined();
  });

  it('retiring removes the default flag; unretiring clears retiredAt', async () => {
    await saveShoe(shoe('a', { isDefault: true }));
    await retireShoe('a', NOW);
    let a = (await listShoes())[0];
    expect(a.retiredAt).toBe(NOW);
    expect(a.isDefault).toBe(false);
    expect(await defaultShoeId()).toBeUndefined();
    await setDefaultShoe('a'); // Retired shoes can't be default.
    expect(await defaultShoeId()).toBeUndefined();
    await unretireShoe('a');
    a = (await listShoes())[0];
    expect(a.retiredAt).toBeUndefined();
  });

  it('deleting a shoe unassigns its runs and keeps the others', async () => {
    const runs = [act(1, 5, { shoeId: 'a' }), act(2, 5, { shoeId: 'a' }), act(3, 5, { shoeId: 'b' })];
    runs.forEach((r) => mem.store('activities').set(r.id, r));
    await saveShoe(shoe('a'));
    await saveShoe(shoe('b'));
    expect(await deleteShoe('a')).toBe(2);
    expect((await listShoes()).map((s) => s.id)).toEqual(['b']);
    const stored = [...mem.store('activities').values()] as Activity[];
    expect(stored.map((a) => a.shoeId)).toEqual([undefined, undefined, 'b']);
    expect(stored.every((a) => 'summary' in a)).toBe(true);
  });

  it('bulk-assigns only changed runs', async () => {
    const runs = [act(1, 5), act(2, 5, { shoeId: 'a' })];
    expect(await assignShoe(runs, 'a')).toBe(1);
    expect((mem.store('activities').get(runs[0].id) as Activity).shoeId).toBe('a');
  });
});
