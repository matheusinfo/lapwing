// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSummary } from '../src/data/analysis';
import type { Activity, TrackPoint } from '../src/data/types';

const h = vi.hoisted(() => ({
  activities: [] as Activity[],
  tracks: new Map<string, TrackPoint[]>(),
  charts: [] as { config: { data: { datasets: { label: string }[] } }; destroyed: boolean }[],
  maps: [] as { removed: boolean }[],
  dataListeners: new Set<(store: string) => void>(),
}));

vi.mock('../src/data/db', () => ({
  listActivities: async () => [...h.activities].sort((a, b) => b.startTime - a.startTime),
  getTrack: async (id: string) => h.tracks.get(id) ?? [],
  getSettings: async () => ({ maxHr: 190, restingHr: 60, hrZoneBounds: [0.6, 0.7, 0.8, 0.9] }),
  onDataChange: (fn: (store: string) => void) => {
    h.dataListeners.add(fn);
    return () => h.dataListeners.delete(fn);
  },
}));

vi.mock('../src/ui/chart-theme', () => ({
  chartColors: { pace: '#1c7ed6', accent: '#e8590c', grid: '#e9ecef', muted: '#5f6b76' },
  Chart: class {
    destroyed = false;
    constructor(_canvas: unknown, public config: { data: { datasets: { label: string }[] } }) {
      h.charts.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

vi.mock('../src/map/base', () => ({
  createBaseMap: () => {
    const map = {
      removed: false,
      remove() {
        this.removed = true;
      },
      addSource() {},
      addLayer() {},
      loaded: () => true,
    };
    h.maps.push(map);
    return map;
  },
  whenLoaded: () => Promise.resolve(),
}));

const { mount } = await import('../src/screens/compare');
const { setLang } = await import('../src/i18n');

function steadyRun(metres: number, pace: number, start: number, hr?: number): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const speed = 1000 / pace;
  for (let t = 0, m = 0; m <= metres; t++, m = t * speed) {
    pts.push({ lat: 0, lon: m / 111320, ele: 50 + m / 200, time: start + t * 1000, ...(hr ? { hr } : {}) });
  }
  return pts;
}

function addRun(id: string, name: string, metres: number, pace: number, day: number, hr?: number) {
  const points = steadyRun(metres, pace, Date.UTC(2026, 9, day, 7), hr);
  h.activities.push({
    id,
    name,
    type: 'run',
    startTime: points[0].time!,
    hasStartTime: true,
    fileName: `${id}.gpx`,
    importedAt: 0,
    summary: computeSummary(points),
  });
  h.tracks.set(id, points);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function mountAt(params: Record<string, string>) {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = mount(root, params) as () => void;
  await flush();
  await flush();
  return { root, cleanup };
}

beforeEach(() => {
  setLang('en');
  h.activities = [];
  h.tracks.clear();
  h.charts = [];
  h.maps = [];
  addRun('a1', 'Easy <b>run</b>', 5200, 330, 10, 145);
  addRun('b2', 'Tempo', 6100, 300, 20, 165);
  addRun('c3', 'Long', 15000, 340, 25);
  location.hash = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('compare screen', () => {
  it('shows pickers and a hint with no runs chosen', async () => {
    const { root, cleanup } = await mountAt({});
    const selects = root.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    // Newest first, plus the placeholder.
    expect([...selects[0].options].map((o) => o.value)).toEqual(['', 'c3', 'b2', 'a1']);
    expect(root.querySelector('.cmp-hint-card')?.textContent).toContain('Choose two runs');
    expect(root.querySelector<HTMLButtonElement>('.cmp-swap')!.disabled).toBe(true);
    cleanup();
  });

  it('suggests similar runs once the first is chosen and navigates on pick', async () => {
    const { root, cleanup } = await mountAt({ a: 'a1' });
    expect(root.querySelector('.cmp-hint-card')?.textContent).toContain('second run');
    const suggestions = [...root.querySelectorAll<HTMLButtonElement>('[data-suggest]')].map((b) => b.dataset.suggest);
    expect(suggestions[0]).toBe('b2'); // Closest distance.
    root.querySelector<HTMLButtonElement>('[data-suggest="b2"]')!.click();
    expect(location.hash).toBe('#/compare/a1/b2');

    const selB = root.querySelector<HTMLSelectElement>('select[data-slot="b"]')!;
    expect(selB.querySelector<HTMLOptionElement>('option[value="a1"]')!.disabled).toBe(true);
    selB.value = 'c3';
    selB.dispatchEvent(new Event('change', { bubbles: true }));
    expect(location.hash).toBe('#/compare/a1/c3');
    cleanup();
  });

  it('renders the full comparison and cleans up', async () => {
    const { root, cleanup } = await mountAt({ a: 'a1', b: 'b2' });
    // Run names are escaped.
    expect(root.querySelector('.cmp-legend')!.innerHTML).toContain('Easy &lt;b&gt;run&lt;/b&gt;');
    expect(root.querySelector('.cmp-legend b')).toBeNull();

    const summary = root.querySelector('.cmp-summary')!;
    const paceRow = [...summary.querySelectorAll('tr')].find((r) => r.textContent!.includes('Average pace'))!;
    expect(paceRow.querySelector('.cmp-delta')!.classList.contains('cmp-better')).toBe(true);
    expect(paceRow.querySelector('.cmp-delta')!.textContent).toBe('−0:30 /km');
    expect(summary.textContent).toContain('Training load');

    const efforts = root.querySelector('.cmp-efforts')!.textContent!;
    expect(efforts).toContain('5 km');
    expect(efforts).not.toContain('10 km');

    const splitRows = root.querySelectorAll('.cmp-splits tbody tr');
    expect(splitRows).toHaveLength(7); // B is 6.1 km.

    // Pace, HR, elevation and time gap charts; both runs overlaid.
    expect(h.charts).toHaveLength(4);
    expect(h.charts[0].config.data.datasets.map((d) => d.label)).toEqual(['Run A', 'Run B']);
    expect(h.maps).toHaveLength(1);

    root.querySelector<HTMLButtonElement>('.cmp-swap')!.click();
    expect(location.hash).toBe('#/compare/b2/a1');

    cleanup();
    expect(h.charts.every((c) => c.destroyed)).toBe(true);
    expect(h.maps[0].removed).toBe(true);
    expect(h.dataListeners.size).toBe(0);
  });

  it('only overlays series a run has', async () => {
    const { root, cleanup } = await mountAt({ a: 'a1', b: 'c3' });
    const hrChart = h.charts.find((c) => c.config.data.datasets.length === 1 && c.config.data.datasets[0].label === 'Run A');
    expect(hrChart).toBeDefined(); // c3 has no heart rate.
    expect(root.querySelector('.cmp-efforts')!.textContent).toContain('5 km');
    cleanup();
  });

  it('shows a friendly message for a missing run', async () => {
    const { root, cleanup } = await mountAt({ a: 'a1', b: 'nope' });
    expect(root.querySelector('.cmp-missing')?.textContent).toContain('Run not found');
    expect(root.querySelectorAll('select')).toHaveLength(2);
    expect(h.charts).toHaveLength(0);
    cleanup();
  });

  it('rerenders in Portuguese and reloads on data change', async () => {
    const { root, cleanup } = await mountAt({ a: 'a1', b: 'b2' });
    setLang('pt-BR');
    expect(root.querySelector('h1')!.textContent).toBe('Comparar corridas');
    expect(h.charts.slice(0, 4).every((c) => c.destroyed)).toBe(true);

    h.activities = h.activities.filter((x) => x.id !== 'b2');
    h.dataListeners.forEach((fn) => fn('activities'));
    await flush();
    await flush();
    expect(root.querySelector('.cmp-missing')).not.toBeNull();
    cleanup();
  });

  it('ignores a load that finishes after unmount', async () => {
    const root = document.createElement('div');
    const cleanup = mount(root, { a: 'a1', b: 'b2' }) as () => void;
    cleanup();
    await flush();
    await flush();
    expect(h.charts).toHaveLength(0);
    expect(root.querySelector('.cmp-legend')).toBeNull();
  });
});
