// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../src/data/types';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';

// ---- In-memory stand-ins for IndexedDB, Chart.js and toasts ----

const store: Record<string, { id: string }[]> = {};
const dataListeners = new Set<(s: string) => void>();
const toasts: string[] = [];

vi.mock('../src/data/db', () => ({
  listActivities: async () => [...((store.activities ?? []) as Activity[])],
  getAll: async (name: string) => [...(store[name] ?? [])],
  putMany: async (name: string, values: { id: string }[]) => {
    const list = store[name] ?? (store[name] = []);
    for (const v of values) {
      const i = list.findIndex((x) => x.id === v.id);
      if (i >= 0) list[i] = v;
      else list.push(v);
    }
    dataListeners.forEach((fn) => fn(name));
  },
  put: async () => {},
  remove: async () => {},
  newId: () => 'new',
  onDataChange: (fn: (s: string) => void) => {
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
  },
}));
vi.mock('../src/screens/training/chart', () => ({ weeklyChart: () => ({ destroy() {} }) }));
vi.mock('../src/ui/toast', () => ({ showToast: (m: string) => toasts.push(m) }));

const { mount } = await import('../src/screens/training');
const { setLang } = await import('../src/i18n');

// ---- Fixtures: week of Mon 12 Oct 2026, run on Monday (rest), easy run planned on Tuesday ----

const WEEK = '2026-10-12';
const local = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const monRun: Activity = {
  id: 'mon-run',
  name: 'Morning run',
  type: 'run',
  startTime: local('2026-10-12', 7),
  hasStartTime: true,
  fileName: 'x.gpx',
  importedAt: 0,
  summary: {
    distance: 13020,
    elapsedTime: 5240,
    movingTime: 5240,
    avgPace: 404,
    elevationGain: 0,
    elevationLoss: 0,
    has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
    bounds: [[0, 0], [0, 0]],
  },
};
const plan: TrainingPlan = { id: 'p', name: 'Half', goal: 'half', createdAt: 1 };
const wo = (id: string, date: string, kind: PlannedWorkout['kind'], km?: number): PlannedWorkout => ({
  id, planId: 'p', date, kind, title: '', ...(km ? { distance: km * 1000 } : {}),
});

// jsdom has no DragEvent/DataTransfer: plain events with a fake dataTransfer.
function drag(type: string, target: Element): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const data = new Map<string, string>();
  Object.defineProperty(e, 'dataTransfer', {
    value: { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' },
  });
  target.dispatchEvent(e);
  return e;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let root: HTMLElement;
let cleanup: (() => void) | void;

beforeAll(() => setLang('en'));
beforeEach(async () => {
  toasts.length = 0;
  localStorage.clear();
  store.plans = [plan];
  store.workouts = [wo('rest-mon', '2026-10-12', 'rest'), wo('easy-tue', '2026-10-13', 'easy', 8), wo('long-sun', '2026-10-18', 'long', 14)];
  store.activities = [monRun];
  location.hash = `#/training?week=${WEEK}`;
  root = document.createElement('div');
  document.body.append(root);
  cleanup = mount(root, {});
  await flush();
});
afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  root.remove();
});

const chip = (id: string) => root.querySelector<HTMLElement>(`.trn-wo[data-drop="${id}"]`)!;

describe('training week drag and drop', () => {
  it('links an extra run to a workout on another day', async () => {
    const extra = root.querySelector<HTMLElement>('.trn-extra[data-run="mon-run"]')!;
    expect(extra.draggable).toBe(true);
    // Rest days are not drop targets.
    expect(root.querySelector('.trn-wo.trn-kind-rest[data-drop]')).toBeNull();

    drag('dragstart', extra);
    const over = drag('dragover', chip('easy-tue').querySelector('.trn-wo-title')!);
    expect(over.defaultPrevented).toBe(true);
    expect(chip('easy-tue').classList.contains('is-drop-target')).toBe(true);
    drag('drop', chip('easy-tue'));
    await flush();

    const tue = store.workouts.find((w) => w.id === 'easy-tue') as PlannedWorkout;
    expect(tue.linkedActivityId).toBe('mon-run');
    expect(root.querySelector('.trn-extra')).toBeNull();
    expect(chip('easy-tue').querySelector('.trn-run[data-run="mon-run"]')).not.toBeNull();
    expect(chip('easy-tue').classList.contains('trn-st-done')).toBe(true);
    expect(toasts.at(-1)).toContain('Easy run');
  });

  it('moves a linked run to another day, dropping on the day itself', async () => {
    (store.workouts[1] as PlannedWorkout).linkedActivityId = 'mon-run';
    dataListeners.forEach((fn) => fn('workouts'));
    await flush();

    drag('dragstart', chip('easy-tue').querySelector('.trn-run')!);
    const sunday = chip('long-sun').closest('.trn-day')!;
    drag('dragover', sunday.querySelector('.trn-day-head')!);
    // Over the day, the workout that will get the run is highlighted.
    expect(chip('long-sun').classList.contains('is-drop-target')).toBe(true);
    drag('drop', sunday.querySelector('.trn-day-head')!);
    await flush();

    const [, tue, sun] = store.workouts as PlannedWorkout[];
    expect(tue.linkedActivityId).toBeUndefined();
    expect(sun.linkedActivityId).toBe('mon-run');
    expect(chip('long-sun').querySelector('.trn-run')).not.toBeNull();
    expect(chip('easy-tue').classList.contains('trn-st-missed')).toBe(true);
  });

  it('shows two weeks so a run can go to the previous week', async () => {
    // Sunday's long run was done on the next Monday.
    const nextMon: Activity = { ...monRun, id: 'next-mon', startTime: local('2026-10-19', 7), summary: { ...monRun.summary, distance: 14200 } };
    store.activities = [nextMon];
    dataListeners.forEach((fn) => fn('activities'));
    await flush();
    expect(root.querySelector('.trn-extra')).toBeNull(); // Not in the 1-week view.

    root.querySelector<HTMLElement>('[data-action="week-span"][data-span="2"]')!.click();
    expect(root.querySelectorAll('.trn-day')).toHaveLength(14);
    expect(root.querySelectorAll('.trn-week-row')).toHaveLength(2);
    expect(localStorage.getItem('lapwing:training:week-span')).toBe('2');

    drag('dragstart', root.querySelector('.trn-extra[data-run="next-mon"]')!);
    drag('drop', chip('long-sun'));
    await flush();
    expect((store.workouts[2] as PlannedWorkout).linkedActivityId).toBe('next-mon');
    expect(chip('long-sun').classList.contains('trn-st-done')).toBe(true);

    root.querySelector<HTMLElement>('[data-action="week-span"][data-span="1"]')!.click();
    expect(root.querySelectorAll('.trn-day')).toHaveLength(7);
    expect(chip('long-sun').querySelector('.trn-run[data-run="next-mon"]')).not.toBeNull();
  });

  it('ignores drags that are not runs', async () => {
    const over = drag('dragover', chip('easy-tue'));
    expect(over.defaultPrevented).toBe(false);
    drag('drop', chip('easy-tue'));
    await flush();
    expect((store.workouts[1] as PlannedWorkout).linkedActivityId).toBeUndefined();
  });
});
