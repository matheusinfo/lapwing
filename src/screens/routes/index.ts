import './routes.css';
import { createRouteMap } from './map';
import { RouteState, type Segment } from './route/state';
import { RouteEditor } from './route/editor';
import { RoutingQueue } from './route/router';
import { GpxError, parseGpx } from '../../gpx/parse';
import { downloadGpx } from '../../gpx/export';
import { bounds, trackDistance } from '../../geo';
import { formatDistance } from '../../format';
import { onLangChange, t, translateDom } from '../../i18n';
import { renderStats, setupPaceInput } from './stats';
import { setupToolbar, updateToolbar } from './toolbar';
import { showToast } from '../../ui/toast';
import type { LngLat } from '../../types';
import type { ScreenMount } from '../../app/screen';

const ROUTE_KEY = 'lapwing:route';
const NAME_KEY = 'lapwing:name';

const TEMPLATE = /* html */ `
  <div class="rm-map"></div>

  <aside class="rm-panel">
    <h1 class="rm-title" data-i18n="appTitle"></h1>

    <input id="route-name" class="rm-route-name" type="text" maxlength="80"
      data-i18n-placeholder="defaultRouteName" data-i18n-title="routeName" />

    <dl class="rm-stats">
      <div class="rm-stat rm-stat-main">
        <dt data-i18n="distance"></dt>
        <dd id="stat-distance">0.00 km</dd>
      </div>
      <div class="rm-stat">
        <dt data-i18n="elevation"></dt>
        <dd id="stat-elevation">—</dd>
      </div>
      <div class="rm-stat">
        <dt data-i18n="time"></dt>
        <dd id="stat-time">—</dd>
      </div>
      <div class="rm-stat">
        <dt><label for="pace" data-i18n="pace"></label></dt>
        <dd class="rm-pace">
          <input id="pace" type="text" inputmode="decimal" maxlength="5" placeholder="6:00" />
          <span data-i18n="paceUnit"></span>
        </dd>
      </div>
    </dl>

    <p class="rm-hint" id="hint"></p>
    <p class="rm-status" id="status" aria-live="polite"></p>
  </aside>

  <nav class="rm-toolbar">
    <button id="btn-open" class="labelled" type="button">
      <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
      <span data-i18n="open"></span>
    </button>
    <button id="btn-export" class="labelled primary" type="button">
      <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
      <span data-i18n="export"></span>
    </button>
    <span class="rm-sep" aria-hidden="true"></span>
    <button id="btn-undo" type="button" data-i18n-title="undo">
      <svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
    </button>
    <button id="btn-redo" type="button" data-i18n-title="redo">
      <svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
    </button>
    <span class="rm-sep" aria-hidden="true"></span>
    <button id="btn-reverse" type="button" data-i18n-title="reverse">
      <svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></svg>
    </button>
    <button id="btn-loop" type="button" data-i18n-title="closeLoop">
      <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></svg>
    </button>
    <button id="btn-clear" type="button" data-i18n-title="clear">
      <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /></svg>
    </button>
  </nav>

  <div class="rm-drop-overlay"><span data-i18n="dropHint"></span></div>
  <input id="file-input" type="file" accept=".gpx,application/gpx+xml" hidden />
`;

// ---- Small localStorage helpers (storage can be unavailable) ----

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not important if this fails (private mode, quota).
  }
}

function restoreRoute(state: RouteState): void {
  const saved = load<{ waypoints: LngLat[]; segments: Segment[] }>(ROUTE_KEY);
  if (!saved || !Array.isArray(saved.waypoints) || !Array.isArray(saved.segments)) return;
  if (saved.waypoints.length && saved.segments.length !== saved.waypoints.length - 1) return;
  state.load(saved.waypoints, saved.segments);
}

function fitPadding() {
  return window.innerWidth > 640
    ? { top: 60, bottom: 110, left: 340, right: 70 }
    : { top: 220, bottom: 130, left: 30, right: 30 };
}

/** The route editor: draw running routes on the map and open/export GPX. */
export const mount: ScreenMount = (root) => {
  root.classList.add('rm-root');
  root.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const cleanups: (() => void)[] = [];

  translateDom(root, t);

  // ---- Settings in the side panel ----
  const nameInput = $<HTMLInputElement>('route-name');
  nameInput.value = load<string>(NAME_KEY) ?? '';
  nameInput.addEventListener('input', () => save(NAME_KEY, nameInput.value));
  const routeName = () => nameInput.value.trim() || t('defaultRouteName');

  // ---- Map and route ----
  const { map, ready } = createRouteMap(root.querySelector<HTMLElement>('.rm-map')!);
  cleanups.push(() => map.remove());
  const state = new RouteState();
  const editor = new RouteEditor(map, state);
  const routing = new RoutingQueue(state, (err) => {
    console.warn('Routing failed:', err);
    showToast(t('routeFailed'), 'warn');
  });

  const refreshPanel = () => {
    renderStats(state.track(), routing.busy, state.waypoints.length);
    updateToolbar(state, editor);
  };

  let saveTimer: number | undefined;
  const saveRoute = () => {
    saveTimer = undefined;
    save(ROUTE_KEY, { waypoints: state.waypoints, segments: state.segments });
  };
  // Leaving the screen (or a theme change, which rebuilds it) saves a pending edit right away.
  cleanups.push(() => {
    if (saveTimer === undefined) return;
    window.clearTimeout(saveTimer);
    saveRoute();
  });
  cleanups.push(
    onLangChange(() => {
      translateDom(root, t);
      refreshPanel();
    }),
  );
  setupPaceInput(refreshPanel);

  ready.then(() => {
    if (signal.aborted) return;
    state.onChange(() => {
      routing.sync();
      editor.render();
      refreshPanel();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveRoute, 300);
    });
    restoreRoute(state);
    state.emit();
  });
  refreshPanel();

  // ---- Open and export GPX ----
  const fileInput = $<HTMLInputElement>('file-input');

  async function openFile(file: File) {
    let parsed;
    try {
      parsed = parseGpx(await file.text());
    } catch (err) {
      const key = err instanceof GpxError ? (err.code === 'empty' ? 'gpxEmpty' : 'gpxInvalid') : 'gpxReadError';
      showToast(t(key), 'error');
      return;
    }
    await ready;
    if (signal.aborted) return;
    editor.loadTrack(parsed.coords);
    const name = parsed.name ?? file.name.replace(/\.gpx$/i, '');
    nameInput.value = name;
    save(NAME_KEY, name);
    const box = bounds(parsed.coords);
    if (box) map.fitBounds(box, { padding: fitPadding(), maxZoom: 17 });
    showToast(t('gpxLoaded', { name, distance: formatDistance(trackDistance(parsed.coords)) }));
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void openFile(file);
    fileInput.value = ''; // Allow opening the same file again.
  });

  setupToolbar(
    state,
    editor,
    {
      open: () => fileInput.click(),
      export: () => {
        const track = state.track();
        if (track.length < 2) {
          showToast(t('nothingToExport'), 'warn');
          return;
        }
        downloadGpx(track, routeName());
      },
    },
    signal,
  );

  // ---- Drag and drop a GPX file onto the screen ----
  const overlay = root.querySelector<HTMLElement>('.rm-drop-overlay')!;
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    overlay.classList.add('visible');
  });
  root.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.remove('visible');
  });
  root.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('visible');
    const file = e.dataTransfer?.files[0];
    if (file) void openFile(file);
  });

  return () => {
    lifetime.abort();
    cleanups.forEach((fn) => fn());
    root.classList.remove('rm-root');
  };
};
