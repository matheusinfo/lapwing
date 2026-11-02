import { describe, expect, it } from 'vitest';
import { computeSummary } from '../src/data/analysis';
import { DEFAULT_SETTINGS, type Activity, type TrackPoint } from '../src/data/types';
import { buildStreams, type Split } from '../src/screens/activity/calc';
import {
  alignedSamples,
  compareSplits,
  compareValues,
  effortRows,
  metricRows,
  runMetrics,
  similarRuns,
  splitRows,
  timeGap,
} from '../src/screens/compare/calc';

/** A straight run heading east, one point per second, at a constant pace (s/km). */
function steadyRun(metres: number, pace: number, opts: { hr?: number; ele?: boolean } = {}): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const speed = 1000 / pace;
  for (let t = 0, m = 0; m <= metres; t++, m = t * speed) {
    pts.push({
      lat: 0,
      lon: m / 111320,
      time: 1_700_000_000_000 + t * 1000,
      ...(opts.hr !== undefined ? { hr: opts.hr } : {}),
      ...(opts.ele ? { ele: 100 + m / 100 } : {}),
    });
  }
  return pts;
}

let n = 0;
function activity(points: TrackPoint[], extra: Partial<Activity> = {}): Activity {
  return {
    id: `r${++n}`,
    name: `Run ${n}`,
    type: 'run',
    startTime: points[0].time ?? 0,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: computeSummary(points),
    ...extra,
  };
}

describe('compareValues', () => {
  it('gives B − A and judges direction', () => {
    expect(compareValues(300, 290, 'lower')).toEqual({ diff: -10, verdict: 'better' });
    expect(compareValues(300, 310, 'lower')).toEqual({ diff: 10, verdict: 'worse' });
    expect(compareValues(50, 60, 'higher')?.verdict).toBe('better');
    expect(compareValues(300, 300.4, 'lower', 0.5)?.verdict).toBe('same');
    expect(compareValues(5000, 8000, 'neutral')).toEqual({ diff: 3000, verdict: 'neutral' });
    expect(compareValues(undefined, 3, 'lower')).toBeUndefined();
  });
});

describe('summary rows', () => {
  it('compares the headline metrics, pace with a verdict', () => {
    const pa = steadyRun(5000, 330, { hr: 150, ele: true });
    const pb = steadyRun(5200, 300, { hr: 160 });
    const a = runMetrics(activity(pa, { rpe: 4 }), pa, DEFAULT_SETTINGS);
    const b = runMetrics(activity(pb), pb, DEFAULT_SETTINGS);
    const rows = metricRows(a, b);
    const row = (k: string) => rows.find((r) => r.key === k)!;

    expect(row('avgPace').delta?.verdict).toBe('better');
    expect(row('avgPace').delta!.diff).toBeCloseTo(-30, 0);
    expect(row('distance').delta?.verdict).toBe('neutral');
    expect(row('distance').delta!.diff).toBeCloseTo(200, -1);
    expect(row('load').a).toBeGreaterThan(0);
    expect(row('load').b).toBeGreaterThan(0);
    // Only A has elevation and RPE: the row stays, without a delta.
    expect(row('elevGain').b).toBeUndefined();
    expect(row('elevGain').delta).toBeUndefined();
    expect(row('rpe').a).toBe(4);
    // Neither has power: no row.
    expect(rows.some((r) => r.key === 'avgPower')).toBe(false);
  });
});

describe('effortRows', () => {
  it('lists the distances both runs cover, faster is better', () => {
    const a = buildStreams(steadyRun(5500, 330));
    const b = buildStreams(steadyRun(10500, 300));
    const rows = effortRows(a, b);
    expect(rows.map((r) => r.key)).toEqual(['effort400', 'effort1k', 'effortMile', 'effort5k']);
    const k5 = rows.find((r) => r.key === 'effort5k')!;
    expect(k5.a).toBeCloseTo(1650, -1);
    expect(k5.b).toBeCloseTo(1500, -1);
    expect(k5.delta.verdict).toBe('better');
  });

  it('is empty without timestamps', () => {
    const noTime = steadyRun(3000, 300).map(({ time: _t, ...p }) => p);
    expect(effortRows(buildStreams(noTime), buildStreams(steadyRun(3000, 300)))).toEqual([]);
  });
});

describe('splits side by side', () => {
  it('pairs km splits and diffs the pace', () => {
    const rows = compareSplits(buildStreams(steadyRun(3500, 330)), buildStreams(steadyRun(2500, 300)));
    expect(rows).toHaveLength(4);
    expect(rows[0].paceDelta!.diff).toBeCloseTo(-30, 0);
    expect(rows[0].paceDelta!.verdict).toBe('better');
    expect(rows[2].b?.partial).toBe(true);
    expect(rows[3].b).toBeUndefined();
    expect(rows[3].paceDelta).toBeUndefined();
  });

  it('handles splits without pace', () => {
    const s = (km: number, pace?: number): Split => ({ km, distance: 1000, pace, partial: false });
    const rows = splitRows([s(1, 300), s(2)], [s(1, 310)]);
    expect(rows[0].paceDelta?.verdict).toBe('worse');
    expect(rows[1].paceDelta).toBeUndefined();
  });
});

describe('aligned samples and time gap', () => {
  const a = buildStreams(steadyRun(4000, 330));
  const b = buildStreams(steadyRun(5000, 300));

  it('samples both runs on the same distance grid', () => {
    const s = alignedSamples(a, b, 50);
    expect(s.a[10].d).toBe(500);
    expect(s.b[10].d).toBe(500);
    expect(s.b.length).toBeGreaterThan(s.a.length);
    expect(s.a[20].pace).toBeCloseTo(330, -1);
  });

  it('grows the gap as the faster run pulls ahead', () => {
    const gap = timeGap(a, b, 100);
    expect(gap[0]).toEqual({ d: 0, ahead: 0 });
    const last = gap[gap.length - 1];
    expect(last.d).toBeCloseTo(a.total, 3); // Stops where the shorter run ends.
    expect(last.ahead).toBeCloseTo(120, -1); // 30 s/km × 4 km
    expect(gap[20].ahead).toBeCloseTo(60, -1);
    expect(timeGap(b, a, 100)[20].ahead).toBeCloseTo(-60, -1);
  });

  it('is empty without timestamps', () => {
    const noTime = buildStreams(steadyRun(3000, 300).map(({ time: _t, ...p }) => p));
    expect(timeGap(noTime, b)).toEqual([]);
  });
});

describe('similarRuns', () => {
  it('suggests runs of similar distance, same type first', () => {
    const mk = (km: number, type: Activity['type'] = 'run') => {
      const act = activity(steadyRun(200, 300), { type });
      act.summary = { ...act.summary, distance: km * 1000 };
      return act;
    };
    const ref = mk(10);
    const near = mk(10.4), far = mk(5), walk = mk(10, 'walk'), mid = mk(12);
    const list = similarRuns([ref, far, walk, near, mid], ref, 3);
    expect(list.map((x) => x.id)).toEqual([near.id, mid.id, far.id]);
    expect(similarRuns([ref, near, mid], ref, 3, [near.id]).map((x) => x.id)).toEqual([mid.id]);
  });
});
