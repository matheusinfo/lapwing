import { describe, expect, it } from 'vitest';
import type { Activity, ActivitySummary } from '../src/data/types';
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  filtersFromQuery,
  filtersToQuery,
  hasAnyFilter,
  parseDateInput,
  parseKmInput,
  parsePaceInput,
  parseWholeInput,
  workoutKindsByActivity,
  type RunFilters,
} from '../src/screens/history/filters';
import { togglePreset } from '../src/screens/history/filter-view';
import type { PlannedWorkout, TrainingPlan, WorkoutKind } from '../src/screens/training/types';

const at = (y: number, m: number, d: number, h = 7) => new Date(y, m - 1, d, h).getTime();

let n = 0;
function run(
  km: number,
  opts: Partial<ActivitySummary> & Partial<Pick<Activity, 'name' | 'type' | 'shoeId' | 'startTime'>> & { timed?: boolean; ele?: boolean } = {},
): Activity {
  const { name, type, shoeId, startTime, timed = true, ele = true, ...summary } = opts;
  const movingTime = summary.movingTime ?? km * 360;
  const start = startTime ?? at(2026, 10, 1);
  return {
    id: `r${++n}`,
    name: name ?? `Run ${n}`,
    type: type ?? 'run',
    startTime: start,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: start,
    shoeId,
    summary: {
      distance: km * 1000,
      elapsedTime: movingTime,
      movingTime,
      avgPace: timed && km > 0 ? movingTime / km : undefined,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: timed, ele, hr: summary.avgHr !== undefined, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
      ...summary,
    },
  };
}

const f = (over: Partial<RunFilters>): RunFilters => ({ ...emptyFilters(), ...over });
const ids = (list: Activity[]) => list.map((a) => a.id);

describe('applyFilters', () => {
  const short = run(5, { name: 'Easy jog', avgHr: 140, elevationGain: 30 }); // 6:00 /km
  const long = run(21, { name: 'Long run', movingTime: 21 * 330, avgHr: 150, elevationGain: 250, type: 'trail-run', shoeId: 's1' }); // 5:30
  const tempo = run(10, { name: 'Tempo', movingTime: 10 * 270, elevationGain: 80, shoeId: 's2' }); // 4:30, no HR
  const untimed = run(8, { name: 'Untimed walk', timed: false, ele: false, type: 'walk' });
  const all = [short, long, tempo, untimed];

  it('returns everything without filters', () => {
    expect(applyFilters(all, emptyFilters())).toHaveLength(4);
  });

  it('filters by distance (inclusive bounds)', () => {
    expect(ids(applyFilters(all, f({ distanceMin: 10000 })))).toEqual([long.id, tempo.id]);
    expect(ids(applyFilters(all, f({ distanceMax: 8000 })))).toEqual([short.id, untimed.id]);
    expect(ids(applyFilters(all, f({ distanceMin: 8000, distanceMax: 10000 })))).toEqual([tempo.id, untimed.id]);
  });

  it('filters by pace and drops runs without pace only then', () => {
    expect(ids(applyFilters(all, f({ paceMax: 330 })))).toEqual([long.id, tempo.id]);
    expect(ids(applyFilters(all, f({ paceMin: 300 })))).toEqual([short.id, long.id]);
    // Reversed bounds are accepted.
    expect(ids(applyFilters(all, f({ paceMin: 340, paceMax: 300 })))).toEqual([long.id]);
    expect(applyFilters(all, f({ distanceMin: 8000 }))).toContain(untimed);
  });

  it('filters by elevation gain, skipping runs without elevation data', () => {
    expect(ids(applyFilters(all, f({ elevationMin: 200 })))).toEqual([long.id]);
    expect(ids(applyFilters(all, f({ elevationMax: 100 })))).toEqual([short.id, tempo.id]);
  });

  it('filters by average heart rate; hrMin 0 means "has HR"', () => {
    expect(ids(applyFilters(all, f({ hrMin: 145 })))).toEqual([long.id]);
    expect(ids(applyFilters(all, f({ hrMax: 145 })))).toEqual([short.id]);
    expect(ids(applyFilters(all, f({ hrMin: 0 })))).toEqual([short.id, long.id]);
  });

  it('filters by activity type', () => {
    expect(ids(applyFilters(all, f({ activityTypes: ['trail-run', 'walk'] })))).toEqual([long.id, untimed.id]);
  });

  it('filters by workout kind, with unplanned runs', () => {
    const kindOf = new Map<string, WorkoutKind>([
      [long.id, 'long'],
      [tempo.id, 'tempo'],
    ]);
    expect(ids(applyFilters(all, f({ workoutKinds: ['long'] }), { kindOf }))).toEqual([long.id]);
    expect(ids(applyFilters(all, f({ workoutKinds: ['tempo', 'unplanned'] }), { kindOf }))).toEqual([
      short.id,
      tempo.id,
      untimed.id,
    ]);
    // Without plan data every run is unplanned.
    expect(applyFilters(all, f({ workoutKinds: ['unplanned'] }))).toHaveLength(4);
  });

  it('filters by inclusive local date range', () => {
    const a = run(5, { startTime: at(2026, 9, 30, 23) });
    const b = run(5, { startTime: at(2026, 10, 1, 0) });
    const c = run(5, { startTime: at(2026, 10, 3, 22) });
    expect(ids(applyFilters([a, b, c], f({ dateFrom: '2026-10-01' })))).toEqual([b.id, c.id]);
    expect(ids(applyFilters([a, b, c], f({ dateTo: '2026-10-01' })))).toEqual([a.id, b.id]);
    expect(ids(applyFilters([a, b, c], f({ dateFrom: '2026-10-02', dateTo: '2026-10-03' })))).toEqual([c.id]);
  });

  it('combines filters with the name search', () => {
    expect(ids(applyFilters(all, f({ query: 'run', distanceMin: 5000 })))).toEqual([long.id]);
    expect(ids(applyFilters(all, f({ query: 'TEMPO', hrMin: 0 })))).toEqual([]);
  });
});

describe('filter counts', () => {
  it('counts active groups, not the name search', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount(f({ query: 'x' }))).toBe(0);
    expect(hasAnyFilter(f({ query: 'x' }))).toBe(true);
    expect(hasAnyFilter(f({ query: '  ' }))).toBe(false);
    expect(
      activeFilterCount(
        f({ distanceMin: 1, distanceMax: 2, paceMax: 300, hrMin: 0, activityTypes: ['run'], workoutKinds: ['race'], dateTo: '2026-01-01' }),
      ),
    ).toBe(6);
  });
});

describe('query string', () => {
  it('round-trips every filter with compact keys', () => {
    const filters = f({
      query: 'Parque',
      distanceMin: 15000,
      distanceMax: 21097.5,
      paceMin: 270,
      paceMax: 330,
      elevationMin: 200,
      hrMin: 0,
      hrMax: 160,
      activityTypes: ['run', 'trail-run'],
      workoutKinds: ['long', 'unplanned'],
      dateFrom: '2026-01-01',
      dateTo: '2026-10-31',
    });
    const q = filtersToQuery(filters);
    expect(q.get('dmin')).toBe('15');
    expect(q.get('dmax')).toBe('21.098');
    expect(q.get('pmin')).toBe('270');
    expect(q.get('t')).toBe('run,trail-run');
    const back = filtersFromQuery(new URLSearchParams(q.toString()));
    expect(back).toEqual({ ...filters, distanceMax: 21098 });
  });

  it('writes nothing for empty filters and ignores bad values', () => {
    expect(filtersToQuery(emptyFilters()).toString()).toBe('');
    const back = filtersFromQuery(new URLSearchParams('range=4w&dmin=abc&pmax=-3&t=run,bike&k=nope,race&from=2026-1-1&hmin='));
    expect(back).toEqual({ ...emptyFilters(), activityTypes: ['run'], workoutKinds: ['race'] });
  });
});

describe('input parsing', () => {
  it('parses km with dot or comma', () => {
    expect(parseKmInput('')).toBeUndefined();
    expect(parseKmInput(' 15 ')).toBe(15000);
    expect(parseKmInput('10,5')).toBe(10500);
    expect(parseKmInput('0.25')).toBe(250);
    expect(parseKmInput('abc')).toBeNull();
    expect(parseKmInput('-3')).toBeNull();
  });

  it('parses pace as m:ss or minutes', () => {
    expect(parsePaceInput('  ')).toBeUndefined();
    expect(parsePaceInput('5:30')).toBe(330);
    expect(parsePaceInput('4:05')).toBe(245);
    expect(parsePaceInput('6')).toBe(360);
    expect(parsePaceInput('5:75')).toBeNull();
    expect(parsePaceInput('fast')).toBeNull();
  });

  it('parses whole numbers and dates', () => {
    expect(parseWholeInput('')).toBeUndefined();
    expect(parseWholeInput('200')).toBe(200);
    expect(parseWholeInput('150,4', 260)).toBe(150);
    expect(parseWholeInput('300', 260)).toBeNull();
    expect(parseWholeInput('-1')).toBeNull();
    expect(parseWholeInput('1e3')).toBeNull();
    expect(parseDateInput('2026-10-31')).toBe('2026-10-31');
    expect(parseDateInput('')).toBeUndefined();
    expect(parseDateInput('31/10/2026')).toBeNull();
  });
});

describe('presets and chips', () => {
  it('toggles presets on and off', () => {
    const on = togglePreset(emptyFilters(), 'long');
    expect(on.distanceMin).toBe(15000);
    expect(togglePreset(on, 'long').distanceMin).toBeUndefined();
    const replaced = togglePreset(f({ distanceMax: 10000 }), 'long');
    expect(replaced.distanceMin).toBe(15000);
    expect(replaced.distanceMax).toBeUndefined();
  });
});

describe('workoutKindsByActivity', () => {
  it('maps matched runs to their planned workout kind, per plan', () => {
    const plan = (id: string, createdAt: number): TrainingPlan => ({ id, name: id, goal: 'half', createdAt });
    const w = (id: string, planId: string, date: string, kind: WorkoutKind, distance?: number): PlannedWorkout => ({
      id, planId, date, kind, title: '', distance,
    });
    const long = run(18, { startTime: at(2026, 10, 4) });
    const easy = run(6, { startTime: at(2026, 10, 4, 18) });
    const extra = run(5, { startTime: at(2026, 10, 6) });
    const kinds = workoutKindsByActivity(
      [plan('p2', 2), plan('p1', 1)],
      [
        w('w1', 'p1', '2026-10-04', 'long', 18000),
        w('w2', 'p1', '2026-10-04', 'easy', 6000),
        w('w3', 'p2', '2026-10-04', 'race', 18000), // newer plan: p1 wins
        w('w4', 'orphan', '2026-10-06', 'tempo', 5000), // plan deleted
      ],
      [long, easy, extra],
      '2026-11-01',
    );
    expect(kinds.get(long.id)).toBe('long');
    expect(kinds.get(easy.id)).toBe('easy');
    expect(kinds.has(extra.id)).toBe(false);
  });
});
