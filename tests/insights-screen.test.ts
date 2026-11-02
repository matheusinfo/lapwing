// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Activity, type TrackPoint } from '../src/data/types';
import type { Goal } from '../src/screens/insights/goals';
import { answerConfirm } from './helpers/confirm';

// ---- Mocks: database, charts and toasts ----

const db = vi.hoisted(() => ({
  activities: [] as Activity[],
  goals: [] as unknown[],
  tracks: new Map<string, TrackPoint[]>(),
  /** Track reads wait for this, so tests can see the "calculating" state. */
  gate: Promise.resolve() as Promise<void>,
  listeners: new Set<(store: string) => void>(),
  put: vi.fn(async (_store: string, _value: unknown) => {}),
  remove: vi.fn(async (_store: string, _id: string) => {}),
}));

vi.mock('../src/data/db', () => ({
  listActivities: async () => [...db.activities].sort((a, b) => b.startTime - a.startTime),
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  getAll: async (store: string) => (store === 'goals' ? [...db.goals] : []),
  getTrack: async (id: string) => {
    await db.gate;
    return db.tracks.get(id) ?? [];
  },
  put: db.put,
  remove: db.remove,
  newId: () => 'new-goal',
  onDataChange: (fn: (store: string) => void) => {
    db.listeners.add(fn);
    return () => db.listeners.delete(fn);
  },
}));

const charts = vi.hoisted(() => ({ created: 0, destroyed: 0 }));
vi.mock('../src/ui/chart-theme', () => ({
  Chart: class {
    constructor() {
      charts.created++;
    }
    destroy() {
      charts.destroyed++;
    }
  },
  chartColors: { accent: '#e8590c', pace: '#1c7ed6', ele: '#7c8691', grid: '#eee', hr: '#e03131', muted: '#666' },
}));
vi.mock('../src/ui/toast', () => ({ showToast: vi.fn() }));

const { mount } = await import('../src/screens/insights/index');
const { setLang } = await import('../src/i18n');

// ---- Fixtures ----

const at = (y: number, m: number, d: number, h = 7) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 4, 20); // Wednesday
const DAY = 86_400_000;

/** A straight run north at `pace` s/km with a point every 10 m. */
function track(start: number, km: number, pace: number): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const step = 10 / 111_195; // degrees of latitude per 10 m
  for (let i = 0; i <= km * 100; i++) {
    pts.push({ lat: i * step, lon: 0, time: start + i * pace * 10 });
  }
  return pts;
}

let n = 0;
function run(start: number, km: number, pace = 330, extra: Partial<Activity> = {}): Activity {
  const id = `r${++n}`;
  db.tracks.set(id, track(start, km, pace));
  const movingTime = km * pace;
  return {
    id,
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
      avgPace: pace,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
    },
    ...extra,
  };
}

let root: HTMLElement;
let cleanup: (() => void) | void;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setLang('en');
  db.activities = [];
  db.goals = [];
  db.tracks.clear();
  db.gate = Promise.resolve();
  db.put.mockClear();
  db.remove.mockClear();
  charts.created = charts.destroyed = 0;
  document.body.innerHTML = '<div id="toast"></div><main></main>';
  root = document.querySelector('main')!;
});

afterEach(() => {
  if (cleanup) cleanup();
  cleanup = undefined;
  vi.useRealTimers();
});

describe('insights screen', () => {
  it('shows the goal empty state, then predictions after efforts are computed', async () => {
    db.activities = [
      run(NOW - 2 * DAY, 6, 300, { name: '<b>Tempo</b>' }),
      run(NOW - 5 * DAY, 10, 330),
      run(NOW - 9 * DAY, 8, 340),
    ];
    let open!: () => void;
    db.gate = new Promise((r) => (open = r));
    cleanup = mount(root, {});
    expect(root.textContent).toContain('Loading');

    await vi.waitFor(() => expect(root.querySelector('.ins-empty')).not.toBeNull());
    expect(root.querySelector('.ins-empty button[data-new-goal]')).not.toBeNull();
    expect(root.querySelector('#ins-pred-body')!.textContent).toContain('Calculating');
    open();

    await vi.waitFor(() => expect(root.querySelector('.ins-calculating')).toBeNull(), { timeout: 3000 });
    const rows = root.querySelectorAll('.ins-pred-table tbody tr');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('5K');
    // The 5K comes from the whole 6 km tempo run at 5:00/km (30:00 × (5/6)^1.06),
    // which beats the 25:00 best 5 km inside it among similar distances.
    expect(rows[0].querySelector('.ins-pred-time')!.textContent).toBe('24:44');
    expect(rows[0].querySelector('.ins-source')!.textContent).toContain('Whole run (6 km)');
    // Run names are escaped and linked.
    const link = rows[0].querySelector<HTMLAnchorElement>('.ins-source a')!;
    expect(link.getAttribute('href')).toBe(`#/activity/${db.activities[0].id}`);
    expect(link.innerHTML).toBe('&lt;b&gt;Tempo&lt;/b&gt;');
    // No 25 km run: the marathon is flagged.
    expect(root.querySelector('.ins-caveats')!.textContent).toContain('25 km');
    expect(root.querySelector('.ins-vdot h3')!.textContent).toMatch(/VDOT \d/);

    // Training load: balanced → "all good" and one chart.
    expect(root.querySelector('.ins-all-good')).not.toBeNull();
    expect(charts.created).toBe(1);
  });

  it('renders goal cards with status, history and streak', async () => {
    db.activities = [run(NOW - DAY, 12), run(NOW - 2 * DAY, 10), run(NOW - 8 * DAY, 25), run(NOW - 15 * DAY, 25)];
    const goals: Goal[] = [
      { id: 'g1', period: 'week', metric: 'distance', target: 20000, createdAt: 1 },
      { id: 'g2', period: 'month', metric: 'runs', target: 12, createdAt: 2 },
    ];
    db.goals = goals;
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelectorAll('.ins-goal')).toHaveLength(2));

    const week = root.querySelector('[data-goal-id="g1"]')!;
    expect(week.querySelector('h3')!.textContent).toBe('Weekly distance');
    expect(week.querySelector('.badge')!.textContent).toBe('Achieved');
    expect(week.querySelector('.ins-goal-value strong')!.textContent).toBe('22.00 km');
    expect(week.querySelectorAll('.ins-hbar').length).toBeGreaterThanOrEqual(3);
    expect(week.querySelector('.ins-streak')!.textContent).toBe('3 weeks in a row');

    const month = root.querySelector('[data-goal-id="g2"]')!;
    expect(month.querySelector('h3')!.textContent).toBe('Runs per month');
    // 4 November: 2 of 12 runs, above the pro-rata share up to yesterday (12 × 3/30 = 1.2).
    expect(month.querySelector('.badge')!.textContent).toBe('On track');
    expect(month.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('17');
  });

  it('creates a goal from the dialog and validates the target', async () => {
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelector('.ins-empty')).not.toBeNull());

    root.querySelector<HTMLButtonElement>('.ins-empty [data-new-goal]')!.click();
    const dialog = root.querySelector<HTMLDialogElement>('.ins-dialog')!;
    const form = dialog.querySelector('form')!;
    expect(dialog.hasAttribute('open')).toBe(true);

    const metric = form.querySelector<HTMLSelectElement>('select[name="metric"]')!;
    metric.value = 'time';
    metric.dispatchEvent(new Event('change'));
    expect(form.querySelector('[data-unit]')!.textContent).toBe('h:mm');

    const target = form.querySelector<HTMLInputElement>('input[name="target"]')!;
    target.value = 'abc';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(form.querySelector<HTMLElement>('.ins-form-error')!.hidden).toBe(false);
    expect(db.put).not.toHaveBeenCalled();

    target.value = '4:30';
    form.querySelector<HTMLSelectElement>('select[name="period"]')!.value = 'month';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(db.put).toHaveBeenCalledTimes(1);
    const [store, saved] = db.put.mock.calls[0];
    expect(store).toBe('goals');
    expect(saved).toMatchObject({
      id: 'new-goal',
      period: 'month',
      metric: 'time',
      target: 4.5 * 3600,
      activityTypes: ['run', 'trail-run'],
    });
  });

  it('edits and deletes an existing goal', async () => {
    db.goals = [{ id: 'g1', period: 'week', metric: 'distance', target: 30000, createdAt: 5 }];
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelector('[data-edit-goal="g1"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-edit-goal="g1"]')!.click();
    const form = root.querySelector('.ins-dialog form')!;
    expect(form.querySelector<HTMLInputElement>('input[name="target"]')!.value).toBe('30');
    form.querySelector<HTMLButtonElement>('[data-delete]')!.click();
    expect((await answerConfirm(true)).title).toBe('Delete goal');
    await flush();
    expect(db.remove).toHaveBeenCalledWith('goals', 'g1');
  });

  it('shows overload alerts with their numbers', async () => {
    // Light base, then a big week with runs every day.
    const acts: Activity[] = [];
    for (let d = 8; d < 29; d += 3) acts.push(run(NOW - d * DAY, 5));
    for (let d = 0; d < 7; d++) acts.push(run(NOW - d * DAY, 10));
    db.activities = acts;
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelector('.ins-alerts')).not.toBeNull());
    const alerts = [...root.querySelectorAll<HTMLElement>('.ins-alert')];
    const kinds = alerts.map((a) => a.dataset.alert);
    expect(kinds).toContain('acwrDistance');
    expect(kinds).toContain('weeklyJump');
    expect(kinds).toContain('streak');
    expect(alerts[0].classList.contains('sev-high')).toBe(true);
    const acwr = alerts.find((a) => a.dataset.alert === 'acwrDistance')!;
    expect(acwr.querySelector('.ins-facts')!.textContent).toContain('70.00 km');
  });

  it('rerenders on language change and cleans up on unmount', async () => {
    db.activities = [run(NOW - DAY, 5)];
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelector('h1')!.textContent).toBe('Insights'));
    setLang('pt-BR');
    expect(root.querySelector('h1')!.textContent).toBe('Metas e alertas');
    expect(db.listeners.size).toBe(1);

    cleanup!();
    cleanup = undefined;
    expect(db.listeners.size).toBe(0);
    expect(charts.destroyed).toBe(charts.created);
    expect(root.classList.contains('ins-root')).toBe(false);
  });

  it('reloads goals when the goals store changes', async () => {
    cleanup = mount(root, {});
    await vi.waitFor(() => expect(root.querySelector('.ins-empty')).not.toBeNull());
    db.goals = [{ id: 'g9', period: 'week', metric: 'runs', target: 3, createdAt: 1 }];
    db.listeners.forEach((fn) => fn('goals'));
    await vi.waitFor(() => expect(root.querySelector('[data-goal-id="g9"]')).not.toBeNull());
  });
});
