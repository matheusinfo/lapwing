// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Activity } from '../src/data/types';
import type { Goal } from '../src/screens/insights/goals';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';

// ---- Mocks: database and file downloads ----

const db = vi.hoisted(() => ({
  activities: [] as Activity[],
  plans: [] as unknown[],
  workouts: [] as unknown[],
  goals: [] as unknown[],
  listeners: new Set<(store: string) => void>(),
}));

vi.mock('../src/data/db', () => ({
  listActivities: async () => [...db.activities].sort((a, b) => b.startTime - a.startTime),
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  getAll: async (store: string) =>
    store === 'plans' ? [...db.plans] : store === 'workouts' ? [...db.workouts] : store === 'goals' ? [...db.goals] : [],
  onDataChange: (fn: (store: string) => void) => {
    db.listeners.add(fn);
    return () => db.listeners.delete(fn);
  },
}));

const downloads = vi.hoisted(() => [] as { name: string; type: string; size: number }[]);
vi.mock('../src/screens/training/export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/screens/training/export')>()),
  downloadFile: (data: Uint8Array, name: string, type: string) => downloads.push({ name, type, size: data.length }),
}));

const { mount } = await import('../src/screens/today/index');
const { setLang } = await import('../src/i18n');
const { ACTIVE_PLAN_KEY } = await import('../src/screens/training/active-plan');

// ---- Fixtures ----

const at = (y: number, m: number, d: number, h = 7) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 11, 6); // Wednesday morning
const TODAY = '2026-11-11';
const DAY = 86_400_000;

let n = 0;
function run(start: number, km: number, extra: Partial<Activity> = {}, summary: Partial<Activity['summary']> = {}): Activity {
  const movingTime = km * 330;
  return {
    id: `r${++n}`,
    name: `Run ${n}`,
    type: 'run',
    startTime: start,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: start,
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

const PLAN: TrainingPlan = { id: 'p1', name: 'Fall <10K>', goal: '10k', raceDate: '2026-12-06', createdAt: 0 };
const wo = (id: string, date: string, kind: PlannedWorkout['kind'], extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id, planId: 'p1', date, kind, title: '', ...extra,
});
const INTERVALS = wo('w1', TODAY, 'intervals', {
  title: '6 × 800 m',
  distance: 9000,
  description: 'Track <session>',
  steps: [
    { type: 'step', id: 's1', kind: 'warmup', duration: { type: 'time', seconds: 600 } },
    {
      type: 'repeat',
      id: 's2',
      times: 6,
      steps: [
        { type: 'step', id: 's3', kind: 'active', duration: { type: 'distance', meters: 800 }, target: { type: 'pace', min: 230, max: 240 } },
        { type: 'step', id: 's4', kind: 'recovery', duration: { type: 'distance', meters: 400 } },
      ],
    },
    { type: 'step', id: 's5', kind: 'cooldown', duration: { type: 'time', seconds: 600 } },
  ],
});

let root: HTMLElement;
let cleanup: (() => void) | void;

const loaded = () => vi.waitFor(() => expect(root.querySelector('.tdy-page h1')).not.toBeNull());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  setLang('en');
  localStorage.clear();
  db.activities = [];
  db.plans = [];
  db.workouts = [];
  db.goals = [];
  downloads.length = 0;
  document.body.innerHTML = '<div id="toast"></div><main></main>';
  root = document.querySelector('main')!;
});

afterEach(() => {
  if (cleanup) cleanup();
  cleanup = undefined;
  vi.useRealTimers();
});

describe('today screen', () => {
  it('welcomes a new user with the first steps', async () => {
    cleanup = mount(root, {});
    expect(root.textContent).toContain('Loading');
    await loaded();
    expect(root.querySelector('.tdy-welcome')).not.toBeNull();
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.tdy-welcome a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#/activity', '#/training', '#/routes']);
    expect(root.querySelector('.tdy-date')!.textContent).toBe('Wednesday, November 11');
  });

  it("shows today's structured workout, the week and what comes next", async () => {
    db.plans = [PLAN];
    db.workouts = [
      INTERVALS,
      wo('w2', '2026-11-12', 'easy', { distance: 6000, pace: 360 }),
      wo('w3', '2026-11-13', 'rest'),
      wo('w4', '2026-11-15', 'long', { title: 'Sunday long run', distance: 16000 }),
      wo('w0', '2026-11-09', 'easy', { distance: 6000 }),
    ];
    db.activities = [run(at(2026, 11, 9), 6.1)];
    cleanup = mount(root, {});
    await loaded();

    expect(root.querySelector('.tdy-race')!.textContent).toBe('25 days to the race');
    const card = root.querySelector('.tdy-main')!;
    expect(card.querySelector('.tdy-plan-link')!.innerHTML).toBe('Plan: Fall &lt;10K&gt;');
    const workout = card.querySelector('.tdy-workout')!;
    expect(workout.classList.contains('trn-kind-intervals')).toBe(true);
    expect(workout.querySelector('.tdy-wo-title')!.textContent).toBe('6 × 800 m');
    expect(workout.querySelector('.tdy-wo-target')!.textContent).toBe('9 km');
    expect(workout.querySelector('.trn-bars')).not.toBeNull();
    // Steps: warm-up, a 6× block with two steps, cool-down.
    const steps = workout.querySelectorAll('.tdy-steps > li');
    expect(steps).toHaveLength(3);
    expect(steps[1].textContent).toContain('6×');
    expect(steps[1].querySelectorAll('li')).toHaveLength(2);
    expect(steps[1].querySelector('li')!.textContent).toMatch(/Work\s+800 m @ 3:50–4:00 \/km/);
    expect(workout.querySelector('.tdy-desc')!.innerHTML).toBe('Track &lt;session&gt;');
    expect(workout.querySelector('.badge')!.textContent).toBe('To do');

    // Week: Monday's 6.1 km of 37 km planned (6 + 9 + 6 + 16); 1 of 4 workouts.
    const week = card.querySelectorAll('.tdy-week dd');
    expect(week[0].textContent).toBe('6.1 km / 37 km');
    expect(week[1].textContent).toBe('1 / 4');

    // Next workouts: no rest day.
    const next = [...card.querySelectorAll('.tdy-upcoming li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(next).toEqual(['Tomorrow Easy run 6 km · 6:00 /km', 'Sun, Nov 15 Sunday long run 16 km']);

    // Download the workout for the watch.
    root.querySelector<HTMLButtonElement>('[data-action="fit"]')!.click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('2026-11-11-6-800-m.fit');
    expect(downloads[0].type).toBe('application/vnd.ant.fit');
    expect(downloads[0].size).toBeGreaterThan(50);
  });

  it('marks the workout done once the run is imported, and shows the run', async () => {
    db.plans = [PLAN];
    db.workouts = [INTERVALS];
    cleanup = mount(root, {});
    await loaded();
    expect(root.querySelector('.tdy-last')!.textContent).toContain('No runs yet.');

    const done = run(at(2026, 11, 11, 6), 9.2, { name: '<i>Track</i>' }, { avgHr: 160 });
    db.activities = [done];
    for (const fn of db.listeners) fn('activities');
    await vi.waitFor(() => expect(root.querySelector('.tdy-workout .badge')!.textContent).toBe('✓ Done'));
    expect(root.querySelector('[data-action="fit"]')).toBeNull();
    expect(root.querySelector('.tdy-workout a.btn')!.getAttribute('href')).toBe(`#/activity/${done.id}`);

    const last = root.querySelector('.tdy-last')!;
    expect(last.querySelector('.tdy-run-name a')!.innerHTML).toBe('&lt;i&gt;Track&lt;/i&gt;');
    expect(last.textContent).toContain('today');
    expect(last.textContent).toContain('Workout: 6 × 800 m');
    expect(last.textContent).toContain('160 bpm');
    expect(last.querySelector('.tdy-rpe')!.getAttribute('href')).toBe(`#/activity/${done.id}`);
  });

  it('invites to create a plan and a goal when there are only runs', async () => {
    db.activities = [run(NOW - DAY, 8, { rpe: 6 }), run(NOW - 3 * DAY, 5, { type: 'walk' })];
    cleanup = mount(root, {});
    await loaded();
    expect(root.querySelector('.tdy-main a.btn')!.getAttribute('href')).toBe('#/training');
    expect(root.querySelector('.tdy-goals-card a.btn')!.getAttribute('href')).toBe('#/insights');
    const last = root.querySelector('.tdy-last')!;
    expect(last.textContent).toContain('yesterday');
    expect(last.textContent).toContain('Effort (RPE): 6/10');
    expect(root.querySelector('.tdy-all-good')).not.toBeNull();
  });

  it('shows goals and the most severe alert', async () => {
    db.activities = Array.from({ length: 12 }, (_, i) => run(NOW - i * DAY - 3600_000, 5));
    db.goals = [{ id: 'g1', period: 'week', metric: 'distance', target: 30000, createdAt: 1 } satisfies Goal];
    cleanup = mount(root, {});
    await loaded();
    const goal = root.querySelector('.tdy-goal')!;
    expect(goal.textContent).toContain('Weekly distance');
    expect(goal.querySelector('.tdy-goal-value strong')!.textContent).toBe('15.00 km');
    const alert = root.querySelector('.tdy-alert')!;
    expect(alert.classList.contains('sev-high')).toBe(true);
    expect(root.querySelector('.tdy-readiness')!.textContent).toMatch(/\+\d+ more alert/);
  });

  it('offers the watch file only while the workout is still to do', async () => {
    db.plans = [PLAN];
    db.workouts = [{ ...INTERVALS, status: 'done' }, wo('w2', TODAY, 'easy', { status: 'skipped' })];
    cleanup = mount(root, {});
    await loaded();
    const badges = [...root.querySelectorAll('.tdy-workout .badge')].map((b) => b.textContent);
    expect(badges).toEqual(['✓ Done', 'Skipped']);
    expect(root.querySelector('[data-action="fit"]')).toBeNull();
  });

  it('follows the plan chosen on the Training screen', async () => {
    db.plans = [PLAN, { ...PLAN, id: 'p2', name: 'Marathon' }];
    db.workouts = [INTERVALS, wo('m1', TODAY, 'rest', { planId: 'p2' })];
    localStorage.setItem(ACTIVE_PLAN_KEY, 'p2');
    cleanup = mount(root, {});
    await loaded();
    expect(root.querySelector('.tdy-plan-link')!.textContent).toBe('Plan: Marathon');
    expect(root.querySelector('.tdy-workout')!.textContent).toContain('Rest day');
  });

  it('translates, moves to the next day by itself and cleans up', async () => {
    db.plans = [PLAN];
    db.workouts = [wo('w1', '2026-11-12', 'tempo', { title: 'Tempo' })];
    cleanup = mount(root, {});
    await loaded();
    expect(root.querySelector('.tdy-nothing')!.textContent).toBe('Nothing planned for today.');

    setLang('pt-BR');
    expect(root.querySelector('h1')!.textContent).toBe('Hoje');
    expect(root.querySelector('.tdy-main .card-title')!.textContent).toBe('Treino de hoje');

    // Past midnight, the open screen shows the new day.
    vi.setSystemTime(at(2026, 11, 12, 0) + 60_000);
    vi.advanceTimersByTime(60_000);
    expect(root.querySelector('.tdy-workout .tdy-wo-title')!.textContent).toBe('Tempo');
    expect(root.querySelector('.tdy-date')!.textContent).toBe('quinta-feira, 12 de novembro');

    cleanup!();
    cleanup = undefined;
    expect(root.classList.contains('tdy-root')).toBe(false);
    expect(db.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
