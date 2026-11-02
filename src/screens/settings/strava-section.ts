import './strava.css';
import { onDataChange, remove } from '../../data/db';
import {
  canReadActivities,
  disconnect,
  exchangeCode,
  isConnected,
  loadStrava,
  saveStrava,
  startAuthorization,
  StravaError,
  syncStrava,
  takePendingAuth,
  withoutTokens,
  STRAVA_ID,
  type StravaErrorCode,
  type StravaSettings,
  type SyncProgress,
  type SyncRange,
  type SyncResult,
} from '../../data/strava';
import { formatDate, formatDateTime, formatDistance } from '../../format';
import { onLangChange, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import { tr, type StravaKey } from './strava-i18n';
import { confirmDialog } from '../../ui/confirm';

const HTML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => HTML_ESCAPES[c]);

type ErrorKey = StravaErrorCode | 'missing';
const ERROR_KEYS: Record<ErrorKey, StravaKey | null> = {
  unauthorized: 'errUnauthorized',
  credentials: 'errCredentials',
  'rate-limit': 'errRateLimit',
  network: 'errNetwork',
  http: 'errHttp',
  aborted: null,
  denied: 'errDenied',
  state: 'errState',
  'not-connected': 'errNotConnected',
  missing: 'missingFields',
};

const RANGES: [SyncRange, StravaKey][] = [
  ['since-last', 'rangeSince'],
  ['30d', 'range30'],
  ['12m', 'range12'],
  ['all', 'rangeAll'],
];

/** Shown runs in the result list; the rest are summarized as "and N more". */
const MAX_LISTED = 10;

const codeOf = (err: unknown): StravaErrorCode => (err instanceof StravaError ? err.code : 'http');

/**
 * The Strava block of the settings page: setup instructions, connect /
 * disconnect, and syncing runs with progress and a result summary.
 */
export function mountStravaSection(el: HTMLElement): () => void {
  let disposed = false;
  let settings: StravaSettings | undefined;
  let loading = true;
  let connecting = false;
  let controller: AbortController | null = null;
  let progress: SyncProgress | null = null;
  let result: SyncResult | null = null;
  let error: ErrorKey | null = null;
  let range: SyncRange = '30d';
  let clientId = '';
  let clientSecret = '';

  const syncing = () => controller !== null;

  function render(): void {
    if (disposed) return;
    const errKey = error ? ERROR_KEYS[error] : null;
    el.innerHTML = `
      <section class="card strava">
        <div class="strava-head">
          <h2 class="card-title">${tr('title')}</h2>
          <span class="badge">${tr('optional')}</span>
          <span class="badge warn">${tr('subscribersBadge')}</span>
        </div>
        <p class="muted strava-intro">${tr('intro')}</p>
        ${errKey ? `<p class="strava-alert" role="alert">${tr(errKey)}</p>` : ''}
        ${loading ? '' : connecting ? `<p class="strava-status muted">${tr('connecting')}</p>` : isConnected(settings) ? connectedHtml(settings) : setupHtml()}
      </section>`;
    updateProgress();
  }

  function setupHtml(): string {
    const hasCredentials = !!settings?.clientId;
    return `
      <p class="strava-alert warn strava-subscription">${tr('subscriptionNotice')}</p>
      <details class="strava-setup"${hasCredentials ? '' : ' open'}>
        <summary>${tr('setupTitle')}</summary>
        <ol>
          <li>${tr('setup1')}</li>
          <li>${tr('setup2', { host: esc(location.hostname || 'localhost') })}</li>
          <li>${tr('setup3')}</li>
        </ol>
      </details>
      <p class="muted strava-note">${tr('secretNote')}</p>
      <form class="strava-form" novalidate>
        <label class="field">
          <span>${tr('clientId')}</span>
          <input name="clientId" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(clientId)}" />
        </label>
        <label class="field">
          <span>${tr('clientSecret')}</span>
          <input name="clientSecret" type="password" autocomplete="off" spellcheck="false" value="${esc(clientSecret)}" />
        </label>
        <div class="strava-actions">
          <button class="btn primary" type="submit">${tr('connect')}</button>
          ${hasCredentials ? `<button class="btn ghost small" type="button" data-act="forget">${tr('forget')}</button>` : ''}
        </div>
      </form>`;
  }

  function connectedHtml(s: StravaSettings): string {
    const busy = syncing();
    return `
      <p class="strava-status">
        <span class="strava-dot" aria-hidden="true"></span>
        <strong>${s.athlete ? tr('connectedAs', { name: esc(s.athlete.name) }) : tr('connected')}</strong>
        <span class="muted">${s.lastSyncAt ? tr('lastSync', { date: formatDateTime(s.lastSyncAt) }) : tr('neverSynced')}</span>
      </p>
      ${canReadActivities(s.scope) ? '' : `<p class="strava-alert warn">${tr('scopeWarning')}</p>`}
      <div class="strava-sync">
        <label class="field">
          <span>${tr('range')}</span>
          <select class="strava-range"${busy ? ' disabled' : ''}>
            ${RANGES.map(([value, key]) => `<option value="${value}"${value === range ? ' selected' : ''}>${tr(key)}</option>`).join('')}
          </select>
        </label>
        <button class="btn primary" type="button" data-act="sync"${busy ? ' disabled' : ''}>${tr('sync')}</button>
        <button class="btn ghost danger" type="button" data-act="disconnect"${busy ? ' disabled' : ''}>${tr('disconnect')}</button>
      </div>
      <div class="strava-progress"${busy ? '' : ' hidden'}>
        <div class="strava-bar"><span></span></div>
        <span class="strava-progress-text" aria-live="polite"></span>
        <button class="btn small" type="button" data-act="cancel">${tr('cancel')}</button>
      </div>
      ${result ? resultHtml(result) : ''}`;
  }

  function resultHtml(r: SyncResult): string {
    const counts = [
      r.imported.length ? `<span class="badge good">${tr('imported', { count: r.imported.length })}</span>` : '',
      r.duplicates ? `<span class="badge">${tr('duplicates', { count: r.duplicates })}</span>` : '',
      r.skipped ? `<span class="badge warn">${tr('skipped', { count: r.skipped })}</span>` : '',
      r.failed.length ? `<span class="badge bad">${tr('failed', { count: r.failed.length })}</span>` : '',
      r.ignored ? `<span class="badge">${tr('ignored', { count: r.ignored })}</span>` : '',
    ].join('');
    const nothing = !r.cancelled && !r.error && r.imported.length === 0 && r.failed.length === 0;
    const rows = [
      ...r.imported.slice(0, MAX_LISTED).map(
        (a) => `<li><a href="#/activity/${encodeURIComponent(a.id)}">${esc(a.name)}</a>
          <span class="muted">${formatDate(a.startTime)} · ${formatDistance(a.summary.distance)}</span></li>`,
      ),
      ...r.failed.map(
        (f) => `<li><span class="badge bad">${tr('failed', { count: 1 })}</span>
          <a href="https://www.strava.com/activities/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a></li>`,
      ),
    ];
    if (r.imported.length > MAX_LISTED) rows.push(`<li class="muted">${tr('moreRuns', { count: r.imported.length - MAX_LISTED })}</li>`);
    const u = r.usage;
    return `
      <div class="strava-result">
        <h3>${tr('resultTitle')}</h3>
        ${r.cancelled ? `<p class="muted">${tr('resultCancelled')}</p>` : ''}
        ${nothing ? `<p class="muted">${tr('resultNone')}</p>` : ''}
        ${counts ? `<div class="strava-counts">${counts}</div>` : ''}
        ${rows.length ? `<ul class="strava-runs">${rows.join('')}</ul>` : ''}
        ${u ? `<p class="muted strava-usage">${tr('usage', { short: u.short[0], shortLimit: u.short[1], daily: u.daily[0], dailyLimit: u.daily[1] })}</p>` : ''}
      </div>`;
  }

  function updateProgress(): void {
    const text = el.querySelector<HTMLElement>('.strava-progress-text');
    const bar = el.querySelector<HTMLElement>('.strava-bar > span');
    if (!text || !bar || !progress) return;
    if (progress.phase === 'list') {
      text.textContent = tr('listing', { count: progress.done });
      bar.parentElement!.classList.add('indeterminate');
      bar.style.width = '';
    } else {
      text.textContent = tr('importingProgress', { done: progress.done, total: progress.total });
      bar.parentElement!.classList.remove('indeterminate');
      bar.style.width = `${progress.total ? (100 * progress.done) / progress.total : 100}%`;
    }
  }

  async function init(): Promise<void> {
    const pending = takePendingAuth();
    try {
      settings = await loadStrava();
    } catch {
      settings = undefined;
    }
    if (disposed) return;
    clientId = settings?.clientId ?? '';
    clientSecret = settings?.clientSecret ?? '';
    loading = false;
    if (pending && 'error' in pending) error = pending.error;
    else if (pending && !settings?.clientId) error = 'state';
    else if (pending && settings) {
      connecting = true;
      render();
      try {
        settings = await exchangeCode(settings, pending);
      } catch (err) {
        error = codeOf(err);
      }
      connecting = false;
    }
    range = settings?.syncCursor !== undefined ? 'since-last' : '30d';
    render();
  }

  async function connect(): Promise<void> {
    clientId = clientId.trim();
    clientSecret = clientSecret.trim();
    if (!clientId || !clientSecret) {
      error = 'missing';
      render();
      return;
    }
    const base = settings ?? { id: STRAVA_ID, clientId, clientSecret };
    // Saved before leaving the page: the code exchange needs them on return.
    await saveStrava({ ...base, clientId, clientSecret });
    startAuthorization(clientId);
  }

  async function sync(): Promise<void> {
    if (syncing() || !isConnected(settings)) return;
    controller = new AbortController();
    progress = { phase: 'list', done: 0, total: 0 };
    result = null;
    error = null;
    render();
    let res: SyncResult | null = null;
    try {
      res = await syncStrava({
        range,
        signal: controller.signal,
        onProgress: (p) => {
          progress = p;
          if (!disposed) updateProgress();
        },
      });
    } catch (err) {
      error = codeOf(err);
    }
    controller = null;
    progress = null;
    if (disposed) return;
    result = res;
    if (res?.error) error = res.error;
    try {
      settings = await loadStrava();
      // The tokens no longer work: forget them so the connect form shows.
      if (res?.error === 'unauthorized' && settings) {
        settings = withoutTokens(settings);
        await saveStrava(settings);
      }
    } catch {
      // Keep the previous settings on screen.
    }
    if (disposed) return;
    if (res && !res.error && !res.cancelled && settings?.syncCursor !== undefined) range = 'since-last';
    if (res?.imported.length) showToast(tr('toastImported', { count: res.imported.length }));
    render();
  }

  async function doDisconnect(): Promise<void> {
    if (!settings || syncing()) return;
    const ok = await confirmDialog({
      title: tg('dlgDisconnectStrava'),
      message: tr('disconnectConfirm'),
      confirmLabel: tg('dlgDisconnect'),
      tone: 'danger',
    });
    if (!ok || !settings || syncing()) return;
    settings = await disconnect(settings);
    result = null;
    error = null;
    render();
  }

  async function forget(): Promise<void> {
    if (syncing()) return;
    const ok = await confirmDialog({
      title: tg('dlgForgetStrava'),
      message: tr('forgetConfirm'),
      confirmLabel: tg('dlgDelete'),
      tone: 'danger',
    });
    if (!ok || syncing()) return;
    settings = undefined;
    clientId = '';
    clientSecret = '';
    error = null;
    await remove('settings', STRAVA_ID);
    render();
  }

  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    switch (btn?.dataset.act) {
      case 'sync':
        void sync();
        break;
      case 'cancel':
        controller?.abort();
        break;
      case 'disconnect':
        void doDisconnect();
        break;
      case 'forget':
        void forget();
        break;
    }
  };
  const onSubmit = (e: Event) => {
    e.preventDefault();
    void connect();
  };
  const onInput = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    if (target.name === 'clientId') clientId = target.value;
    else if (target.name === 'clientSecret') clientSecret = target.value;
    else if (target.classList.contains('strava-range')) range = target.value as SyncRange;
  };
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);

  const offLang = onLangChange(render);
  // Another tab (or a backup restore) changed the connection.
  const offData = onDataChange((store) => {
    if (store !== 'settings' || loading || connecting || syncing()) return;
    void loadStrava()
      .then((next) => {
        const key = (s?: StravaSettings) => JSON.stringify([s?.clientId, s?.accessToken, s?.athlete?.id, s?.lastSyncAt]);
        if (disposed || key(next) === key(settings)) return;
        settings = next;
        render();
      })
      .catch(() => {});
  });

  render();
  void init();

  return () => {
    disposed = true;
    controller?.abort();
    offLang();
    offData();
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
    el.removeEventListener('input', onInput);
    el.removeEventListener('change', onInput);
  };
}
