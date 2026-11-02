import { describe, expect, it } from 'vitest';
import {
  addDays,
  effortRecords,
  fitnessFatigue,
  heatLevel,
  heatmap,
  movingAverage,
  pacePoints,
  percentChange,
  periodFor,
  previousPeriod,
  searchByName,
  sortActivities,
  startOfWeek,
  summaryRecords,
  totals,
  weeklyBuckets,
  type Efforts,
} from '../src/screens/history/aggregate';
import { DEFAULT_SETTINGS, type Activity, type ActivitySummary } from '../src/data/types';

const settings = { ...DEFAULT_SETTINGS };
// Local-time dates, so the tests pass in any time zone.
const at = (y: number, m: number, d: number, h = 7) => new Date(y, m - 1, d, h).getTime();

let n = 0;
function run(start: number, km: number, opts: Partial<ActivitySummary> & { name?: string } = {}): Activity {
  const { name, ...summary } = opts;
  const movingTime = summary.movingTime ?? km * 360;
  return {
    id: `a${++n}`,
    name: name ?? `Run ${n}`,
    type: 'run',
    startTime: start,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: start,
    summary: {
      distance: km * 1000,
      elapsedTime: movingTime,
      movingTime,
      avgPace: km > 0 ? movingTime / km : undefined,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: summary.avgHr !== undefined, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
      ...summary,
    },
  };
}

describe('calendar helpers', () => {
  it('starts weeks on Monday', () => {
    // 2026-11-01 is a Sunday; its week starts on Monday 2026-10-26.
    expect(startOfWeek(at(2026, 11, 1, 22))).toBe(new Date(2026, 9, 26).getTime());
    expect(startOfWeek(at(2026, 10, 26, 0))).toBe(new Date(2026, 9, 26).getTime());
  });
});

describe('periods', () => {
  const now = at(2026, 11, 1, 12); // Sunday

  it('covers whole weeks for 4w and 12w, ending tomorrow at midnight', () => {
    const p = periodFor('4w', now, []);
    expect(p.start).toBe(new Date(2026, 9, 5).getTime()); // Monday 3 weeks before 26 Oct
    expect(p.end).toBe(new Date(2026, 10, 2).getTime());
    expect(periodFor('12w', now, []).start).toBe(new Date(2026, 7, 10).getTime());
  });

  it('starts the year on 1 January and "all" at the first run', () => {
    expect(periodFor('year', now, []).start).toBe(new Date(2026, 0, 1).getTime());
    const p = periodFor('all', now, [run(at(2025, 3, 4), 5), run(at(2026, 1, 1), 5)]);
    expect(p.start).toBe(new Date(2025, 2, 4).getTime());
    expect(previousPeriod('all', p)).toBeNull();
  });

  it('compares with the previous period of the same length', () => {
    const p = periodFor('4w', now, []);
    const prev = previousPeriod('4w', p)!;
    expect(prev.end).toBe(p.start);
    expect(prev.end - prev.start).toBe(p.end - p.start);
  });
});

describe('totals', () => {
  it('sums runs and weights pace and heart rate by time', () => {
    const t = totals(
      [
        run(at(2026, 10, 1), 10, { movingTime: 3000, avgHr: 150, elevationGain: 50 }), // 5:00/km
        run(at(2026, 10, 2), 5, { movingTime: 1800, avgHr: 130, elevationGain: 20 }), // 6:00/km
      ],
      settings,
    );
    expect(t.runs).toBe(2);
    expect(t.distance).toBe(15000);
    expect(t.movingTime).toBe(4800);
    expect(t.elevationGain).toBe(70);
    expect(t.avgPace).toBeCloseTo(320, 5); // 4800 s / 15 km
    expect(t.avgHr).toBeCloseTo((150 * 3000 + 130 * 1800) / 4800, 5);
    expect(t.load).toBeGreaterThan(0);
  });

  it('leaves pace, HR and load empty without data', () => {
    const t = totals([], settings);
    expect(t.avgPace).toBeUndefined();
    expect(t.avgHr).toBeUndefined();
    expect(t.load).toBeUndefined();
  });

  it('computes percent change', () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 10)).toBe(-50);
    expect(percentChange(5, 0)).toBeUndefined();
    expect(percentChange(undefined, 3)).toBeUndefined();
  });
});

describe('weeklyBuckets', () => {
  it('includes empty weeks and groups by Monday', () => {
    const now = at(2026, 11, 1, 12);
    const p = periodFor('4w', now, []);
    const buckets = weeklyBuckets(
      [
        run(at(2026, 10, 5, 6), 8), // Monday of week 1
        run(at(2026, 10, 11, 20), 12), // Sunday of week 1
        run(at(2026, 10, 27), 6), // week 4
        run(at(2026, 9, 1), 30), // before the period
      ],
      p,
    );
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.distance / 1000)).toEqual([20, 0, 0, 6]);
    expect(buckets[0].runs).toBe(2);
    expect(buckets[0].weekStart).toBe(new Date(2026, 9, 5).getTime());
  });
});

describe('pace trend', () => {
  it('lists timed runs oldest first', () => {
    const p = { start: at(2026, 10, 1, 0), end: at(2026, 11, 1, 0) };
    const pts = pacePoints([run(at(2026, 10, 9), 5), run(at(2026, 10, 3), 5), run(at(2026, 9, 3), 5)], p);
    expect(pts.map((x) => new Date(x.time).getDate())).toEqual([3, 9]);
  });

  it('smooths with a centered moving average', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([1.5, 2, 3, 4, 4.5]);
    expect(movingAverage([], 5)).toEqual([]);
  });
});

describe('fitnessFatigue', () => {
  it('builds up fitness slowly and fatigue quickly, and decays on rest', () => {
    const acts = [];
    for (let d = 0; d < 14; d++) acts.push(run(addDays(at(2026, 10, 1), d), 10, { movingTime: 3600, avgHr: 150 }));
    const days = fitnessFatigue(acts, settings, at(2026, 10, 30));
    expect(days).toHaveLength(30);
    const day14 = days[13];
    expect(day14.fatigue).toBeGreaterThan(day14.fitness);
    expect(day14.form).toBeLessThan(0);
    // 16 days of rest afterwards: fatigue drops below fitness, form turns positive.
    const last = days[days.length - 1];
    expect(last.load).toBe(0);
    expect(last.fatigue).toBeLessThan(day14.fatigue);
    expect(last.form).toBeGreaterThan(0);
  });

  it('is empty without heart rate', () => {
    expect(fitnessFatigue([run(at(2026, 10, 1), 5)], settings, at(2026, 10, 5))).toEqual([]);
  });
});

describe('records', () => {
  it('picks the fastest effort per distance', () => {
    const a = run(at(2026, 10, 1), 10), b = run(at(2026, 10, 5), 6);
    const efforts = new Map<string, Efforts>([
      [a.id, { 1000: 250, 5000: 1400, 10000: 2900 }],
      [b.id, { 1000: 240, 5000: 1450 }],
    ]);
    const rec = effortRecords([a, b], efforts);
    expect(rec.map((r) => [r.distance, r.time, r.activity.id])).toEqual([
      [1000, 240, b.id],
      [5000, 1400, a.id],
      [10000, 2900, a.id],
    ]);
  });

  it('finds longest, biggest climb and fastest 5 km+ pace', () => {
    const long = run(at(2026, 10, 1), 21, { movingTime: 21 * 380 });
    const hilly = run(at(2026, 10, 2), 8, { elevationGain: 300, movingTime: 8 * 330 });
    const fastShort = run(at(2026, 10, 3), 3, { movingTime: 3 * 240 });
    const r = summaryRecords([long, hilly, fastShort]);
    expect(r.longest?.id).toBe(long.id);
    expect(r.biggestClimb?.id).toBe(hilly.id);
    expect(r.fastestPace?.id).toBe(hilly.id); // the 3 km run is too short
  });
});

describe('heatmap', () => {
  it('lays out weeks Monday-first with distances and future days', () => {
    const now = at(2026, 10, 28, 12); // Wednesday
    const p = periodFor('4w', now, []);
    const grid = heatmap([run(at(2026, 10, 26), 7), run(at(2026, 10, 26, 18), 4)], p, now);
    expect(grid).toHaveLength(12); // at least 12 weeks
    const lastWeek = grid[grid.length - 1];
    expect(new Date(lastWeek[0].day).getDay()).toBe(1); // Monday
    expect(lastWeek[0].distance).toBe(11000);
    expect(lastWeek[0].runs).toBe(2);
    expect(lastWeek[2].future).toBe(false); // today
    expect(lastWeek[3].future).toBe(true);
    expect(heatmap([], periodFor('year', at(2026, 12, 31), []), at(2026, 12, 31))).toHaveLength(53);
  });

  it('bins distance into levels', () => {
    expect([0, 3000, 7000, 12000, 21000].map(heatLevel)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('table sort and search', () => {
  const a = run(at(2026, 10, 1), 10, { name: 'Longão', avgHr: 140 });
  const b = run(at(2026, 10, 2), 5, { name: 'Corrida leve' });
  const c = run(at(2026, 10, 3), 8, { name: 'Tempo run', avgHr: 160 });

  it('sorts by any column, missing values last', () => {
    expect(sortActivities([a, b, c], 'distance', 'desc', settings).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(sortActivities([a, b, c], 'date', 'desc', settings).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect(sortActivities([a, b, c], 'hr', 'asc', settings).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(sortActivities([a, b, c], 'hr', 'desc', settings).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(sortActivities([a, b, c], 'name', 'asc', settings).map((x) => x.name)).toEqual([
      'Corrida leve',
      'Longão',
      'Tempo run',
    ]);
  });

  it('searches ignoring case and accents', () => {
    expect(searchByName([a, b, c], 'LONGAO').map((x) => x.id)).toEqual([a.id]);
    expect(searchByName([a, b, c], '  ')).toHaveLength(3);
  });
});
