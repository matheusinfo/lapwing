import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Activity, type ActivitySummary, type ActivityType } from '../src/data/types';
import {
  goalHistory,
  goalProgress,
  goalStreak,
  goalValue,
  hoursInput,
  parseHours,
  parseKm,
  parseRuns,
  periodRange,
  sortGoals,
  type Goal,
} from '../src/screens/insights/goals';
import {
  HALF_MARATHON,
  MARATHON,
  bestVdot,
  chooseSource,
  collectEfforts,
  predictRaces,
  predictionRuns,
  riegel,
  trainingPaces,
  vdot,
  vdotRaceTime,
  type Effort,
} from '../src/screens/insights/predictions';
import {
  dailySummaries,
  hardReason,
  median,
  medianPace,
  overloadReport,
  rollingMean,
  trainingStreak,
} from '../src/screens/insights/overload';
import type { Efforts } from '../src/screens/history/aggregate';

const settings = { ...DEFAULT_SETTINGS }; // maxHr 190 → zone 4 starts at 152 bpm
// Local-time dates, so the tests pass in any time zone.
const at = (y: number, m: number, d: number, h = 7) => new Date(y, m - 1, d, h).getTime();
const DAY = 86_400_000;

let n = 0;
type RunOpts = Partial<ActivitySummary> & { type?: ActivityType; rpe?: number; name?: string };
function run(start: number, km: number, opts: RunOpts = {}): Activity {
  const { type, rpe, name, ...summary } = opts;
  const movingTime = summary.movingTime ?? km * 360; // 6:00/km
  return {
    id: `a${++n}`,
    name: name ?? `Run ${n}`,
    type: type ?? 'run',
    startTime: start,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: start,
    rpe,
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

const goal = (g: Partial<Goal>): Goal => ({
  id: 'g',
  period: 'week',
  metric: 'distance',
  target: 30000,
  createdAt: 0,
  ...g,
});

// ---------------------------------------------------------------- goals

describe('goal periods', () => {
  it('uses Monday weeks and calendar months', () => {
    // Wednesday 2026-10-28.
    const w = periodRange('week', at(2026, 10, 28, 15));
    expect(w.start).toBe(new Date(2026, 9, 26).getTime());
    expect(w.end).toBe(new Date(2026, 10, 2).getTime());
    const m = periodRange('month', at(2026, 2, 14));
    expect(m.start).toBe(new Date(2026, 1, 1).getTime());
    expect(m.end).toBe(new Date(2026, 2, 1).getTime());
  });
});

describe('goal progress', () => {
  const now = at(2026, 10, 28, 20); // Wednesday: day 3 of 7
  const acts = [
    run(at(2026, 10, 26), 8),
    run(at(2026, 10, 27), 4, { type: 'trail-run' }),
    run(at(2026, 10, 28), 3, { type: 'walk' }), // walks don't count by default
    run(at(2026, 10, 25), 20), // previous week
  ];

  it('sums the metric for the current period and counted types', () => {
    const p = goalProgress(goal({}), acts, now);
    expect(p.value).toBe(12000);
    expect(p.pct).toBeCloseTo(40);
    expect(p.remaining).toBe(18000);
    expect(p.daysTotal).toBe(7);
    expect(p.daysElapsed).toBe(3);
    expect(p.daysLeft).toBe(5);
    expect(p.projected).toBeCloseTo(28000); // 12 km / 3 days × 7
    expect(p.perDayNeeded).toBeCloseTo(3600);
    // Expected by the end of Tuesday: 30 × 2/7 ≈ 8.57 km → on track.
    expect(p.status).toBe('on-track');
  });

  it('respects activity types, time and run-count metrics', () => {
    expect(goalValue(goal({ activityTypes: ['walk'] }), acts, periodRange('week', now))).toBe(3000);
    const time = goalProgress(goal({ metric: 'time', target: 3600 * 3 }), acts, now);
    expect(time.value).toBe(12 * 360);
    const runs = goalProgress(goal({ metric: 'runs', target: 2 }), acts, now);
    expect(runs.value).toBe(2);
    expect(runs.status).toBe('achieved');
    expect(runs.remaining).toBe(0);
    expect(runs.perDayNeeded).toBe(0);
  });

  it('is behind when below the pro-rata share and the projection', () => {
    const sat = at(2026, 10, 31, 9); // day 6: expected 30 × 5/7 ≈ 21.4 km
    const p = goalProgress(goal({}), acts, sat);
    expect(p.projected).toBeCloseTo((12000 / 6) * 7);
    expect(p.status).toBe('behind');
  });

  it('starts every period on track', () => {
    const monday = at(2026, 11, 2, 6);
    expect(goalProgress(goal({}), acts, monday).status).toBe('on-track');
  });

  it('handles month lengths', () => {
    const p = goalProgress(goal({ period: 'month', target: 100000 }), acts, at(2026, 10, 28));
    expect(p.daysTotal).toBe(31);
    expect(p.daysElapsed).toBe(28);
    expect(p.value).toBe(32000); // 20 + 8 + 4
  });
});

describe('goal history and streak', () => {
  const now = at(2026, 11, 4); // Wednesday
  // Weeks starting Oct 5, 12, 19, 26 and Nov 2.
  const acts = [
    run(at(2026, 10, 6), 32), // hit
    run(at(2026, 10, 13), 31), // hit
    run(at(2026, 10, 20), 10), // miss
    run(at(2026, 10, 27), 30), // hit
    run(at(2026, 10, 30), 5), // same week, total 35 → hit
    run(at(2026, 11, 3), 10), // current week, in progress
  ];

  it('lists periods oldest first, ending with the current one, from the first activity', () => {
    const h = goalHistory(goal({}), acts, now, 8, at(2026, 10, 6));
    expect(h.map((p) => p.hit)).toEqual([true, true, false, true, false]);
    expect(h[h.length - 1].current).toBe(true);
    expect(h[0].start).toBe(new Date(2026, 9, 5).getTime());
    expect(goalHistory(goal({}), acts, now, 3).length).toBe(3);
  });

  it('counts consecutive hit periods; the running period never breaks it', () => {
    expect(goalStreak(goal({}), acts, now)).toBe(1);
    const more = [...acts, run(at(2026, 11, 4), 25)];
    expect(goalStreak(goal({}), more, now)).toBe(2); // current achieved adds one
    expect(goalStreak(goal({ target: 10000 }), acts, now)).toBe(5);
  });

  it('sorts weekly before monthly, then by metric', () => {
    const list = sortGoals([
      goal({ id: '1', period: 'month', metric: 'runs' }),
      goal({ id: '2', period: 'week', metric: 'time' }),
      goal({ id: '3', period: 'week', metric: 'distance' }),
    ]);
    expect(list.map((g) => g.id)).toEqual(['3', '2', '1']);
  });
});

describe('goal form parsing', () => {
  it('parses km, hours and runs', () => {
    expect(parseKm('42,5')).toBe(42500);
    expect(parseKm('0')).toBeNull();
    expect(parseKm('abc')).toBeNull();
    expect(parseHours('4:30')).toBe(4.5 * 3600);
    expect(parseHours('5h')).toBe(5 * 3600);
    expect(parseHours('1h15')).toBe(4500);
    expect(parseHours('2.5')).toBe(9000);
    expect(parseHours('0:00')).toBeNull();
    expect(parseRuns('4')).toBe(4);
    expect(parseRuns('2.5')).toBeNull();
    expect(hoursInput(4.5 * 3600)).toBe('4:30');
  });
});

// ---------------------------------------------------------------- predictions

const effort = (km: number, time: number, wholeRun = false, a = run(at(2026, 10, 1), km)): Effort => ({
  distance: km * 1000,
  time,
  activity: a,
  wholeRun,
});

describe('Riegel predictions', () => {
  it('applies T2 = T1 × (D2/D1)^1.06', () => {
    expect(riegel(1200, 5000, 10000)).toBeCloseTo(1200 * Math.pow(2, 1.06), 6);
    expect(riegel(1200, 5000, 5000)).toBe(1200);
  });

  it('prefers the closest distance of at least 3 km', () => {
    const fast1k = effort(1, 180); // would predict a very fast 10K
    const tenK = effort(10, 2700);
    const fiveK = effort(5, 1300);
    expect(chooseSource(10000, [fast1k, fiveK, tenK])).toBe(tenK);
    expect(chooseSource(5000, [fast1k, fiveK, tenK])).toBe(fiveK);
  });

  it('picks the fastest prediction among similar distances', () => {
    const hard8k = effort(8, 8 * 240); // 4:00/km
    const easy10k = effort(10, 10 * 330, true); // 5:30/km whole run
    expect(chooseSource(10000, [hard8k, easy10k])).toBe(hard8k);
    // A 5K is too far from the marathon when a 25 km run exists.
    const long = effort(25, 25 * 330, true);
    const fast5k = effort(5, 1100);
    expect(chooseSource(MARATHON, [fast5k, long])).toBe(long);
  });

  it('falls back to short efforts and flags them', () => {
    const preds = predictRaces([effort(1, 240)], [run(at(2026, 10, 1), 2)]);
    expect(preds).toHaveLength(4);
    expect(preds.every((p) => p.caveats.includes('shortOnly'))).toBe(true);
    expect(preds[3].caveats).toContain('noLongRun');
    expect(preds[3].caveats).toContain('farExtrapolation');
  });

  it('predicts all four races with pace and source, and no marathon caveat after a long run', () => {
    const long = run(at(2026, 10, 10), 28, { movingTime: 28 * 330 });
    const e: Efforts = { 1000: 230, 5000: 1250, 10000: 2600, 21097.5: 5800 };
    const efforts = collectEfforts([long], new Map([[long.id, e]]));
    expect(efforts.filter((x) => x.wholeRun)).toHaveLength(1);
    const preds = predictRaces(efforts, [long]);
    expect(preds.map((p) => p.distance)).toEqual([5000, 10000, HALF_MARATHON, MARATHON]);
    expect(preds[0].time).toBeCloseTo(1250, 6);
    expect(preds[0].source.wholeRun).toBe(false);
    expect(preds[3].caveats).not.toContain('noLongRun');
    expect(preds[1].pace).toBeCloseTo(260, 6);
  });

  it('returns nothing without timed runs, and filters by window and type', () => {
    expect(predictRaces([], [])).toEqual([]);
    const untimed = run(at(2026, 10, 1), 5);
    untimed.summary.has.time = false;
    const trail = run(at(2026, 10, 1), 5, { type: 'trail-run' });
    const old = run(at(2026, 1, 1), 5);
    const recent = run(at(2026, 10, 20), 5);
    expect(predictionRuns([untimed, trail, old, recent], at(2026, 8, 1))).toEqual([recent]);
  });
});

describe('VDOT', () => {
  it('matches the Daniels tables', () => {
    expect(vdot(5000, 20 * 60)).toBeCloseTo(49.8, 1);
    expect(vdot(10000, 40 * 60)).toBeCloseTo(51.9, 1);
    // Inverse: VDOT 50 runs a 5K in about 19:57.
    expect(vdotRaceTime(vdot(5000, 1200), 5000)).toBeCloseTo(1200, 0);
    expect(vdotRaceTime(50, MARATHON) / 3600).toBeGreaterThan(3.1);
    expect(vdotRaceTime(50, MARATHON) / 3600).toBeLessThan(3.25);
  });

  it('derives ordered training paces and picks the best effort ≥ 3 km', () => {
    const p = trainingPaces(50);
    expect(p.easy[0]).toBeGreaterThan(p.easy[1]);
    expect(p.easy[1]).toBeGreaterThan(p.marathon);
    expect(p.marathon).toBeGreaterThan(p.threshold);
    expect(p.threshold).toBeGreaterThan(p.interval);
    expect(p.interval).toBeGreaterThan(p.repetition);
    expect(p.threshold).toBeCloseTo(255, -1); // ≈ 4:15 /km
    const best = bestVdot([effort(1, 150), effort(5, 1300), effort(10, 2500)]);
    expect(best?.source.distance).toBe(10000);
    expect(bestVdot([effort(1, 200)])).toBeUndefined();
  });
});

// ---------------------------------------------------------------- overload

describe('overload helpers', () => {
  it('computes median, rolling mean and streaks', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
    expect(rollingMean([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
    const now = at(2026, 11, 1, 6); // nothing yet today
    const acts = [1, 2, 3, 4].map((d) => run(now - d * DAY, 5));
    expect(trainingStreak(acts, now)).toBe(4);
    expect(trainingStreak([...acts, run(now - 6 * DAY, 5)], now)).toBe(4);
    expect(trainingStreak([run(now - 2 * DAY, 5)], now)).toBe(0);
  });

  it('classifies hard sessions by HR, RPE, or pace as a fallback', () => {
    expect(hardReason(run(0, 10, { avgHr: 160 }), settings)).toBe('hr');
    expect(hardReason(run(0, 10, { avgHr: 140 }), settings, 300)).toBeUndefined();
    expect(hardReason(run(0, 10, { rpe: 8 }), settings)).toBe('rpe');
    expect(hardReason(run(0, 10, { movingTime: 2700 }), settings, 330)).toBe('pace'); // 4:30 vs 5:30
    expect(hardReason(run(0, 10, { movingTime: 3200 }), settings, 330)).toBeUndefined();
    // Easy HR wins over a fast pace.
    expect(hardReason(run(0, 10, { movingTime: 2700, avgHr: 130 }), settings, 330)).toBeUndefined();
  });

  it('needs 5 runs for a median pace', () => {
    const now = at(2026, 11, 1);
    const runs = [1, 2, 3, 4].map((d) => run(now - d * DAY, 5));
    expect(medianPace(runs, now)).toBeUndefined();
    expect(medianPace([...runs, run(now - 5 * DAY, 5)], now)).toBe(360);
  });

  it('builds 56 local days ending today and ignores walks', () => {
    const now = at(2026, 11, 1, 20);
    const days = dailySummaries([run(at(2026, 11, 1), 5), run(at(2026, 11, 1), 3, { type: 'walk' })], settings, now);
    expect(days).toHaveLength(56);
    expect(days[55].day).toBe(new Date(2026, 10, 1).getTime());
    expect(days[55].distance).toBe(5000);
    expect(days[55].sessions).toBe(1);
  });
});

/** Steady base: 4 runs a week (Mon, Wed, Fri, Sun) of `km` for `weeks` weeks before `now`'s week. */
function base(now: number, weeks: number, km: number, opts: RunOpts = {}): Activity[] {
  const out: Activity[] = [];
  for (let d = 7; d < 7 + weeks * 7; d++) {
    if (d % 2 === 1) out.push(run(now - d * DAY, km, opts));
  }
  return out;
}

describe('overload alerts', () => {
  const now = at(2026, 11, 1, 20);

  it('reports nothing for steady, balanced training', () => {
    const acts = [...base(now, 5, 8), run(now - 1 * DAY, 8), run(now - 3 * DAY, 8), run(now - 5 * DAY, 8)];
    const r = overloadReport(acts, settings, now);
    expect(r.alerts).toEqual([]);
    expect(r.stats.acwrDistance).toBeGreaterThan(0.8);
    expect(r.stats.acwrDistance).toBeLessThan(1.3);
  });

  it('flags a high acute:chronic ratio and a weekly jump', () => {
    const acts = [...base(now, 5, 5), ...[0, 2, 4, 6].map((d) => run(now - d * DAY, 12))];
    const r = overloadReport(acts, settings, now);
    const acwr = r.alerts.find((a) => a.kind === 'acwrDistance');
    expect(acwr?.severity).toBe('high');
    expect(acwr?.data.acute).toBe(48000);
    const jump = r.alerts.find((a) => a.kind === 'weeklyJump');
    expect(jump?.severity).toBe('high');
    expect(jump?.data.change).toBeGreaterThan(0.3);
    expect(r.alerts[0].severity).toBe('high');
  });

  it('flags a moderate weekly jump as caution without an ACWR alert', () => {
    // Days 8–28: 11 runs × 10 km = 110 km → 36.7 km/week. Last 7 days: 3 × 14 = 42 km (+14.5 %).
    // ACWR = 42 / (152 / 4) = 1.1 → no ratio alert.
    const acts = [...base(now, 3, 10), ...[0, 2, 4].map((d) => run(now - d * DAY, 14))];
    const r = overloadReport(acts, settings, now);
    expect(r.stats.previousWeeksAvg).toBeCloseTo(110000 / 3);
    expect(r.alerts.find((a) => a.kind === 'acwrDistance')).toBeUndefined();
    const jump = r.alerts.find((a) => a.kind === 'weeklyJump');
    expect(jump?.severity).toBe('caution');
    expect(jump?.data.change).toBeCloseTo(42 / (110 / 3) - 1, 6);
  });

  it('uses caution for a ratio between 1.3 and 1.5', () => {
    // Days 8–28: 110 km; last 7 days 60 km → ACWR = 60 / (170 / 4) = 1.41.
    const acts = [...base(now, 3, 10), ...[0, 2, 4].map((d) => run(now - d * DAY, 20))];
    const a = overloadReport(acts, settings, now).alerts.find((x) => x.kind === 'acwrDistance');
    expect(a?.severity).toBe('caution');
    expect(a?.data.ratio).toBeCloseTo(60 / 42.5, 6);
  });

  it('reports detraining as info after a meaningful history', () => {
    const acts = [...base(now, 4, 10), run(now - 2 * DAY, 5)];
    const r = overloadReport(acts, settings, now);
    const a = r.alerts.find((x) => x.kind === 'detrainingDistance');
    expect(a?.severity).toBe('info');
    expect(a?.data.ratio).toBeLessThan(0.8);
  });

  it('skips ratio checks with less than 3 weeks of history', () => {
    const acts = [0, 1, 2].map((d) => run(now - d * DAY * 2, 10));
    const r = overloadReport(acts, settings, now);
    expect(r.stats.acwrDistance).toBeUndefined();
    expect(r.alerts.find((a) => a.kind.startsWith('acwr'))).toBeUndefined();
  });

  it('flags consecutive training days', () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => run(now - d * DAY, 5));
    expect(overloadReport(six, settings, now).alerts.find((a) => a.kind === 'streak')?.severity).toBe('caution');
    const ten = Array.from({ length: 10 }, (_, d) => run(now - d * DAY, 5));
    const streak = overloadReport(ten, settings, now).alerts.find((a) => a.kind === 'streak');
    expect(streak?.severity).toBe('high');
    expect(streak?.data.days).toBe(10);
  });

  it('flags too few rest days in 14 days when the streak is short', () => {
    // Trains every day for 14 days except one rest day 3 days ago.
    const acts = Array.from({ length: 14 }, (_, d) => d)
      .filter((d) => d !== 3)
      .map((d) => run(now - d * DAY, 5));
    const r = overloadReport(acts, settings, now);
    expect(r.stats.streak).toBe(3);
    expect(r.alerts.find((a) => a.kind === 'fewRestDays')?.data.restDays14).toBe(1);
  });

  it('flags many hard sessions, back-to-back hard days and a high hard share', () => {
    const acts = [
      ...base(now, 4, 8, { avgHr: 135 }),
      run(now - 0 * DAY, 10, { avgHr: 165 }),
      run(now - 1 * DAY, 10, { rpe: 9 }),
      run(now - 3 * DAY, 10, { avgHr: 160 }),
      run(now - 5 * DAY, 6, { avgHr: 130 }),
    ];
    const r = overloadReport(acts, settings, now);
    const kinds = r.alerts.map((a) => a.kind);
    expect(kinds).toContain('hardSessions');
    expect(kinds).toContain('backToBackHard');
    expect(kinds).toContain('hardShare');
    expect(r.stats.hardSessions7).toBe(3);
    const b2b = r.alerts.find((a) => a.kind === 'backToBackHard')!;
    expect(b2b.data.secondDay - b2b.data.firstDay).toBeGreaterThan(22 * 3600_000);
  });

  it('uses training load only when most sessions have HR', () => {
    const withHr = [...base(now, 4, 8, { avgHr: 140 }), run(now - DAY, 8, { avgHr: 140 })];
    const r = overloadReport(withHr, settings, now);
    expect(r.stats.loadReliable).toBe(true);
    expect(r.stats.acwrLoad).toBeDefined();
    const noHr = [...base(now, 4, 8), run(now - DAY, 8)];
    expect(overloadReport(noHr, settings, now).stats.loadReliable).toBe(false);
    expect(overloadReport(noHr, settings, now).stats.acwrLoad).toBeUndefined();
  });

  it('flags a load spike on heart-rate data', () => {
    const acts = [
      ...base(now, 4, 6, { avgHr: 130 }),
      ...[0, 1, 3, 5].map((d) => run(now - d * DAY, 14, { avgHr: 150, movingTime: 14 * 330 })),
    ];
    const a = overloadReport(acts, settings, now).alerts.find((x) => x.kind === 'acwrLoad');
    expect(a?.severity).toBe('high');
    expect(a!.data.ratio).toBeGreaterThan(1.5);
  });
});
