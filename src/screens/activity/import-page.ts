import { navigate } from '../../app/router';
import { listActivities, onDataChange } from '../../data/db';
import {
  importActivityFiles,
  type ImportErrorCode,
  type ImportFailure,
  type ImportProgress,
  type ImportResult,
} from '../../data/import';
import type { Activity } from '../../data/types';
import { formatDate, formatDistance, formatDuration, formatPace } from '../../format';
import { onLangChange } from '../../i18n';
import { showToast } from '../../ui/toast';
import { esc } from './dom';
import { tr, type ActKey } from './i18n';

const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" class="act-drop-icon" aria-hidden="true"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';

const ERROR_KEYS: Partial<Record<ImportErrorCode, ActKey>> = {
  invalid: 'errInvalid',
  empty: 'errEmpty',
  read: 'errRead',
  unsupported: 'errUnsupported',
  save: 'errSave',
};
/** Outcomes counted as errors in the result summary. */
const isError = (code: ImportErrorCode) => code in ERROR_KEYS;

/** Files the page accepts (by extension or MIME type). */
const ACCEPTED_NAME = /\.(gpx|fit|tcx|gz|zip)$/i;
const isAccepted = (f: File) => ACCEPTED_NAME.test(f.name) || /gpx|xml|zip/.test(f.type);
/** Result rows shown before collapsing into "and N more". */
const MAX_LISTED = 20;

/** The "/activity" page: import activity files (or a Strava archive) and list the runs. */
export function mountImportPage(root: HTMLElement): () => void {
  const cleanups: (() => void)[] = [];
  let lastResult: ImportResult | null = null;
  let busy = false;
  let disposed = false;
  let controller: AbortController | null = null;
  let progress: ImportProgress | null = null;
  let runs: Activity[] = [];

  root.innerHTML = `
    <div class="page act-page">
      <header class="page-header"><h1 class="act-h1"></h1></header>
      <p class="muted act-intro"></p>
      <label class="dropzone act-dropzone" tabindex="0">
        ${UPLOAD_ICON}
        <strong class="act-drop-title"></strong>
        <span class="act-drop-hint"></span>
        <input class="act-file" type="file" accept=".gpx,.fit,.tcx,.gz,.zip,application/gpx+xml,application/zip" multiple hidden />
      </label>
      <section class="card act-progress" hidden>
        <div class="act-progress-row">
          <div class="act-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
          <button class="btn small act-cancel" type="button"></button>
        </div>
        <span class="act-progress-text" aria-live="polite"></span>
      </section>
      <section class="card act-result" hidden></section>
      <details class="card act-howto"></details>
      <section class="card act-runs"></section>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const dropzone = $<HTMLLabelElement>('.act-dropzone');
  const input = $<HTMLInputElement>('.act-file');
  const progressBox = $('.act-progress');
  const cancelBtn = $<HTMLButtonElement>('.act-cancel');

  function renderStatic() {
    $('.act-h1').textContent = tr('importTitle');
    $('.act-intro').textContent = tr('importIntro');
    $('.act-drop-title').textContent = busy ? tr('importing') : tr('dropTitle');
    $('.act-drop-hint').textContent = tr('dropHint');
    cancelBtn.textContent = tr('cancel');
    $('.act-howto').innerHTML = `
      <summary>${tr('stravaHowTitle')}</summary>
      <ol>
        <li>${tr('stravaHow1')}</li>
        <li>${tr('stravaHow2')}</li>
        <li>${tr('stravaHow3')}</li>
      </ol>
      <p class="muted">${tr('stravaHowBulk')}</p>`;
  }

  function failureRow(f: ImportFailure): string {
    const label = f.name
      ? `${esc(f.name)}${f.fileName ? ` <span class="muted">${esc(f.fileName)}</span>` : ''}`
      : esc(f.fileName);
    switch (f.code) {
      case 'duplicate':
        return `<li><span class="badge warn">${tr('duplicate')}</span> ${label}
          ${f.existingId ? `<a href="#/activity/${encodeURIComponent(f.existingId)}">${tr('viewRun')}</a>` : ''}</li>`;
      case 'no-gps':
        return `<li><span class="badge warn">${tr('noGps')}</span> ${label}</li>`;
      case 'manual':
        return `<li><span class="badge">${tr('manualOne')}</span> ${label}</li>`;
      case 'ignored-type':
        return `<li><span class="badge">${tr('ignoredOne')}</span> ${label}</li>`;
      default:
        return `<li><span class="badge bad">${tr(ERROR_KEYS[f.code] ?? 'errRead')}</span> ${label}</li>`;
    }
  }

  function renderResult() {
    const box = $('.act-result');
    if (!lastResult) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const r = lastResult;
    const count = (test: (code: ImportErrorCode) => boolean) => r.failed.filter((f) => test(f.code)).length;
    const counts: [number, ActKey, string][] = [
      [r.imported.length, 'countImported', 'good'],
      [count((c) => c === 'duplicate'), 'countDuplicate', ''],
      [count((c) => c === 'no-gps'), 'countNoGps', 'warn'],
      [count((c) => c === 'manual'), 'countManual', ''],
      [count((c) => c === 'ignored-type'), 'countIgnored', ''],
      [count(isError), 'countFailed', 'bad'],
    ];
    const badges = counts
      .filter(([n]) => n > 0)
      .map(([n, key, kind]) => `<span class="badge ${kind}" data-count="${key}">${tr(key, { count: n })}</span>`)
      .join('');

    // Small imports list every file; big ones (an archive) only what was imported or failed.
    const total = r.imported.length + r.failed.length;
    const listed = total <= MAX_LISTED ? r.failed : r.failed.filter((f) => isError(f.code));
    const rows = [
      ...r.imported.map(
        (a) => `<li><span class="badge good">${tr('importedOne')}</span>
          <a href="#/activity/${encodeURIComponent(a.id)}">${esc(a.name)}</a>
          <span class="muted">${formatDistance(a.summary.distance)}</span></li>`,
      ),
      ...listed.map(failureRow),
    ];
    const shown = rows.slice(0, MAX_LISTED);
    if (rows.length > MAX_LISTED) shown.push(`<li class="muted">${tr('moreItems', { count: rows.length - MAX_LISTED })}</li>`);
    const nothing = !r.cancelled && r.imported.length === 0 && count(isError) === 0;

    box.innerHTML = `
      <h2 class="card-title">${tr('resultTitle')}</h2>
      ${r.cancelled ? `<p class="muted act-result-note">${tr('importCancelled')}</p>` : ''}
      ${nothing && total > 1 ? `<p class="muted act-result-note">${tr('importNothing')}</p>` : ''}
      ${badges && total > 1 ? `<div class="act-counts">${badges}</div>` : ''}
      ${shown.length ? `<ul class="act-result-list">${shown.join('')}</ul>` : ''}`;
  }

  function updateProgress() {
    progressBox.hidden = !busy;
    cancelBtn.disabled = !!controller?.signal.aborted;
    const text = $('.act-progress-text');
    const bar = $('.act-bar');
    const fill = bar.firstElementChild as HTMLElement;
    if (!progress || progress.phase === 'open' || !progress.total) {
      text.textContent = progress?.phase === 'open' ? tr('importOpening') : tr('importing');
      bar.classList.add('indeterminate');
      bar.removeAttribute('aria-valuenow');
      fill.style.width = '';
    } else {
      text.textContent = tr('importProgress', { done: Math.min(progress.done + 1, progress.total), total: progress.total });
      bar.classList.remove('indeterminate');
      const pct = Math.round((100 * progress.done) / progress.total);
      bar.setAttribute('aria-valuenow', String(pct));
      fill.style.width = `${pct}%`;
    }
  }

  function setBusy(next: boolean) {
    busy = next;
    dropzone.classList.toggle('act-busy', busy);
    dropzone.setAttribute('aria-disabled', String(busy));
    input.disabled = busy;
    renderStatic();
    updateProgress();
  }

  function renderRuns() {
    const box = $('.act-runs');
    if (!runs.length) {
      box.innerHTML = `<div class="empty-state"><h2>${tr('emptyTitle')}</h2><p>${tr('emptyText')}</p></div>`;
      return;
    }
    const shown = runs.slice(0, 30);
    box.innerHTML = `
      <div class="act-runs-head">
        <h2 class="card-title">${tr('recentTitle')}</h2>
        <a href="#/history">${tr('seeHistory')}</a>
      </div>
      <ul class="act-run-list">
        ${shown
          .map(
            (a) => `
          <li><a class="act-run-row" href="#/activity/${a.id}">
            <span class="act-run-date">${formatDate(a.startTime)}</span>
            <span class="act-run-name">${esc(a.name)}</span>
            <span class="act-run-num">${formatDistance(a.summary.distance)}</span>
            <span class="act-run-num muted">${a.summary.has.time ? formatDuration(a.summary.movingTime) : '—'}</span>
            <span class="act-run-num muted">${formatPace(a.summary.avgPace)}</span>
          </a></li>`,
          )
          .join('')}
      </ul>`;
  }

  async function loadRuns() {
    runs = await listActivities();
    renderRuns();
  }

  async function handleFiles(files: File[]) {
    if (busy || !files.length) return;
    const accepted = files.filter(isAccepted);
    if (!accepted.length) {
      showToast(tr('noSupportedFiles'), 'warn');
      return;
    }
    const ctrl = new AbortController();
    controller = ctrl;
    progress = null;
    lastResult = null;
    renderResult();
    setBusy(true);
    let result: ImportResult | null = null;
    try {
      result = await importActivityFiles(accepted, {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (disposed || controller !== ctrl) return;
          progress = p;
          updateProgress();
        },
      });
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      controller = null;
      progress = null;
    }
    if (disposed) return;
    setBusy(false);
    if (!result) {
      showToast(tr('errRead'), 'error');
      return;
    }
    lastResult = result;
    const single = accepted.length === 1 && !/\.zip$/i.test(accepted[0].name);
    if (single && result.imported.length === 1) {
      navigate('/activity/' + result.imported[0].id);
      return;
    }
    if (result.imported.length) showToast(tr('importedCount', { count: result.imported.length }));
    renderResult();
  }

  cancelBtn.addEventListener('click', () => {
    controller?.abort();
    updateProgress();
  });

  input.addEventListener('change', () => {
    void handleFiles(Array.from(input.files ?? []));
    input.value = '';
  });
  dropzone.addEventListener('keydown', (e) => {
    if (busy) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  // Drop anywhere on the page.
  let depth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    dropzone.classList.add('dragging');
  });
  root.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) dropzone.classList.remove('dragging');
  });
  root.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dropzone.classList.remove('dragging');
    void handleFiles(Array.from(e.dataTransfer?.files ?? []));
  });

  cleanups.push(
    onLangChange(() => {
      renderStatic();
      updateProgress();
      renderResult();
      renderRuns();
    }),
  );
  cleanups.push(
    onDataChange((store) => {
      if (store === 'activities') void loadRuns();
    }),
  );

  renderStatic();
  void loadRuns();
  return () => {
    disposed = true;
    // Stop an import in progress; what it saved so far is kept.
    controller?.abort();
    cleanups.forEach((fn) => fn());
  };
}
