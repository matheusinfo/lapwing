import { describe, expect, it } from 'vitest';
import type { Activity } from '../src/data/types';
import { addDays, diffDays, isDateStr, localDateOf, parseDateInput, weekday, weekStart } from '../src/screens/training/dates';
import { manualDoneDistance, matchWorkouts, plannedDistance } from '../src/screens/training/matching';
import { computeProgress } from '../src/screens/training/progress';
import { generatePlan, TEMPLATES, type GenText } from '../src/screens/training/generator';
import { csvTemplate, exportPlanCsv, jsonTemplate, parseDuration, parsePlanCsv, parsePlanFile, parsePlanJson, splitCsv } from '../src/screens/training/csv';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';

const TZ = 'America/Sao_Paulo';

describe('dates', () => {
  it('uses the local calendar day of a timestamp', () => {
    // 01:30 UTC on Oct 31 is still Oct 30 in São Paulo (UTC−3).
    expect(localDateOf(Date.UTC(2026, 9, 31, 1, 30), TZ)).toBe('2026-10-30');
    expect(localDateOf(Date.UTC(2026, 9, 31, 3, 0), TZ)).toBe('2026-10-31');
  });

  it('starts weeks on Monday', () => {
    expect(weekday('2026-11-02')).toBe(0); // Monday
    expect(weekday('2026-11-01')).toBe(6); // Sunday
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-11-01', '2026-11-22')).toBe(21);
  });

  it('validates and parses date input', () => {
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(parseDateInput('03/11/2026')).toBe('2026-11-03');
    expect(parseDateInput('2026-11-03')).toBe('2026-11-03');
    expect(parseDateInput('31/02/2026')).toBeUndefined();
    expect(parseDateInput('tomorrow')).toBeUndefined();
  });
});

// ---- Matching ----

let n = 0;
function run(date: string, km: number, hour = 9, type: Activity['type'] = 'run'): Activity {
  const [y, m, d] = date.split('-').map(Number);
  return {
    id: `a${++n}`,
    name: 'Run',
    type,
    startTime: Date.UTC(y, m - 1, d, hour + 3), // local São Paulo hour
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: {
      distance: km * 1000,
      elapsedTime: km * 360,
      movingTime: km * 360,
      avgPace: 360,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
    },
  };
}
const wo = (id: string, date: string, kind: PlannedWorkout['kind'], km?: number, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id, planId: 'p', date, kind, title: '', ...(km ? { distance: km * 1000 } : {}), ...extra,
});

describe('matchWorkouts', () => {
  const today = '2026-10-31';

  it('matches a run on the same local day and sets statuses', () => {
    const ws = [wo('w1', '2026-10-28', 'easy', 6), wo('w2', '2026-10-29', 'long', 12), wo('w3', '2026-11-02', 'easy', 6), wo('w4', '2026-10-30', 'rest')];
    const acts = [run('2026-10-28', 6.1), run('2026-10-30', 5)];
    const m = matchWorkouts(ws, acts, today, TZ);
    expect(m.byWorkout.get('w1')!.status).toBe('done');
    expect(m.byWorkout.get('w1')!.activity?.id).toBe(acts[0].id);
    expect(m.byWorkout.get('w2')!.status).toBe('missed');
    expect(m.byWorkout.get('w3')!.status).toBe('upcoming');
    expect(m.byWorkout.get('w4')!.status).toBe('rest');
    expect(m.extras.map((a) => a.id)).toEqual([acts[1].id]);
  });

  it('uses the local date, not UTC, for late-evening runs', () => {
    const a = run('2026-10-28', 6, 22); // 22:00 local = 01:00 UTC next day
    const m = matchWorkouts([wo('w', '2026-10-28', 'easy', 6)], [a], today, TZ);
    expect(m.byWorkout.get('w')!.activity?.id).toBe(a.id);
  });

  it('picks the closest distance when there are several runs and workouts', () => {
    const ws = [wo('short', '2026-10-28', 'easy', 5), wo('long', '2026-10-28', 'long', 15)];
    const acts = [run('2026-10-28', 14.5, 7), run('2026-10-28', 4.8, 18), run('2026-10-28', 2, 20)];
    const m = matchWorkouts(ws, acts, today, TZ);
    expect(m.byWorkout.get('short')!.activity?.id).toBe(acts[1].id);
    expect(m.byWorkout.get('long')!.activity?.id).toBe(acts[0].id);
    expect(m.extras.map((a) => a.id)).toEqual([acts[2].id]);
  });

  it('marks runs well under target as partial', () => {
    const m = matchWorkouts([wo('w', '2026-10-28', 'long', 15)], [run('2026-10-28', 10)], today, TZ);
    expect(m.byWorkout.get('w')!.status).toBe('partial');
  });

  it('respects manual links, unlinks and overrides', () => {
    const a1 = run('2026-10-27', 6);
    const a2 = run('2026-10-28', 6);
    const ws = [
      wo('linked', '2026-10-28', 'easy', 6, { linkedActivityId: a1.id }),
      wo('unlinked', '2026-10-28', 'easy', 6, { unlinked: true }),
      wo('skipped', '2026-10-29', 'easy', 6, { status: 'skipped' }),
      wo('strength', '2026-10-29', 'cross', undefined, { status: 'done' }),
      wo('stale', '2026-10-30', 'easy', 6, { linkedActivityId: 'deleted' }),
    ];
    const a3 = run('2026-10-30', 6);
    const m = matchWorkouts(ws, [a1, a2, a3], today, TZ);
    expect(m.byWorkout.get('linked')!.activity?.id).toBe(a1.id);
    expect(m.byWorkout.get('linked')!.manual).toBe(true);
    expect(m.byWorkout.get('unlinked')!.activity).toBeUndefined();
    expect(m.byWorkout.get('unlinked')!.status).toBe('missed');
    expect(m.byWorkout.get('skipped')!.status).toBe('skipped');
    expect(m.byWorkout.get('strength')!.status).toBe('done');
    expect(m.byWorkout.get('stale')!.activity?.id).toBe(a3.id);
    expect(m.extras.map((a) => a.id)).toEqual([a2.id]);
  });

  it('ignores walks for automatic matching', () => {
    const m = matchWorkouts([wo('w', '2026-10-28', 'easy', 6)], [run('2026-10-28', 6, 9, 'walk')], today, TZ);
    expect(m.byWorkout.get('w')!.status).toBe('missed');
    expect(m.extras).toEqual([]);
  });

  it('estimates distance from duration and pace', () => {
    expect(plannedDistance({ duration: 3600, pace: 360 })).toBe(10000);
    expect(plannedDistance({ duration: 3600 })).toBeUndefined();
  });
});

describe('computeProgress', () => {
  it('computes completion, consistency, streak and weekly volume', () => {
    const plan: TrainingPlan = { id: 'p', name: 'P', goal: '10k', raceDate: '2026-11-08', createdAt: 0 };
    const ws = [
      wo('1', '2026-10-20', 'easy', 6),
      wo('2', '2026-10-22', 'easy', 6), // missed
      wo('3', '2026-10-25', 'long', 10),
      wo('4', '2026-10-27', 'easy', 6),
      wo('5', '2026-10-30', 'rest'),
      wo('6', '2026-11-03', 'easy', 6),
      wo('7', '2026-11-08', 'race', 10),
    ];
    const acts = [run('2026-10-20', 6), run('2026-10-25', 10), run('2026-10-27', 6), run('2026-10-29', 4)];
    const today = '2026-10-31';
    const m = matchWorkouts(ws, acts, today, TZ);
    const p = computeProgress(plan, ws, acts, m, today, TZ);
    expect(p.total).toBe(6);
    expect(p.done).toBe(3);
    expect(p.missed).toBe(1);
    expect(p.completion).toBeCloseTo(3 / 6);
    expect(p.consistency).toBeCloseTo(3 / 4);
    expect(p.streak).toBe(2);
    expect(p.daysToRace).toBe(8);
    expect(p.weeks.map((w) => w.start)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(p.weeks[0]).toMatchObject({ planned: 22000, actual: 16000 });
    expect(p.weeks[1]).toMatchObject({ planned: 6000, actual: 10000 }); // extra run counts
    expect(p.doneTotal).toBe(22000);
  });

  it('counts workouts marked done by hand (no run imported) as run distance', () => {
    const plan: TrainingPlan = { id: 'p', name: 'P', goal: '10k', createdAt: 0 };
    const ws = [
      wo('1', '2026-10-27', 'easy', 8, { status: 'done' }),
      wo('2', '2026-10-29', 'intervals', 6, { status: 'done' }),
      wo('3', '2026-11-01', 'long', 16, { status: 'done' }),
      wo('4', '2026-10-30', 'cross', 5, { status: 'done' }), // not running
      wo('5', '2026-10-28', 'rest'),
    ];
    const today = '2026-11-01';
    const m = matchWorkouts(ws, [], today, TZ);
    const p = computeProgress(plan, ws, [], m, today, TZ);
    expect(p.done).toBe(4);
    expect(p.weeks).toHaveLength(1);
    expect(p.weeks[0]).toMatchObject({ planned: 35000, actual: 30000 });
    expect(p.doneTotal).toBe(30000);
    expect(manualDoneDistance(m.byWorkout.get('1')!)).toBe(8000);
  });

  it('does not double count a done workout that has a linked run', () => {
    const plan: TrainingPlan = { id: 'p', name: 'P', goal: '10k', createdAt: 0 };
    const ws = [wo('1', '2026-10-27', 'easy', 8, { status: 'done' })];
    const acts = [run('2026-10-27', 7)];
    const m = matchWorkouts(ws, acts, '2026-11-01', TZ);
    const p = computeProgress(plan, ws, acts, m, '2026-11-01', TZ);
    expect(p.weeks[0].actual).toBe(7000);
    expect(p.doneTotal).toBe(7000);
  });
});

// ---- Generator ----

const text: GenText = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`;

describe('generatePlan', () => {
  it('builds a full 10K plan ending on race day', () => {
    const plan = generatePlan({ goal: '10k', raceDate: '2027-02-07', runsPerWeek: 4, today: '2026-11-01' }, text);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.weeks).toHaveLength(TEMPLATES['10k'].weeks);
    expect(plan.shortened).toBe(false);
    const last = plan.workouts[plan.workouts.length - 1];
    expect(last).toMatchObject({ date: '2027-02-07', kind: 'race', distance: 10000 });
    expect(plan.workouts.every((w) => w.date <= '2027-02-07' && w.date >= '2026-11-01')).toBe(true);
    // 4 runs a week except race week.
    const firstWeek = plan.workouts.filter((w) => w.date < '2026-12-07' && w.date >= plan.weeks[0].start);
    expect(firstWeek.length).toBeGreaterThan(0);
    const perWeek = plan.weeks.map((wk) => plan.workouts.filter((w) => weekStart(w.date) === wk.start).length);
    expect(perWeek.slice(0, -1).every((c) => c === 4)).toBe(true);
    // Phases: deloads in the build, taper at the end.
    expect(plan.weeks.map((w) => w.phase)).toContain('deload');
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe('race');
  });

  it('grows the long run, with easier deload weeks', () => {
    const plan = generatePlan({ goal: 'half', raceDate: '2027-03-28', runsPerWeek: 3, today: '2026-11-01' }, text);
    if (typeof plan === 'string') throw new Error(plan);
    const longs = plan.weeks.map((wk) => plan.workouts.find((w) => w.kind === 'long' && weekStart(w.date) === wk.start)?.distance ?? 0);
    const firstDeload = plan.weeks.findIndex((w) => w.phase === 'deload');
    expect(longs[firstDeload]).toBeLessThan(longs[firstDeload - 1]);
    const peak = Math.max(...longs);
    expect(peak).toBe(TEMPLATES.half.long[1] * 1000);
    expect(longs[0]).toBe(TEMPLATES.half.long[0] * 1000);
  });

  it('shortens the plan when the race is soon and skips past days', () => {
    // Today is Wednesday; race in ~3 weeks on Sunday.
    const plan = generatePlan({ goal: '10k', raceDate: '2026-11-22', runsPerWeek: 5, today: '2026-11-04' }, text);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.shortened).toBe(true);
    expect(plan.weeks).toHaveLength(3);
    expect(plan.weeks[0].start).toBe('2026-11-02');
    expect(plan.workouts.every((w) => w.date >= '2026-11-04')).toBe(true);
  });

  it('sets target paces from a goal time', () => {
    const plan = generatePlan({ goal: '10k', raceDate: '2027-02-07', runsPerWeek: 3, today: '2026-11-01', targetTime: 50 * 60 }, text);
    if (typeof plan === 'string') throw new Error(plan);
    const race = plan.workouts.find((w) => w.kind === 'race')!;
    expect(race.pace).toBe(300);
    const long = plan.workouts.find((w) => w.kind === 'long')!;
    expect(long.pace).toBe(360); // 300 × 1.2
  });

  it('rejects a race in the past', () => {
    expect(generatePlan({ goal: '5k', raceDate: '2026-10-01', runsPerWeek: 3, today: '2026-11-01' }, text)).toBe('raceInPast');
  });
});

// ---- CSV / JSON ----

describe('plan import', () => {
  it('parses CSV with quotes, semicolons and Portuguese names', () => {
    const csv = 'data;tipo;título;distância_km;duração;ritmo;descrição\n03/11/2026;leve;Leve;6,5;;6:10;"Ritmo; tranquilo"\n05/11/2026;intervalado;6x800;8;;;\n\n08/11/2026;descanso;;;;;\n';
    const r = parsePlanCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.workouts).toEqual([
      { date: '2026-11-03', kind: 'easy', title: 'Leve', distance: 6500, pace: 370, description: 'Ritmo; tranquilo' },
      { date: '2026-11-05', kind: 'intervals', title: '6x800', distance: 8000 },
      { date: '2026-11-08', kind: 'rest', title: '' },
    ]);
  });

  it('reports row errors and keeps valid rows', () => {
    const csv = 'date,kind,title,distance_km,duration,pace\n2026-11-03,easy,A,6,,\n2026-13-01,easy,B,6,,\n2026-11-04,swim,C,,,\n2026-11-05,easy,D,x,,\n2026-11-06,easy,E,,1:75,\n2026-11-07,easy,F,,,9:99\n';
    const r = parsePlanCsv(csv);
    expect(r.workouts.map((w) => w.title)).toEqual(['A']);
    expect(r.errors.map((e) => [e.line, e.code])).toEqual([[3, 'date'], [4, 'kind'], [5, 'distance'], [6, 'duration'], [7, 'pace']]);
  });

  it('imports manual status and exports it back', () => {
    const csv = 'data;tipo;título;status\n01/09/2026;leve;A;feito\n02/09/2026;longão;B;Pulado\n03/09/2026;leve;C;\n04/09/2026;leve;D;talvez\n';
    const r = parsePlanCsv(csv);
    expect(r.workouts.map((w) => w.status)).toEqual(['done', 'skipped', undefined]);
    expect(r.errors).toEqual([{ line: 5, code: 'status', value: 'talvez' }]);
    expect(parsePlanCsv(exportPlanCsv(r.workouts as PlannedWorkout[])).workouts).toEqual(r.workouts);
    expect(parsePlanJson(JSON.stringify([{ date: '2026-09-01', kind: 'easy', status: 'done' }])).workouts[0].status).toBe('done');
  });

  it('needs date and kind columns', () => {
    expect(parsePlanCsv('title,km\nA,5\n').errors[0].code).toBe('columns');
    expect(parsePlanCsv('   ').errors[0].code).toBe('empty');
  });

  it('parses JSON with plan details', () => {
    const r = parsePlanJson(JSON.stringify({ name: 'Plano', goal: '10k', raceDate: '2026-11-22', workouts: [{ date: '2026-11-03', kind: 'tempo', distanceKm: 8, duration: '45:00' }, { date: 'x', kind: 'easy' }] }));
    expect(r).toMatchObject({ name: 'Plano', goal: '10k', raceDate: '2026-11-22' });
    expect(r.workouts).toEqual([{ date: '2026-11-03', kind: 'tempo', title: '', distance: 8000, duration: 2700 }]);
    expect(r.errors).toEqual([{ line: 2, code: 'date', value: 'x' }]);
    expect(parsePlanJson('{oops').errors[0].code).toBe('json');
    expect(parsePlanFile('[]', 'plan.json').errors[0].code).toBe('empty');
  });

  it('round-trips export → import, including the templates', () => {
    const ws: PlannedWorkout[] = [
      wo('1', '2026-11-03', 'intervals', 8, { title: '6x800, "fast"', description: 'line1\nline2' }),
      wo('2', '2026-11-04', 'easy', undefined, { title: 'Easy', duration: 3725, pace: 365 }),
    ];
    const back = parsePlanCsv(exportPlanCsv(ws));
    expect(back.errors).toEqual([]);
    expect(back.workouts).toEqual([
      { date: '2026-11-03', kind: 'intervals', title: '6x800, "fast"', distance: 8000, description: 'line1\nline2' },
      { date: '2026-11-04', kind: 'easy', title: 'Easy', duration: 3725, pace: 365 },
    ]);
    expect(parsePlanCsv(csvTemplate('2026-11-01')).errors).toEqual([]);
    const json = parsePlanJson(jsonTemplate('2026-11-01'));
    expect(json.errors).toEqual([]);
    expect(json.workouts).toHaveLength(5);
  });

  it('parses durations and CSV fields', () => {
    expect(parseDuration('1:05:00')).toBe(3900);
    expect(parseDuration('45:00')).toBe(2700);
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('1:60:00')).toBeUndefined();
    expect(splitCsv('a,"b,""c"""\r\n1,2', ',')).toEqual([['a', 'b,"c"'], ['1', '2']]);
  });
});
