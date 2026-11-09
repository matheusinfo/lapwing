import { getSync, type SyncState, type SyncStatus } from '../../data/sync';
import { formatDateTime, formatNumber } from '../../format';
import { onLangChange } from '../../i18n';
import { showToast } from '../../ui/toast';
import { ts, type SyncKey } from './sync-i18n';
import './sync.css';

const STATE_KEYS: Record<Exclude<SyncState, 'off'>, SyncKey> = {
  idle: 'stateIdle',
  syncing: 'stateSyncing',
  error: 'stateError',
  offline: 'stateOffline',
  auth: 'stateAuth',
};

/**
 * The "Sync" card of the settings page. Shown only when the site has a sync
 * server (see data/sync.ts); hidden on plain static hosts.
 */
export function mountSyncSection(el: HTMLElement): () => void {
  const engine = getSync();
  const listeners = new AbortController();
  const cleanups: (() => void)[] = [() => listeners.abort()];

  el.innerHTML = `
    <section class="card sy-card">
      <h2 class="card-title sy-title"></h2>
      <p class="muted sy-intro"></p>
      <p class="sy-state" role="status"><span class="sy-dot"></span><span class="sy-state-text"></span></p>
      <p class="muted sy-detail"></p>
      <div class="sy-actions"><button type="button" class="btn sy-run"></button></div>
      <p class="muted sy-hint"></p>
    </section>`;
  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;

  function render(status: SyncStatus | null) {
    const state = status?.state ?? 'off';
    el.hidden = state === 'off';
    if (!status || state === 'off') return;
    $('.sy-title').textContent = ts('title');
    $('.sy-intro').textContent = ts('intro');
    $('.sy-hint').textContent = ts('localOnly');
    $('.sy-card').dataset.state = state;
    $('.sy-state-text').textContent = ts(STATE_KEYS[state]);
    const lines = [status.lastSync ? ts('lastSync', { date: formatDateTime(status.lastSync) }) : ts('never')];
    if (status.pending) lines.push(ts('pending', { count: formatNumber(status.pending) }));
    $('.sy-detail').textContent = lines.join(' · ');
    const button = $<HTMLButtonElement>('.sy-run');
    button.textContent = state === 'auth' ? ts('reload') : ts('syncNow');
    button.disabled = state === 'syncing';
  }

  $('.sy-run').addEventListener(
    'click',
    () => {
      if (!engine) return;
      if (engine.status.state === 'auth') {
        location.reload();
        return;
      }
      engine.sync().then(
        () => showToast(ts('synced')),
        () => {}, // the card already shows the error
      );
    },
    { signal: listeners.signal },
  );

  render(engine?.status ?? null);
  if (engine) cleanups.push(engine.onStatus(render));
  cleanups.push(onLangChange(() => render(engine?.status ?? null)));
  return () => cleanups.forEach((fn) => fn());
}
