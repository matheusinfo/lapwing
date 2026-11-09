import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Activity } from '../src/data/types';
import {
  daysAgo,
  formState,
  formToday,
  goalsToday,
  lastRun,
  loadLevel,
  planDay,
  readiness,
  UPCOMING_COUNT,
} from '../src/screens/today/calc';
import type { Goal } from '../src/screens/insights/goals';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';

// Local times, so the tests don't depend on the machine's time zone.
const at = (date: string, hour = 7) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const TODAY = '2026-11-11'; // Wednesday
const NOW = at(TODAY, 18);

let n = 0;
function act(date: string, km: number, extra: Partial<Activity> = {}, summary: Partial<Activity['summary']> = {}): Activity {
  const movingTime = km * 330;
  return {
    id: `a${++n}`,
    name: `Run ${n}`,
    type: 'run',
    startTime: at(date),
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: {
      distance: km * 1000,
      elapsedTime: movingTime,
      movingTime,
      avgPace: 330,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
      ...summary,
    },
    ...extra,
  };
}

const plan = (id: string, extra: Partial<TrainingPlan> = {}): TrainingPlan => ({
  id, name: `Plan ${id}`, goal: '10k', createdAt: 0, ...extra,
});
const wo = (id: string, date: string, kind: PlannedWorkout['kind'], km?: number, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id, planId: 'p1', date, kind, title: '', ...(km ? { distance: km * 1000 } : {}), ...extra,
});

describe('planDay', () => {
  it('is undefined without plans', () => {
    expect(planDay([], null, [], [], TODAY)).toBeUndefined();
  });

  it('uses the plan chosen on the Training screen, or the first one', () => {
    const plans = [plan('p1'), plan('p2')];
    const ws = [wo('a', TODAY, 'easy', 6), wo('b', TODAY, 'long', 15, { planId: 'p2' })];
    expect(planDay(plans, 'p2', ws, [], TODAY)!.today.map((r) => r.workout.id)).toEqual(['b']);
    expect(planDay(plans, 'gone', ws, [], TODAY)!.today.map((r) => r.workout.id)).toEqual(['a']);
    expect(planDay(plans, null, ws, [], TODAY)!.plan.id).toBe('p1');
  });

  it("gives today's workouts with their status and run", () => {
    const run = act(TODAY, 8);
    const ws = [wo('w1', TODAY, 'intervals', 8), wo('w0', '2026-11-10', 'easy', 6)];
    const p = planDay([plan('p1')], 'p1', ws, [run], TODAY)!;
    expect(p.today).toHaveLength(1);
    expect(p.today[0].status).toBe('done');
    expect(p.today[0].activity?.id).toBe(run.id);
    expect(p.workoutOfRun.get(run.id)?.id).toBe('w1');

    const later = planDay([plan('p1')], 'p1', ws, [], TODAY)!;
    expect(later.today[0].status).toBe('upcoming');
  });

  it('lists the next workouts, without rest days or workouts marked by hand', () => {
    const ws = [
      wo('t', TODAY, 'easy', 5),
      wo('r', '2026-11-12', 'rest'),
      wo('s', '2026-11-13', 'tempo', 8, { status: 'skipped' }),
      wo('u3', '2026-11-16', 'easy', 6),
      wo('u1', '2026-11-12', 'intervals', 9),
      wo('u2', '2026-11-14', 'long', 16),
      wo('u4', '2026-11-18', 'easy', 6),
      wo('old', '2026-11-09', 'easy', 6),
    ];
    const p = planDay([plan('p1')], 'p1', ws, [], TODAY)!;
    expect(p.upcoming.map((w) => w.id)).toEqual(['u1', 'u2', 'u3']);
    expect(p.upcoming).toHaveLength(UPCOMING_COUNT);
  });

  it("adds up this week's plan and runs (Monday to Sunday)", () => {
    const ws = [
      wo('mon', '2026-11-09', 'easy', 6),
      wo('tue', '2026-11-10', 'rest'),
      wo('wed', TODAY, 'intervals', 8),
      wo('sat', '2026-11-14', 'long', 14),
      wo('sun', '2026-11-15', 'cross', undefined, { duration: 3600 }),
      wo('manual', '2026-11-11', 'recovery', 4, { status: 'done' }),
      wo('next', '2026-11-16', 'easy', 6),
    ];
    const runs = [act('2026-11-09', 6.2), act('2026-11-08', 20), act('2026-11-10', 3, { type: 'walk' }), act('2026-11-10', 5, { type: 'trail-run' })];
    const w = planDay([plan('p1')], 'p1', ws, runs, TODAY)!.week;
    expect(w.start).toBe('2026-11-09');
    expect(w.planned).toBe(6000 + 8000 + 14000 + 4000);
    // Monday's run, Tuesday's trail run, plus the recovery marked done without a run.
    expect(w.run).toBe(6200 + 5000 + 4000);
    expect(w.total).toBe(5); // rest doesn't count
    expect(w.done).toBe(2); // Monday's run and the manual recovery
  });

  it('counts down to the race until race day', () => {
    const ws = [wo('w', TODAY, 'easy', 5)];
    expect(planDay([plan('p1', { raceDate: '2026-12-06' })], 'p1', ws, [], TODAY)!.daysToRace).toBe(25);
    expect(planDay([plan('p1', { raceDate: TODAY })], 'p1', ws, [], TODAY)!.daysToRace).toBe(0);
    expect(planDay([plan('p1', { raceDate: '2026-11-01' })], 'p1', ws, [], TODAY)!.daysToRace).toBeUndefined();
    expect(planDay([plan('p1')], 'p1', ws, [], TODAY)!.daysToRace).toBeUndefined();
  });
});

describe('form and readiness', () => {
  it('maps form to a state with the History thresholds', () => {
    expect(formState(6)).toBe('fresh');
    expect(formState(5)).toBe('balanced');
    expect(formState(-10)).toBe('balanced');
    expect(formState(-11)).toBe('tired');
  });

  it('needs heart-rate load in the last 42 days', () => {
    expect(formToday([act('2026-11-10', 10)], DEFAULT_SETTINGS, NOW)).toBeUndefined();
    const old = act('2026-08-01', 10, {}, { avgHr: 150 });
    expect(formToday([old], DEFAULT_SETTINGS, NOW)).toBeUndefined();
    // A hard week after a quiet month: fatigue is above fitness.
    const recent = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map((d) => act(d, 12, {}, { avgHr: 165 }));
    const form = formToday([old, ...recent], DEFAULT_SETTINGS, NOW)!;
    expect(form.value).toBeLessThan(-10);
    expect(form.state).toBe('tired');
  });

  it('says when there is no training to judge', () => {
    const r = readiness([], DEFAULT_SETTINGS, NOW);
    expect(r.hasTraining).toBe(false);
    expect(r.alerts).toEqual([]);
    expect(r.form).toBeUndefined();
  });

  it('brings the overload alerts, most severe first', () => {
    const days = Array.from({ length: 11 }, (_, i) => {
      const d = new Date(NOW - i * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const r = readiness(days.map((d) => act(d, 5)), DEFAULT_SETTINGS, NOW);
    expect(r.hasTraining).toBe(true);
    expect(r.alerts).toContainEqual(expect.objectContaining({ kind: 'streak', severity: 'high' }));
    const rank = { info: 0, caution: 1, high: 2 };
    const ranks = r.alerts.map((a) => rank[a.severity]);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
    expect(r.stats.streak).toBe(11);
  });
});

describe('goals, last run and helpers', () => {
  it('sorts goals and computes their progress now', () => {
    const goals: Goal[] = [
      { id: 'm', period: 'month', metric: 'runs', target: 10, createdAt: 1 },
      { id: 'w', period: 'week', metric: 'distance', target: 20000, createdAt: 2 },
    ];
    const list = goalsToday(goals, [act('2026-11-09', 8), act('2026-11-02', 10)], NOW);
    expect(list.map((g) => g.goal.id)).toEqual(['w', 'm']);
    expect(list[0].progress.value).toBe(8000);
    expect(list[1].progress.value).toBe(2);
  });

  it('picks the latest run, ignoring walks and future dates', () => {
    const a = act('2026-11-09', 8);
    const b = act('2026-11-10', 5, { type: 'walk' });
    const c = act('2026-11-20', 10);
    const d = act('2026-11-06', 12, { type: 'trail-run' });
    expect(lastRun([d, a, b, c], NOW)?.id).toBe(a.id);
    expect(lastRun([b], NOW)).toBeUndefined();
    expect(daysAgo(a, TODAY)).toBe(2);
    expect(daysAgo(act(TODAY, 3), TODAY)).toBe(0);
  });

  it('labels training load like the run report', () => {
    expect(loadLevel(49)).toBe('easy');
    expect(loadLevel(50)).toBe('moderate');
    expect(loadLevel(150)).toBe('hard');
    expect(loadLevel(200)).toBe('veryHard');
  });
});
