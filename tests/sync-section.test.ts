// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../src/data/sync';

const fake = vi.hoisted(() => {
  const listeners = new Set<(s: SyncStatus) => void>();
  const engine = {
    status: { state: 'off', lastSync: null, pending: 0 } as SyncStatus,
    sync: vi.fn(async () => {}),
    onStatus: (fn: (s: SyncStatus) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(patch: Partial<SyncStatus>) {
      engine.status = { ...engine.status, ...patch };
      listeners.forEach((fn) => fn(engine.status));
    },
  };
  return { engine, current: null as typeof engine | null };
});

vi.mock('../src/data/sync', () => ({ getSync: () => fake.current }));

import { setLang } from '../src/i18n';
import { mountSyncSection } from '../src/screens/settings/sync-section';

beforeEach(() => {
  setLang('pt-BR');
  fake.engine.status = { state: 'off', lastSync: null, pending: 0 };
  fake.engine.sync.mockClear();
  fake.current = fake.engine;
});

describe('sync settings card', () => {
  it('is hidden on sites without a sync server', () => {
    const el = document.createElement('div');
    fake.current = null;
    mountSyncSection(el);
    expect(el.hidden).toBe(true);
    fake.current = fake.engine;
    const el2 = document.createElement('div');
    mountSyncSection(el2);
    expect(el2.hidden).toBe(true);
  });

  it('shows the state, pending changes and syncs on demand', () => {
    const el = document.createElement('div');
    const stop = mountSyncSection(el);
    fake.engine.emit({ state: 'idle', lastSync: Date.UTC(2026, 10, 1, 12), pending: 3 });
    expect(el.hidden).toBe(false);
    expect(el.querySelector('.sy-state-text')!.textContent).toBe('Tudo sincronizado');
    expect(el.querySelector('.sy-detail')!.textContent).toContain('3 mudanças aguardando envio');
    el.querySelector<HTMLButtonElement>('.sy-run')!.click();
    expect(fake.engine.sync).toHaveBeenCalledOnce();

    fake.engine.emit({ state: 'syncing' });
    expect(el.querySelector<HTMLButtonElement>('.sy-run')!.disabled).toBe(true);
    fake.engine.emit({ state: 'auth' });
    expect(el.querySelector('.sy-state-text')!.textContent).toContain('sessão expirou');
    expect(el.querySelector('.sy-run')!.textContent).toBe('Recarregar');
    stop();
    fake.engine.emit({ state: 'idle' });
    expect(el.querySelector('.sy-state-text')!.textContent).toContain('sessão expirou');
  });
});
