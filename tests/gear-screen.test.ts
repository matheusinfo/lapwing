// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, Shoe } from '../src/data/types';
import { answerConfirm } from './helpers/confirm';

// In-memory replacement for the IndexedDB layer, with change notifications.
const mem = vi.hoisted(() => {
  const stores = new Map<string, Map<string, { id: string }>>();
  const listeners = new Set<(store: string) => void>();
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const notify = (name: string) => listeners.forEach((fn) => fn(name));
  return { stores, listeners, store, clone, notify };
});

vi.mock('../src/data/db', () => ({
  getAll: async (name: string) => [...mem.store(name).values()].map(mem.clone),
  get: async (name: string, id: string) => {
    const v = mem.store(name).get(id);
    return v ? mem.clone(v) : undefined;
  },
  put: async (name: string, v: { id: string }) => {
    mem.store(name).set(v.id, mem.clone(v));
    mem.notify(name);
  },
  putMany: async (name: string, vs: { id: string }[]) => {
    vs.forEach((v) => mem.store(name).set(v.id, mem.clone(v)));
    mem.notify(name);
  },
  remove: async (name: string, id: string) => {
    mem.store(name).delete(id);
    mem.notify(name);
  },
  listActivities: async () => [...mem.store('activities').values()].map(mem.clone),
  saveActivity: async (a: { id: string }) => {
    mem.store('activities').set(a.id, mem.clone(a));
    mem.notify('activities');
  },
  onDataChange: (fn: (store: string) => void) => {
    mem.listeners.add(fn);
    return () => mem.listeners.delete(fn);
  },
  newId: () => `id-${Math.random().toString(36).slice(2)}`,
}));

const { mount } = await import('../src/screens/gear/index');
const { setLang } = await import('../src/i18n');

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const run = (id: string, km: number, extra: Partial<Activity> = {}): Activity => ({
  id,
  name: 'Run',
  type: 'run',
  startTime: Date.now() - 86_400_000,
  hasStartTime: true,
  fileName: 'x.gpx',
  importedAt: 0,
  summary: {
    distance: km * 1000,
    elapsedTime: km * 330,
    movingTime: km * 300,
    avgPace: 300,
    elevationGain: 0,
    elevationLoss: 0,
    has: { time: true, ele: false, hr: false, cad: false, temp: false, power: false },
    bounds: [[0, 0], [0, 0]],
  },
  ...extra,
});

const addShoe = (s: Partial<Shoe> & { id: string }) =>
  mem.store('shoes').set(s.id, { name: s.id, startDistance: 0, retireDistance: 700_000, createdAt: 1, ...s });

let root: HTMLElement;
let unmount: void | (() => void);

beforeEach(() => {
  setLang('en');
  mem.stores.clear();
  mem.listeners.clear();
  document.body.innerHTML = '<div id="toast"></div><main></main>';
  root = document.querySelector('main')!;
});

afterEach(() => {
  if (unmount) unmount();
  unmount = undefined;
  vi.restoreAllMocks();
});

describe('gear screen', () => {
  it('shows an empty state and adds a first shoe as default', async () => {
    unmount = mount(root, {});
    await flush();
    expect(root.querySelector('.gear-empty')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-action="add"]')!.click();
    const form = root.querySelector<HTMLFormElement>('.gear-dialog form')!;
    expect((form.elements.namedItem('retire') as HTMLInputElement).value).toBe('700');
    expect((form.elements.namedItem('isDefault') as HTMLInputElement).checked).toBe(true);

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(form.querySelector<HTMLElement>('.gear-form-error')!.hidden).toBe(false);

    (form.elements.namedItem('name') as HTMLInputElement).value = '<b>Pegasus</b>';
    (form.elements.namedItem('start') as HTMLInputElement).value = '50,5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const saved = [...mem.store('shoes').values()] as Shoe[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: '<b>Pegasus</b>', startDistance: 50_500, retireDistance: 700_000, isDefault: true });
    const card = root.querySelector('.gear-card')!;
    expect(card.querySelector('h2')!.textContent).toBe('<b>Pegasus</b>'); // Escaped, not markup.
    expect(card.textContent).toContain('Default');
  });

  it('renders wear status, retired section and deletes with unassignment', async () => {
    addShoe({ id: 'worn', name: 'Old pair', startDistance: 590_000, isDefault: true });
    addShoe({ id: 'old', name: 'Retired pair', retiredAt: Date.now() - 1000 });
    mem.store('activities').set('r1', run('r1', 10, { shoeId: 'worn' }));
    mem.store('activities').set('r2', run('r2', 5));
    unmount = mount(root, {});
    await flush();

    const card = root.querySelector<HTMLElement>('.gear-card[data-id="worn"]')!;
    expect(card.classList.contains('gear-worn')).toBe(true);
    expect(card.querySelector('.badge.warn')!.textContent).toBe('Wearing out');
    expect(card.textContent).toContain('600 km');
    expect(root.querySelector('.gear-retired .gear-card[data-id="old"]')).not.toBeNull();
    expect(root.querySelector('.gear-hint')!.textContent).toContain('1 run(s) have no shoe');

    card.querySelector<HTMLButtonElement>('[data-action="delete"]')!.click();
    const shown = await answerConfirm(true);
    expect(shown.title).toBe('Delete shoe');
    expect(shown.message).toContain('1 run(s)');
    expect(shown.dialog.querySelector('.btn.danger-solid')).not.toBeNull();
    await flush();
    expect(mem.store('shoes').has('worn')).toBe(false);
    expect((mem.store('activities').get('r1') as Activity).shoeId).toBeUndefined();
    expect(root.querySelector('.gear-card[data-id="worn"]')).toBeNull();
  });

  it('bulk-assigns a shoe to past runs with a count preview', async () => {
    addShoe({ id: 's1', name: 'Daily' });
    mem.store('activities').set('r1', run('r1', 10));
    mem.store('activities').set('r2', run('r2', 5, { shoeId: 'x' }));
    mem.store('activities').set('w1', run('w1', 3, { type: 'walk' }));
    unmount = mount(root, {});
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="assign-all"]')!.click();
    const form = root.querySelector<HTMLFormElement>('.gear-dialog form')!;
    const preview = form.querySelector('.gear-preview')!;
    expect(preview.textContent).toContain('1 run(s)');
    const only = form.elements.namedItem('onlyUnassigned') as HTMLInputElement;
    only.checked = false;
    only.dispatchEvent(new Event('change', { bubbles: true }));
    expect(preview.textContent).toContain('2 run(s)');

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const acts = mem.store('activities') as Map<string, Activity>;
    expect(acts.get('r1')!.shoeId).toBe('s1');
    expect(acts.get('r2')!.shoeId).toBe('s1');
    expect(acts.get('w1')!.shoeId).toBeUndefined();
  });

  it('switches the default and retires a shoe', async () => {
    addShoe({ id: 'a', name: 'A', isDefault: true });
    addShoe({ id: 'b', name: 'B' });
    unmount = mount(root, {});
    await flush();
    root.querySelector<HTMLButtonElement>('.gear-card[data-id="b"] [data-action="default"]')!.click();
    await flush();
    const shoes = mem.store('shoes') as Map<string, Shoe>;
    expect(shoes.get('a')!.isDefault).toBe(false);
    expect(shoes.get('b')!.isDefault).toBe(true);

    root.querySelector<HTMLButtonElement>('.gear-card[data-id="b"] [data-action="retire"]')!.click();
    await flush();
    expect(shoes.get('b')!.retiredAt).toBeTypeOf('number');
    expect(shoes.get('b')!.isDefault).toBe(false);
    expect(root.querySelector('.gear-retired .gear-card[data-id="b"]')).not.toBeNull();
  });
});
