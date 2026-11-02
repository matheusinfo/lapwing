// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, ActivitySummary } from '../src/data/types';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';

// ---- In-memory stand-ins for IndexedDB and Chart.js ----

const store: Record<string, unknown[]> = {};
const dataListeners = new Set<(s: string) => void>();

vi.mock('../src/data/db', () => ({
  listActivities: async () => [...((store.activities ?? []) as Activity[])].sort((a, b) => b.startTime - a.startTime),
  getSettings: async () => ({ maxHr: 190, restingHr: 60, hrZoneBounds: [0.6, 0.7, 0.8, 0.9] }),
  getAll: async (name: string) => [...(store[name] ?? [])],
  getTrack: async () => [],
  deleteActivity: async () => {},
  onDataChange: (fn: (s: string) => void) => {
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
  },
}));
vi.mock('../src/screens/history/charts', () => {
  const chart = () => ({ destroy() {} });
  return { weeklyVolumeChart: chart, paceTrendChart: chart, fitnessChart: chart };
});
vi.mock('../src/ui/toast', () => ({ showToast: () => {} }));

const { mount } = await import('../src/screens/history');
const { setLang } = await import('../src/i18n');
const { filterChips } = await import('../src/screens/history/filter-view');
const { emptyFilters } = await import('../src/screens/history/filters');

// ---- Fixtures ----

const DAY = 86_400_000;
const daysAgo = (d: number) => {
  const t = new Date(Date.now() - d * DAY);
  t.setHours(7, 0, 0, 0);
  return t.getTime();
};
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function run(id: string, km: number, ago: number, opts: Partial<ActivitySummary> & { shoeId?: string } = {}): Activity {
  const { shoeId, ...summary } = opts;
  const movingTime = summary.movingTime ?? km * 330;
  return {
    id,
    name: `Run <${id}>`,
    type: 'run',
    startTime: daysAgo(ago),
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    shoeId,
    summary: {
      distance: km * 1000,
      elapsedTime: movingTime,
      movingTime,
      avgPace: movingTime / km,
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: true, hr: summary.avgHr !== undefined, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
      ...summary,
    },
  };
}

const LONG = run('long', 18, 3, { avgHr: 150, elevationGain: 250, shoeId: 'shoe1' });
const EASY = run('easy', 6, 5, { elevationGain: 40 });
const TEMPO = run('tempo', 10, 8, { movingTime: 10 * 270, avgHr: 165, elevationGain: 90 });

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const waitDebounce = () => new Promise((r) => setTimeout(r, 300));

let root: HTMLElement;
let unmount: (() => void) | void;

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const rowIds = () => [...root.querySelectorAll<HTMLElement>('tr[data-id]')].map((r) => r.dataset.id);
const count = () => $('#his-runs-count').textContent;
const click = (sel: string) => $(sel).click();
function type(sel: string, value: string) {
  const input = $<HTMLInputElement>(sel);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function check(sel: string, on = true) {
  const input = $<HTMLInputElement>(sel);
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function open(hash = '#/history') {
  history.replaceState(null, '', hash);
  root = document.createElement('div');
  document.body.append(root);
  unmount = mount(root, {});
  await flush();
}

beforeAll(() => setLang('en'));

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store.activities = [LONG, EASY, TEMPO];
});

afterEach(() => {
  if (unmount) unmount();
  root.remove();
});

describe('history filters panel', () => {
  it('opens the panel and applies a preset, updating count, chips, badge and URL', async () => {
    await open();
    expect(rowIds()).toEqual(['long', 'easy', 'tempo']);
    expect(count()).toBe('3 runs');

    const toggle = $('#his-filter-toggle');
    expect($('#his-filter-panel').hidden).toBe(true);
    toggle.click();
    expect($('#his-filter-panel').hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    click('[data-preset="long"]');
    expect(rowIds()).toEqual(['long']);
    expect(count()).toBe('1 of 3 runs');
    expect($('#his-filter-badge').textContent).toBe('1');
    expect(toggle.getAttribute('aria-label')).toBe('Filters (1 active)');
    expect($('[data-preset="long"]').getAttribute('aria-pressed')).toBe('true');
    expect($<HTMLInputElement>('#his-f-distance-min').value).toBe('15');
    expect(location.hash).toBe('#/history?dmin=15');
    expect($('.his-chip').textContent).toContain('Distance ≥ 15 km');
    expect($('.his-filter-totals').textContent).toContain('18.00 km');

    click('[data-remove-filter="distance"]');
    expect(rowIds()).toHaveLength(3);
    expect(count()).toBe('3 runs');
    expect(location.hash).toBe('#/history');
    expect(root.querySelector('.his-chip')).toBeNull();
  });

  it('debounces typed ranges and flags invalid input', async () => {
    await open();
    click('#his-filter-toggle');

    type('#his-f-hr-min', '160');
    expect(rowIds()).toHaveLength(3); // not applied yet
    await waitDebounce();
    expect(rowIds()).toEqual(['tempo']);
    expect(location.hash).toBe('#/history?hmin=160');

    type('#his-f-pace-max', 'fast');
    await waitDebounce();
    expect($('#his-f-pace-max').getAttribute('aria-invalid')).toBe('true');
    expect($('#his-f-pace-err').textContent).toMatch(/m:ss/);
    expect(rowIds()).toEqual(['tempo']);

    type('#his-f-hr-min', '');
    type('#his-f-pace-max', '5:00');
    await waitDebounce();
    expect($('#his-f-pace-max').hasAttribute('aria-invalid')).toBe(false);
    expect($('#his-f-pace-err').textContent).toBe('');
    expect(rowIds()).toEqual(['tempo']);
    expect(location.hash).toBe('#/history?pmax=300');
  });

  it('restores filters from the URL together with the period', async () => {
    await open('#/history?range=4w&emin=50&t=run');
    expect(rowIds()).toEqual(['long', 'tempo']);
    expect(count()).toBe('2 of 3 runs');
    expect($<HTMLInputElement>('#his-f-elevation-min').value).toBe('50');
    expect($<HTMLInputElement>('[data-filter-type="run"]').checked).toBe(true);
    expect($('[data-range="4w"]').getAttribute('aria-pressed')).toBe('true');

    // Switching the period keeps the filters.
    click('[data-range="year"]');
    expect(location.hash).toBe('#/history?range=year&emin=50&t=run');
  });

  it('reacts to back/forward changes of the query', async () => {
    await open('#/history');
    location.hash = '#/history?dmax=7';
    await flush();
    expect(rowIds()).toEqual(['easy']);
    expect($<HTMLInputElement>('#his-f-distance-max').value).toBe('7');
  });

  it('filters by workout kind from training plans and reloads when plans change', async () => {
    await open();
    expect(root.querySelector('[data-filter-kind]')).toBeNull(); // no plans yet

    const plan: TrainingPlan = { id: 'p1', name: 'Half', goal: 'half', createdAt: 1 };
    const workout: PlannedWorkout = {
      id: 'w1', planId: 'p1', date: localDate(LONG.startTime), kind: 'long', title: '', distance: 18000,
    };
    store.plans = [plan];
    store.workouts = [workout];
    dataListeners.forEach((fn) => fn('workouts'));
    await flush();

    check('[data-filter-kind="long"]');
    expect(rowIds()).toEqual(['long']);
    check('[data-filter-kind="long"]', false);
    check('[data-filter-kind="unplanned"]');
    expect(rowIds()).toEqual(['easy', 'tempo']);
    expect(location.hash).toBe('#/history?k=unplanned');
    expect($('.his-chip').textContent).toContain('Workout: Unplanned');
  });

  it('shows a clear-all action when nothing matches', async () => {
    await open('#/history?dmin=100&q=run');
    expect(rowIds()).toEqual([]);
    expect($('#his-runs-body').textContent).toContain('No runs match these filters.');
    click('#his-runs-body [data-clear-filters]');
    expect(rowIds()).toHaveLength(3);
    expect($<HTMLInputElement>('#his-search').value).toBe('');
    expect(location.hash).toBe('#/history');
  });

  it('labels chips in plain text', () => {
    const chips = filterChips({ ...emptyFilters(), hrMin: 0, elevationMax: 100, paceMin: 270, paceMax: 330 });
    expect(chips.map((c) => c.label)).toEqual(['Pace 4:30–5:30 /km', 'Elevation ≤ 100 m', 'With HR']);
  });
});

describe('run comparison selection', () => {
  it('offers Compare for exactly two runs and navigates to the compare screen', async () => {
    await open();
    expect($('#his-compare-bar').hidden).toBe(true);
    check('[data-select="tempo"]');
    expect($('#his-compare-bar').hidden).toBe(false);
    expect(root.querySelector('[data-compare]')).toBeNull();
    expect($('#his-compare-bar').textContent).toContain('Select one more run');

    check('[data-select="long"]');
    expect(root.querySelector('[data-compare]')).not.toBeNull();
    check('[data-select="easy"]');
    expect(root.querySelector('[data-compare]')).toBeNull();
    check('[data-select="easy"]', false);

    click('[data-compare]');
    expect(location.hash).toBe('#/compare/tempo/long');
  });

  it('drops selected runs hidden by filters', async () => {
    await open();
    check('[data-select="easy"]');
    check('[data-select="long"]');
    click('#his-filter-toggle');
    click('[data-preset="long"]');
    expect(root.querySelector('[data-compare]')).toBeNull();
    expect($('#his-compare-bar').textContent).toContain('1 selected');
    expect($<HTMLInputElement>('[data-select="long"]').checked).toBe(true);
  });
});
