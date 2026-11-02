// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { exportPlanCsv, exportPlanJson, parsePlanCsv, parsePlanJson } from '../src/screens/training/csv';
import { generatePlan, type GenText } from '../src/screens/training/generator';
import { plannedDistance } from '../src/screens/training/matching';
import {
  buildTemplate,
  derivedTargets,
  distance,
  easyPaceOf,
  estimateSteps,
  flattenSteps,
  parseStepsText,
  repeatStep,
  sanitizeSteps,
  simpleStep,
  STEP_TEMPLATES,
  stepsSummary,
  stepsToText,
  stripStepIds,
  time,
  validateSteps,
} from '../src/screens/training/structure';
import type { PlannedWorkout, WorkoutStep } from '../src/screens/training/types';

beforeAll(() => setLang('en'));

const intervals = (): WorkoutStep[] => [
  simpleStep('warmup', time(600)),
  repeatStep(8, [simpleStep('active', distance(400), { type: 'pace', min: 240, max: 250 }), simpleStep('recovery', distance(200))]),
  simpleStep('cooldown', time(600)),
];

describe('structure helpers', () => {
  it('flattens repeats', () => {
    const flat = flattenSteps(intervals());
    expect(flat).toHaveLength(18);
    expect(flat.filter((s) => s.kind === 'active')).toHaveLength(8);
  });

  it('estimates distance and time from target paces and the easy pace', () => {
    const e = estimateSteps(intervals(), 360);
    // 8 × 400 m at 4:05 /km + 8 × 200 m at 360 × 1.12, plus 20 min of warm-up/cool-down.
    const work = 8 * 400;
    const jog = 8 * 200;
    expect(e.distance).toBeCloseTo(work + jog + (600 / (360 * 1.03)) * 1000 + (600 / (360 * 1.05)) * 1000, 3);
    expect(e.duration).toBeCloseTo(1200 + work * 0.245 + jog * 0.36 * 1.12, 3);
    expect(e.hasOpen).toBe(false);
    expect(estimateSteps([simpleStep('active', { type: 'open' })]).hasOpen).toBe(true);
    // A rest by time covers no distance.
    expect(estimateSteps([simpleStep('rest', time(60))]).distance).toBe(0);
  });

  it('derives rounded workout targets', () => {
    const d = derivedTargets([simpleStep('active', distance(5004), { type: 'pace', min: 300, max: 300 })]);
    expect(d).toEqual({ distance: 5000, duration: 1500 });
    expect(derivedTargets([simpleStep('active', { type: 'open' })])).toEqual({});
  });

  it('summarises in human-readable form', () => {
    expect(stepsSummary(intervals())).toBe('10 min WU · 8×(400 m @ 4:00–4:10 /km, 200 m jog) · 10 min CD');
    expect(stepsSummary([simpleStep('active', distance(1500), { type: 'hr', zone: 2 }), simpleStep('rest', time(90))])).toBe('1.5 km @ Z2 · 1:30 rest');
    expect(stepsSummary([simpleStep('active', time(45), { type: 'hr', min: 150, max: 160 })])).toBe('45 s @ 150–160 bpm');
  });

  it('validates steps', () => {
    expect(validateSteps(intervals())).toBeNull();
    expect(validateSteps([])).toEqual({ code: 'empty', index: 0 });
    expect(validateSteps([simpleStep('active', distance(0))])).toEqual({ code: 'duration', index: 1 });
    expect(validateSteps([simpleStep('warmup', time(60)), simpleStep('active', time(NaN))])).toEqual({ code: 'duration', index: 2 });
    expect(validateSteps([simpleStep('active', time(60), { type: 'pace', min: 300, max: 250 })])?.code).toBe('pace');
    expect(validateSteps([simpleStep('active', time(60), { type: 'hr', zone: 7 })])?.code).toBe('hr');
    expect(validateSteps([repeatStep(0, [simpleStep('active', time(60))])])?.code).toBe('repeat');
    expect(validateSteps([repeatStep(3, [])])?.code).toBe('repeat');
    expect(validateSteps([repeatStep(3, [simpleStep('active', distance(-1))])])).toEqual({ code: 'duration', index: 1 });
  });

  it('builds valid templates with and without paces', () => {
    for (const { id } of STEP_TEMPLATES) {
      expect(validateSteps(buildTemplate(id)), id).toBeNull();
      expect(validateSteps(buildTemplate(id, { easy: 360 })), id).toBeNull();
    }
    const t = buildTemplate('int8x400', { easy: 360 });
    expect(stepsSummary(t)).toBe('15 min WU · 8×(400 m @ 4:45–4:55 /km, 200 m jog) · 10 min CD');
    expect(stepsSummary(buildTemplate('tempo3x10'))).toBe('15 min WU · 3×(10 min, 2 min jog) · 10 min CD');
    const ids = flattenSteps(buildTemplate('int6x800')).map((s) => s.id);
    expect(new Set(ids).size).toBe(4); // Repeated children share ids: WU, 2 children, CD.
  });

  it('finds the easy pace of a plan', () => {
    expect(easyPaceOf([{ kind: 'easy', pace: 370 }, { kind: 'long', pace: 380 }, { kind: 'tempo', pace: 300 }, { kind: 'easy', pace: 360 }])).toBe(370);
    expect(easyPaceOf([{ kind: 'tempo', pace: 300 }])).toBeUndefined();
  });
});

describe('steps text format', () => {
  it('round-trips steps through text', () => {
    const steps: WorkoutStep[] = [
      ...intervals(),
      simpleStep('active', distance(1500), { type: 'hr', zone: 3 }, 'relaxed; smooth [arms]'),
      simpleStep('rest', time(90)),
      simpleStep('active', { type: 'open' }, { type: 'hr', min: 140, max: 150 }),
    ];
    const text = stepsToText(steps);
    expect(text).toBe('wu 10min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min; run 1.5km @z3 [relaxed  smooth (arms)]; rest 1:30; run lap @140-150bpm');
    const back = parseStepsText(text)!;
    expect(back).toBeDefined();
    expect(stripStepIds(back)).toEqual(stripStepIds(steps.map((s, i) => (i === 3 ? { ...s, note: 'relaxed  smooth (arms)' } : s))));
  });

  it('accepts Portuguese names, spaces and decimal commas', () => {
    const steps = parseStepsText('aquecimento 2 km; 6x(tiro 800 m @ 4:35-4:25 /km, trote 1,5km)\ndesaquecimento 10 min')!;
    expect(stripStepIds(steps)).toEqual([
      { type: 'step', kind: 'warmup', duration: { type: 'distance', meters: 2000 } },
      {
        type: 'repeat',
        times: 6,
        steps: [
          { type: 'step', kind: 'active', duration: { type: 'distance', meters: 800 }, target: { type: 'pace', min: 265, max: 275 } },
          { type: 'step', kind: 'recovery', duration: { type: 'distance', meters: 1500 } },
        ],
      },
      { type: 'step', kind: 'cooldown', duration: { type: 'time', seconds: 600 } },
    ]);
  });

  it('rejects invalid text', () => {
    expect(parseStepsText('')).toBeUndefined();
    expect(parseStepsText('run fast')).toBeUndefined();
    expect(parseStepsText('run 400m @ quick')).toBeUndefined();
    expect(parseStepsText('0x(run 400m)')).toBeUndefined();
    expect(parseStepsText('run 0m')).toBeUndefined();
  });

  it('sanitizes steps from untrusted JSON', () => {
    const raw = JSON.parse(JSON.stringify(stripStepIds(intervals())));
    const steps = sanitizeSteps(raw)!;
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => typeof s.id === 'string' && s.id)).toBe(true);
    expect(sanitizeSteps([{ type: 'step', kind: 'sprint', duration: { type: 'time', seconds: 60 } }])).toBeUndefined();
    expect(sanitizeSteps([{ type: 'step', kind: 'active', duration: { type: 'time', seconds: -5 } }])).toBeUndefined();
    expect(sanitizeSteps('nope')).toBeUndefined();
  });
});

const wo = (id: string, date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({ id, planId: 'p', date, kind: 'intervals', title: '', ...extra });

describe('CSV / JSON with steps', () => {
  it('adds a steps column only when needed and parses it back', () => {
    const plain = [wo('1', '2026-11-03', { kind: 'easy', distance: 6000 })];
    expect(exportPlanCsv(plain).split('\n')[0]).toBe('date,kind,title,distance_km,duration,pace,description');

    const ws = [...plain, wo('2', '2026-11-04', { title: '8x400', distance: 7500, steps: intervals() })];
    const csv = exportPlanCsv(ws);
    expect(csv.split('\n')[0]).toBe('date,kind,title,distance_km,duration,pace,description,steps');
    const back = parsePlanCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.workouts[0].steps).toBeUndefined();
    expect(stripStepIds(back.workouts[1].steps!)).toEqual(stripStepIds(intervals()));
    expect(back.workouts[1]).toMatchObject({ date: '2026-11-04', kind: 'intervals', title: '8x400', distance: 7500 });
  });

  it('reports invalid steps in CSV', () => {
    const r = parsePlanCsv('date;kind;estrutura\n2026-11-03;tiros;8x(run fast)\n2026-11-04;leve;\n');
    expect(r.workouts).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 2, code: 'steps', value: '8x(run fast)' }]);
  });

  it('round-trips the app JSON format, with steps as objects or text', () => {
    const ws = [wo('2', '2026-11-04', { title: '8x400', distance: 7500, pace: 300, description: 'Track', steps: intervals() }), wo('1', '2026-11-03', { kind: 'rest' })];
    const json = exportPlanJson({ name: 'Plano', goal: '10k', raceDate: '2026-11-22' }, ws);
    const back = parsePlanJson(json);
    expect(back).toMatchObject({ name: 'Plano', goal: '10k', raceDate: '2026-11-22', errors: [] });
    expect(back.workouts.map((w) => w.date)).toEqual(['2026-11-03', '2026-11-04']);
    expect(stripStepIds(back.workouts[1].steps!)).toEqual(stripStepIds(intervals()));
    expect(JSON.parse(json).workouts[1].steps[0].id).toBeUndefined();

    const text = parsePlanJson(JSON.stringify([{ date: '2026-11-04', kind: 'tempo', steps: 'wu 2km; run 5km @4:50-5:00; cd 1km' }]));
    expect(text.workouts[0].steps).toHaveLength(3);
    expect(parsePlanJson(JSON.stringify([{ date: '2026-11-04', kind: 'tempo', steps: [{ type: 'bad' }] }])).errors[0].code).toBe('steps');
  });
});

describe('generator and matching with steps', () => {
  const text: GenText = (key) => key;

  it('attaches steps to tempo, interval and long runs', () => {
    const plan = generatePlan({ goal: '10k', raceDate: '2027-02-07', runsPerWeek: 4, today: '2026-11-01', targetTime: 50 * 60 }, text);
    if (typeof plan === 'string') throw new Error(plan);
    for (const kind of ['tempo', 'intervals', 'long'] as const) {
      const ws = plan.workouts.filter((w) => w.kind === kind);
      expect(ws.length).toBeGreaterThan(0);
      for (const w of ws) {
        expect(validateSteps(w.steps!)).toBeNull();
        // The stored distance matches the structure (distance-based steps).
        expect(estimateSteps(w.steps!).distance).toBeCloseTo(w.distance!, -2);
      }
    }
    const iv = plan.workouts.find((w) => w.kind === 'intervals')!;
    expect(iv.steps![0]).toMatchObject({ kind: 'warmup' });
    expect(iv.steps![1]).toMatchObject({ type: 'repeat' });
    expect(iv.steps![1].type === 'repeat' && iv.steps![1].steps[0].target).toEqual({ type: 'pace', min: 285, max: 295 }); // 300 × 0.96 → 290
    expect(plan.workouts.filter((w) => w.kind === 'easy').every((w) => !w.steps)).toBe(true);
  });

  it('has no pace targets when training by feel', () => {
    const plan = generatePlan({ goal: '5k', raceDate: '2027-01-10', runsPerWeek: 3, today: '2026-11-01' }, text);
    if (typeof plan === 'string') throw new Error(plan);
    const all = plan.workouts.flatMap((w) => flattenSteps(w.steps ?? []));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => !s.target)).toBe(true);
  });

  it('estimates the planned distance from steps when no distance is set', () => {
    expect(plannedDistance({ steps: [simpleStep('active', distance(5000)), simpleStep('rest', time(60))] })).toBe(5000);
    expect(plannedDistance({ distance: 8000, steps: intervals() })).toBe(8000);
    expect(plannedDistance({ steps: [simpleStep('active', { type: 'open' })] })).toBeUndefined();
  });
});
