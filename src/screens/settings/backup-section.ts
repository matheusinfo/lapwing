import {
  BackupError,
  backupFileName,
  compressionSupported,
  createBackup,
  encodeBackup,
  parseBackupFile,
  restoreBackup,
  summarizeBackup,
  type BackupFile,
  type BackupSummary,
  type RestoreMode,
  type RestoreResult,
} from '../../data/backup';
import { countStores, onDataChange, STORES, type StoreName } from '../../data/db';
import { formatDateTime, formatNumber } from '../../format';
import { getLang, onLangChange, setLang, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import { confirmDialog } from '../../ui/confirm';
import { tb, type BackupKey } from './backup-i18n';
import './backup.css';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STORE_LABELS: Record<StoreName, BackupKey> = {
  activities: 'storeActivities',
  tracks: 'storeTracks',
  plans: 'storePlans',
  workouts: 'storeWorkouts',
  settings: 'storeSettings',
  shoes: 'storeShoes',
  goals: 'storeGoals',
};
/** Stores shown in the "what's stored" summary. */
const SUMMARY_STORES: StoreName[] = ['activities', 'plans', 'workouts', 'goals'];

const ERROR_KEYS: Record<string, BackupKey> = {
  'not-a-backup': 'errNotBackup',
  'newer-format': 'errNewerFormat',
  malformed: 'errMalformed',
  'no-gzip': 'errNoGzip',
};

const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" class="bk-drop-icon" aria-hidden="true"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';

interface Pending {
  fileName: string;
  backup: BackupFile;
  summary: BackupSummary;
}

/** The "Backup & restore" card of the settings page. */
export function mountBackupSection(el: HTMLElement): () => void {
  const listeners = new AbortController();
  const on = { signal: listeners.signal };
  const cleanups: (() => void)[] = [() => listeners.abort()];
  let disposed = false;

  let counts: Record<StoreName, number> | null = null;
  let includeSecrets = false;
  let gzip = false;
  let busy: 'export' | 'read' | 'restore' | null = null;
  let pending: Pending | null = null;
  let mode: RestoreMode = 'merge';
  let error: string | null = null;
  let result: RestoreResult | null = null;
  let countsLoad = 0;

  el.innerHTML = `
    <section class="card bk-card">
      <h2 class="card-title bk-title"></h2>
      <p class="muted bk-intro"></p>
      <dl class="stat-grid bk-counts"></dl>
      <div class="bk-block bk-export"></div>
      <div class="bk-block bk-restore">
        <h3 class="bk-subtitle bk-restore-title"></h3>
        <label class="dropzone bk-drop" tabindex="0">
          ${UPLOAD_ICON}
          <strong class="bk-drop-title"></strong>
          <span class="bk-drop-hint"></span>
          <input class="bk-file" type="file" accept=".json,.gz,application/json,application/gzip" hidden />
        </label>
        <p class="bk-error" role="alert" hidden></p>
        <div class="bk-preview" hidden></div>
        <div class="bk-result" role="status" hidden></div>
      </div>
    </section>`;

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const input = $<HTMLInputElement>('.bk-file');
  const dropzone = $<HTMLLabelElement>('.bk-drop');
  const total = (c: Partial<Record<string, number>>) => Object.values(c).reduce<number>((a, b) => a + (b ?? 0), 0);

  function renderStatic() {
    $('.bk-title').textContent = tb('title');
    $('.bk-intro').textContent = tb('intro');
    $('.bk-restore-title').textContent = tb('restoreTitle');
    $('.bk-drop-title').textContent = busy === 'read' ? tb('reading') : tb('dropTitle');
    $('.bk-drop-hint').textContent = tb('dropHint');
  }

  function renderCounts() {
    $('.bk-counts').innerHTML = SUMMARY_STORES.map(
      (s) => `<div class="stat"><dt>${tb(STORE_LABELS[s])}</dt><dd>${counts ? formatNumber(counts[s]) : '…'}</dd></div>`,
    ).join('');
  }

  function renderExport() {
    $('.bk-export').innerHTML = `
      <h3 class="bk-subtitle">${tb('exportTitle')}</h3>
      <label class="bk-check">
        <input type="checkbox" class="bk-secrets" ${includeSecrets ? 'checked' : ''} />
        <span>${tb('includeSecrets')}</span>
      </label>
      <p class="muted bk-hint bk-secrets-hint" ${includeSecrets ? '' : 'hidden'}>${tb('includeSecretsHint')}</p>
      ${
        compressionSupported()
          ? `<label class="bk-check">
              <input type="checkbox" class="bk-gzip" ${gzip ? 'checked' : ''} />
              <span>${tb('gzip')}</span>
            </label>`
          : ''
      }
      <div class="bk-actions">
        <button type="button" class="btn primary bk-download" ${busy ? 'disabled' : ''}>
          ${busy === 'export' ? tb('downloading') : tb('download')}
        </button>
      </div>`;
  }

  function renderError() {
    const box = $('.bk-error');
    box.hidden = !error;
    box.textContent = error ?? '';
  }

  function renderPreview() {
    const box = $('.bk-preview');
    if (!pending) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const { fileName, backup, summary } = pending;
    const rows = STORES.filter((s) => summary.counts[s] > 0).map(
      (s) => `<li><span>${tb(STORE_LABELS[s])}</span><strong>${formatNumber(summary.counts[s])}</strong></li>`,
    );
    const notes: string[] = [];
    if (summary.newerSchema) notes.push(`<p class="bk-note warn">${tb('newerSchema')}</p>`);
    if (summary.unknownStores.length) {
      notes.push(`<p class="bk-note warn">${tb('ignoredStores', { names: esc(summary.unknownStores.join(', ')) })}</p>`);
    }
    const hasStrava = backup.stores.settings?.some((r) => r.id === 'strava');
    box.hidden = false;
    box.innerHTML = `
      <h3 class="bk-subtitle">${tb('previewTitle')}</h3>
      <p class="bk-file-name"><strong>${esc(fileName)}</strong></p>
      <p class="muted">${
        summary.exportedAt !== undefined ? tb('exportedAt', { date: formatDateTime(summary.exportedAt) }) : tb('unknownDate')
      }
      ${hasStrava ? `<span class="badge ${backup.secrets ? 'warn' : ''}">${tb(backup.secrets ? 'hasSecrets' : 'noSecrets')}</span>` : ''}</p>
      ${rows.length ? `<ul class="bk-list">${rows.join('')}</ul>` : `<p class="muted">${tb('emptyBackup')}</p>`}
      ${notes.join('')}
      <fieldset class="bk-modes" ${busy ? 'disabled' : ''}>
        <label class="bk-mode">
          <input type="radio" name="bk-mode" value="merge" ${mode === 'merge' ? 'checked' : ''} />
          <span><strong>${tb('modeMerge')}</strong><small class="muted">${tb('modeMergeHint')}</small></span>
        </label>
        <label class="bk-mode">
          <input type="radio" name="bk-mode" value="replace" ${mode === 'replace' ? 'checked' : ''} />
          <span><strong>${tb('modeReplace')}</strong><small class="muted">${tb('modeReplaceHint')}</small></span>
        </label>
      </fieldset>
      <div class="bk-actions">
        <button type="button" class="btn primary bk-apply"></button>
        <button type="button" class="btn bk-cancel" ${busy ? 'disabled' : ''}>${tb('cancel')}</button>
      </div>`;
    syncApply();
  }

  /** Updates the Restore button without rerendering the preview. */
  function syncApply() {
    const apply = el.querySelector<HTMLButtonElement>('.bk-apply');
    if (!apply) return;
    apply.disabled = busy !== null;
    // Replacing deletes data: same colours as every destructive confirmation.
    apply.classList.toggle('primary', mode !== 'replace');
    apply.classList.toggle('danger-solid', mode === 'replace');
    apply.textContent = busy === 'restore' ? tb('restoring') : tb('restore');
  }

  function renderResult() {
    const box = $('.bk-result');
    if (!result) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const lines = STORES.filter((s) => result!.counts[s] !== undefined).map(
      (s) => `<li>${tb('resultLine', { label: tb(STORE_LABELS[s]), count: formatNumber(result!.counts[s]!) })}</li>`,
    );
    if (result.localStorage) lines.push(`<li>${tb('resultPrefs', { count: result.localStorage })}</li>`);
    if (result.ignored.length) {
      lines.push(`<li class="muted">${tb('ignoredStores', { names: esc(result.ignored.join(', ')) })}</li>`);
    }
    box.hidden = false;
    box.innerHTML = `<h3 class="bk-subtitle"><span class="badge good">✓</span> ${tb('resultTitle')}</h3>
      <ul class="bk-result-list">${lines.join('')}</ul>`;
  }

  function renderAll() {
    renderStatic();
    renderCounts();
    renderExport();
    renderError();
    renderPreview();
    renderResult();
  }

  async function loadCounts() {
    const id = ++countsLoad;
    try {
      const next = await countStores(STORES);
      if (disposed || id !== countsLoad) return;
      counts = next;
      renderCounts();
    } catch {
      // Database unavailable: leave the placeholders.
    }
  }

  async function download() {
    if (busy) return;
    busy = 'export';
    renderExport();
    try {
      const now = new Date();
      const compressed = gzip && compressionSupported();
      const blob = await encodeBackup(await createBackup({ includeSecrets, now }), { gzip: compressed });
      if (disposed) return;
      const name = backupFileName(now, compressed);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast(tb('downloaded', { name }));
    } catch (err) {
      console.error(err);
      showToast(tb('exportFailed'), 'error');
    } finally {
      busy = null;
      if (!disposed) {
        renderExport();
        syncApply();
      }
    }
  }

  async function readFile(file: File) {
    if (busy) return;
    busy = 'read';
    error = null;
    result = null;
    pending = null;
    renderAll();
    try {
      const backup = await parseBackupFile(file);
      if (disposed) return;
      pending = { fileName: file.name, backup, summary: summarizeBackup(backup) };
      mode = 'merge';
    } catch (err) {
      if (disposed) return;
      error = tb(err instanceof BackupError ? (ERROR_KEYS[err.code] ?? 'errRead') : 'errRead');
    } finally {
      busy = null;
    }
    renderAll();
  }

  async function applyRestore() {
    if (!pending || busy) return;
    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: tg('dlgReplaceData'),
        message: tb('confirmReplace'),
        confirmLabel: tg('dlgRestore'),
        tone: 'danger',
      });
      if (!ok || disposed || !pending || busy) return;
    }
    busy = 'restore';
    renderPreview();
    renderExport();
    try {
      const res = await restoreBackup(pending.backup, mode);
      if (disposed) return;
      result = res;
      pending = null;
      error = null;
      showToast(tb('restored', { count: formatNumber(total(res.counts)) }));
      // Apply a restored language right away.
      const saved = res.localStorage ? localStorageLang() : null;
      if (saved && saved !== getLang()) setLang(saved);
    } catch (err) {
      if (disposed) return;
      console.error(err);
      error = tb('restoreFailed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = null;
    }
    renderAll();
  }

  // ---- Events ----

  el.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.bk-download')) void download();
      else if (target.closest('.bk-apply')) void applyRestore();
      else if (target.closest('.bk-cancel')) {
        pending = null;
        renderPreview();
      }
    },
    on,
  );

  el.addEventListener(
    'change',
    (e) => {
      const target = e.target as HTMLInputElement;
      if (target === input) {
        const file = input.files?.[0];
        input.value = '';
        if (file) void readFile(file);
      } else if (target.classList.contains('bk-secrets')) {
        includeSecrets = target.checked;
        el.querySelector<HTMLElement>('.bk-secrets-hint')!.hidden = !includeSecrets;
      } else if (target.classList.contains('bk-gzip')) {
        gzip = target.checked;
      } else if (target.name === 'bk-mode') {
        mode = target.value === 'replace' ? 'replace' : 'merge';
        syncApply();
      }
    },
    on,
  );

  dropzone.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    },
    on,
  );

  let depth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  el.addEventListener(
    'dragenter',
    (e) => {
      if (!hasFiles(e)) return;
      depth++;
      dropzone.classList.add('dragging');
    },
    on,
  );
  el.addEventListener(
    'dragleave',
    (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) dropzone.classList.remove('dragging');
    },
    on,
  );
  el.addEventListener(
    'dragover',
    (e) => {
      if (hasFiles(e)) e.preventDefault();
    },
    on,
  );
  el.addEventListener(
    'drop',
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      dropzone.classList.remove('dragging');
      const file = e.dataTransfer?.files[0];
      if (file) void readFile(file);
    },
    on,
  );

  cleanups.push(onLangChange(renderAll));
  cleanups.push(onDataChange(() => void loadCounts()));

  renderAll();
  void loadCounts();
  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };
}

function localStorageLang(): 'en' | 'pt-BR' | null {
  try {
    const v = localStorage.getItem('lapwing:lang');
    return v === 'en' || v === 'pt-BR' ? v : null;
  } catch {
    return null;
  }
}
