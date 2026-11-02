// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StravaSettings, SyncOptions, SyncResult } from '../src/data/strava';

const state = vi.hoisted(() => ({
  settings: undefined as StravaSettings | undefined,
  pending: null as unknown,
  syncResult: null as unknown,
  syncGate: null as Promise<void> | null,
}));

vi.mock('../src/data/db', () => ({ onDataChange: () => () => {}, remove: vi.fn(async () => {}) }));
vi.mock('../src/data/strava', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/strava')>();
  return {
    ...real,
    loadStrava: vi.fn(async () => state.settings),
    saveStrava: vi.fn(async (s: StravaSettings) => void (state.settings = s)),
    takePendingAuth: vi.fn(() => state.pending),
    startAuthorization: vi.fn(),
    exchangeCode: vi.fn(async (s: StravaSettings) => (state.settings = { ...s, accessToken: 'a', refreshToken: 'r', athlete: { id: 1, name: 'Ana <b>' } })),
    disconnect: vi.fn(async (s: StravaSettings) => (state.settings = real.withoutTokens(s))),
    syncStrava: vi.fn(async (opts: SyncOptions) => {
      opts.onProgress?.({ phase: 'import', done: 1, total: 4 });
      await state.syncGate;
      return state.syncResult;
    }),
  };
});

import * as strava from '../src/data/strava';
import * as db from '../src/data/db';
import { answerConfirm } from './helpers/confirm';
import { mountStravaSection } from '../src/screens/settings/strava-section';

const flush = () => new Promise((r) => setTimeout(r, 0));
const connected: StravaSettings = {
  id: 'strava',
  clientId: '123',
  clientSecret: 'shh',
  accessToken: 'a',
  refreshToken: 'r',
  athlete: { id: 1, name: 'Ana' },
};

let el: HTMLElement;
let cleanup: () => void;
beforeEach(() => {
  state.settings = undefined;
  state.pending = null;
  state.syncGate = null;
  vi.clearAllMocks();
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  cleanup?.();
  el.remove();
});

describe('Strava settings section', () => {
  it('says that syncing requires a Strava subscription', async () => {
    cleanup = mountStravaSection(el);
    await flush();
    expect(el.querySelector('.strava-head .badge.warn')!.textContent).toBe('Strava subscribers');
    const notice = el.querySelector('.strava-subscription')!;
    expect(notice.textContent).toContain('Requires a Strava subscription');
    expect(notice.querySelector('a')!.getAttribute('href')).toBe('#/activity');

    // Once connected, the badge stays but the setup notice is gone.
    cleanup();
    state.settings = connected;
    cleanup = mountStravaSection(el);
    await flush();
    expect(el.querySelector('.strava-head .badge.warn')).not.toBeNull();
    expect(el.querySelector('.strava-subscription')).toBeNull();
  });

  it('asks before forgetting the credentials', async () => {
    state.settings = { id: 'strava', clientId: '123', clientSecret: 'shh' };
    cleanup = mountStravaSection(el);
    await flush();
    const forget = () => el.querySelector<HTMLButtonElement>('[data-act="forget"]')!;

    forget().click();
    const shown = await answerConfirm(false);
    expect(shown.title).toBe('Forget Strava credentials');
    expect(shown.dialog.querySelector('.btn.danger-solid')).not.toBeNull();
    await flush();
    expect(db.remove).not.toHaveBeenCalled();

    forget().click();
    await answerConfirm(true);
    await vi.waitFor(() => expect(db.remove).toHaveBeenCalledWith('settings', 'strava'));
  });

  it('shows setup steps and saves credentials before redirecting', async () => {
    cleanup = mountStravaSection(el);
    await flush();
    expect(el.querySelector('.strava-setup')?.hasAttribute('open')).toBe(true);
    expect(el.textContent).toContain('localhost');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(el.querySelector('.strava-alert')).not.toBeNull();
    expect(strava.startAuthorization).not.toHaveBeenCalled();

    const id = el.querySelector<HTMLInputElement>('input[name=clientId]')!;
    const secret = el.querySelector<HTMLInputElement>('input[name=clientSecret]')!;
    id.value = ' 123 ';
    id.dispatchEvent(new Event('input', { bubbles: true }));
    secret.value = 'shh';
    secret.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(state.settings).toMatchObject({ clientId: '123', clientSecret: 'shh' });
    expect(strava.startAuthorization).toHaveBeenCalledWith('123');
  });

  it('pre-fills the client id of a record restored without secrets', async () => {
    state.settings = { id: 'strava', clientId: '777', syncCursor: 5 } as StravaSettings;
    cleanup = mountStravaSection(el);
    await flush();
    expect(el.querySelector<HTMLInputElement>('input[name=clientId]')!.value).toBe('777');
    expect(el.querySelector<HTMLInputElement>('input[name=clientSecret]')!.value).toBe('');
    expect(el.querySelector('[data-act=sync]')).toBeNull();
  });

  it('finishes the sign-in on return and escapes the athlete name', async () => {
    state.settings = { id: 'strava', clientId: '123', clientSecret: 'shh' };
    state.pending = { code: 'C', scope: 'read,activity:read_all' };
    cleanup = mountStravaSection(el);
    await flush();
    expect(strava.exchangeCode).toHaveBeenCalled();
    expect(el.querySelector('.strava-status strong')!.textContent).toContain('Ana <b>');
    expect(el.querySelector('[data-act=sync]')).not.toBeNull();
  });

  it('shows a denied access', async () => {
    state.pending = { error: 'denied' };
    cleanup = mountStravaSection(el);
    await flush();
    expect(el.querySelector('.strava-alert')!.textContent).toMatch(/not granted/);
  });

  it('syncs with progress and shows the result', async () => {
    state.settings = { ...connected };
    let release!: () => void;
    state.syncGate = new Promise((r) => (release = r));
    state.syncResult = {
      imported: [{ id: 'x1', name: '<Evening>', startTime: Date.UTC(2026, 9, 1), summary: { distance: 5000 } }],
      duplicates: 2,
      skipped: 1,
      failed: [],
      total: 4,
      ignored: 0,
      cancelled: false,
      usage: { short: [10, 100], daily: [50, 1000] },
    } as unknown as SyncResult;
    cleanup = mountStravaSection(el);
    await flush();
    el.querySelector<HTMLButtonElement>('[data-act=sync]')!.click();
    await flush();
    expect(el.querySelector('.strava-progress')!.hasAttribute('hidden')).toBe(false);
    expect(el.querySelector('.strava-progress-text')!.textContent).toBe('Importing 1 / 4');
    expect(el.querySelector<HTMLButtonElement>('[data-act=sync]')!.disabled).toBe(true);
    release();
    await flush();
    await flush();
    const result = el.querySelector('.strava-result')!;
    expect(result.querySelector('a[href="#/activity/x1"]')!.textContent).toBe('<Evening>');
    expect(result.textContent).toContain('1 imported');
    expect(result.textContent).toContain('2 already in the app');
    expect(result.textContent).toContain('10 / 100');
    expect(el.querySelector('.strava-progress')!.hasAttribute('hidden')).toBe(true);
  });

  it('aborts a running sync on cleanup', async () => {
    state.settings = { ...connected };
    state.syncGate = new Promise(() => {});
    cleanup = mountStravaSection(el);
    await flush();
    el.querySelector<HTMLButtonElement>('[data-act=sync]')!.click();
    await flush();
    const signal = vi.mocked(strava.syncStrava).mock.calls[0][0].signal!;
    expect(signal.aborted).toBe(false);
    cleanup();
    expect(signal.aborted).toBe(true);
  });

  it('forgets the tokens after an unauthorized error', async () => {
    state.settings = { ...connected };
    state.syncResult = { imported: [], duplicates: 0, skipped: 0, failed: [], total: 0, ignored: 0, cancelled: false, error: 'unauthorized' };
    cleanup = mountStravaSection(el);
    await flush();
    el.querySelector<HTMLButtonElement>('[data-act=sync]')!.click();
    await flush();
    await flush();
    expect(state.settings).toEqual({ id: 'strava', clientId: '123', clientSecret: 'shh' });
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.querySelector('.strava-alert')!.textContent).toMatch(/connect again/);
  });
});
