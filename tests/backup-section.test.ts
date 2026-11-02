// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => {
  const STORES = ['activities', 'tracks', 'plans', 'workouts', 'settings', 'shoes', 'goals'] as const;
  const data = new Map<string, Map<unknown, { id: unknown }>>();
  const listeners = new Set<(s: string) => void>();
  const reset = () => STORES.forEach((s) => data.set(s, new Map()));
  reset();
  return { STORES, data, listeners, reset };
});

vi.mock('../src/data/db', () => ({
  STORES: [...mem.STORES],
  SCHEMA_VERSION: 2,
  countStores: async (stores: string[]) => Object.fromEntries(stores.map((s) => [s, mem.data.get(s)!.size])),
  readStores: async (stores: string[]) => Object.fromEntries(stores.map((s) => [s, [...mem.data.get(s)!.values()]])),
  get: async (store: string, id: string) => mem.data.get(store)!.get(id),
  bulkWrite: async (writes: { store: string; records: { id: unknown }[] }[], opts: { replace?: boolean } = {}) => {
    const stores = [...new Set(writes.map((w) => w.store))];
    if (opts.replace) stores.forEach((s) => mem.data.get(s)!.clear());
    for (const w of writes) w.records.forEach((r) => mem.data.get(w.store)!.set(r.id, r));
    stores.forEach((s) => mem.listeners.forEach((fn) => fn(s)));
  },
  onDataChange: (fn: (s: string) => void) => {
    mem.listeners.add(fn);
    return () => mem.listeners.delete(fn);
  },
}));

import { mountBackupSection } from '../src/screens/settings/backup-section';
import { answerConfirm } from './helpers/confirm';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await flush();
  expect(check()).toBe(true);
}

function chooseFile(el: HTMLElement, content: string, name = 'lapwing-backup-2026-11-01.json') {
  const input = el.querySelector<HTMLInputElement>('.bk-file')!;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const fileJson = (stores: object) =>
  JSON.stringify({ app: 'lapwing', format: 1, dbVersion: 2, exportedAt: '2026-11-01T10:00:00Z', stores });

let el: HTMLElement;
let cleanup: () => void;
beforeEach(() => {
  mem.reset();
  mem.data.get('plans')!.set('p1', { id: 'p1' });
  mem.data.get('shoes')!.set('s1', { id: 's1' });
  el = document.createElement('div');
  document.body.append(el);
  cleanup = mountBackupSection(el);
});
afterEach(() => {
  cleanup();
  el.remove();
  expect(mem.listeners.size).toBe(0);
});

describe('backup section', () => {
  it('shows stored counts and keeps them fresh', async () => {
    await until(() => el.querySelector('.bk-counts')!.textContent!.includes('1'));
    const values = () => [...el.querySelectorAll('.bk-counts dd')].map((d) => d.textContent);
    expect(values()).toEqual(['0', '1', '0', '0']);
    mem.data.get('goals')!.set('g1', { id: 'g1' });
    mem.listeners.forEach((fn) => fn('goals'));
    await until(() => values()[3] === '1');
  });

  it('shows an error for a file that is not a backup', async () => {
    chooseFile(el, '{"type":"FeatureCollection"}', 'route.geojson');
    const error = el.querySelector<HTMLElement>('.bk-error')!;
    await until(() => !error.hidden);
    expect(error.textContent).toMatch(/not a Lapwing backup/);
    expect(el.querySelector<HTMLElement>('.bk-preview')!.hidden).toBe(true);
  });

  it('previews a file and merges it', async () => {
    chooseFile(el, fileJson({ plans: [{ id: 'p2' }], laps: [{ id: 'x' }] }), '<b>evil</b>.json');
    const preview = el.querySelector<HTMLElement>('.bk-preview')!;
    await until(() => !preview.hidden);
    expect(preview.querySelector('.bk-file-name')!.textContent).toBe('<b>evil</b>.json');
    expect(preview.querySelector('b')).toBeNull();
    expect(preview.textContent).toMatch(/laps/);
    const apply = preview.querySelector<HTMLButtonElement>('.bk-apply')!;
    expect(apply.disabled).toBe(false);
    apply.click();
    await until(() => !el.querySelector<HTMLElement>('.bk-result')!.hidden);
    expect([...mem.data.get('plans')!.keys()]).toEqual(['p1', 'p2']);
    expect(preview.hidden).toBe(true);
  });

  it('requires confirmation before replacing', async () => {
    chooseFile(el, fileJson({ plans: [{ id: 'p9' }] }));
    const preview = el.querySelector<HTMLElement>('.bk-preview')!;
    await until(() => !preview.hidden);
    const replace = preview.querySelector<HTMLInputElement>('input[value="replace"]')!;
    replace.checked = true;
    replace.dispatchEvent(new Event('change', { bubbles: true }));
    const apply = preview.querySelector<HTMLButtonElement>('.bk-apply')!;
    expect(apply.classList.contains('danger-solid')).toBe(true);

    // Cancelling the confirmation changes nothing.
    apply.click();
    expect((await answerConfirm(false)).title).toBe('Replace all data?');
    expect([...mem.data.get('plans')!.keys()]).not.toEqual(['p9']);

    apply.click();
    await answerConfirm(true);
    await until(() => !el.querySelector<HTMLElement>('.bk-result')!.hidden);
    expect([...mem.data.get('plans')!.keys()]).toEqual(['p9']);
    expect([...mem.data.get('shoes')!.keys()]).toEqual(['s1']);
  });
});
