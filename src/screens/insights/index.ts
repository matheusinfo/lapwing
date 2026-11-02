import './insights.css';
import type { ScreenMount } from '../../app/screen';
import { getAll, getSettings, listActivities, onDataChange } from '../../data/db';
import { DEFAULT_SETTINGS, type Activity, type AthleteSettings } from '../../data/types';
import { onLangChange } from '../../i18n';
import type { Chart } from '../../ui/chart-theme';
import { addDays, startOfDay } from '../history/aggregate';
import { cachedEfforts, effortsCached, loadEfforts } from '../history/efforts';
import type { Goal } from './goals';
import { openGoalDialog, renderGoals } from './goals-view';
import { t } from './i18n';
import { renderOverload } from './overload-view';
import { DEFAULT_WINDOW_DAYS, predictionRuns } from './predictions';
import { renderPredictions } from './predictions-view';

const WINDOW_KEY = 'lapwing:insights-window';

function readAllTime(): boolean {
  try {
    return localStorage.getItem(WINDOW_KEY) === 'all';
  } catch {
    return false;
  }
}

function saveAllTime(all: boolean): void {
  try {
    localStorage.setItem(WINDOW_KEY, all ? 'all' : '90d');
  } catch {
    // Only a convenience.
  }
}

/** Insights: weekly/monthly goals, race predictions and overload alerts. */
export const mount: ScreenMount = (root) => {
  root.classList.add('ins-root');
  root.innerHTML = '<div class="ins-host"></div><dialog class="ins-dialog"></dialog>';
  const host = root.querySelector<HTMLElement>('.ins-host')!;
  const dialog = root.querySelector<HTMLDialogElement>('.ins-dialog')!;

  let activities: Activity[] = [];
  let settings: AthleteSettings = { ...DEFAULT_SETTINGS };
  let goals: Goal[] = [];
  let loaded = false;
  let failed = false;
  let allTime = readAllTime();
  let loadChart: Chart | undefined;
  let effortsJob: AbortController | null = null;
  let disposed = false;
  let loadId = 0;

  // ---- Data ----

  async function reload(): Promise<void> {
    const id = ++loadId;
    try {
      const [a, s, g] = await Promise.all([listActivities(), getSettings(), getAll<Goal>('goals')]);
      if (disposed || id !== loadId) return;
      [activities, settings, goals] = [a, s, g];
      failed = false;
    } catch (err) {
      console.error('Insights: could not load data', err);
      if (disposed || id !== loadId) return;
      failed = true;
    }
    loaded = true;
    renderAll();
  }

  async function reloadGoals(): Promise<void> {
    const id = loadId;
    try {
      const g = await getAll<Goal>('goals');
      if (disposed || id !== loadId || !loaded) return;
      goals = g;
      renderGoalsSection();
    } catch (err) {
      console.error('Insights: could not load goals', err);
    }
  }

  // ---- Rendering ----

  function stopWork(): void {
    loadChart?.destroy();
    loadChart = undefined;
    effortsJob?.abort();
    effortsJob = null;
  }

  function renderAll(): void {
    stopWork();
    if (!loaded || failed) {
      host.innerHTML = `<div class="page"><p class="muted">${failed ? t('loadFailed') : t('loading')}</p></div>`;
      return;
    }
    host.innerHTML = `
      <div class="page ins-page">
        <header class="page-header">
          <h1>${t('title')}</h1>
          <p class="muted ins-subtitle">${t('subtitle')}</p>
        </header>

        <section class="card ins-goals-card" aria-labelledby="ins-goals-title">
          <div class="ins-section-head">
            <h2 class="card-title" id="ins-goals-title">${t('goalsTitle')}</h2>
            <button type="button" class="btn primary small" data-new-goal>${t('newGoal')}</button>
          </div>
          <div id="ins-goals-body"></div>
        </section>

        <div class="ins-grid">
          <section class="card" aria-labelledby="ins-pred-title">
            <div class="ins-section-head">
              <h2 class="card-title" id="ins-pred-title">${t('predTitle')}</h2>
              <div class="ins-seg" role="group" aria-label="${t('predWindowLabel')}">
                <button type="button" data-pred-window="90d">${t('predWindow90')}</button>
                <button type="button" data-pred-window="all">${t('predWindowAll')}</button>
              </div>
            </div>
            <div id="ins-pred-body"></div>
          </section>

          <section class="card" aria-labelledby="ins-load-title">
            <h2 class="card-title" id="ins-load-title">${t('loadTitle')}</h2>
            <div id="ins-load-body"></div>
          </section>
        </div>
      </div>`;
    renderGoalsSection();
    renderPredSection();
    renderLoadSection();
  }

  function renderGoalsSection(): void {
    const el = host.querySelector('#ins-goals-body');
    if (el) renderGoals(el, goals, activities, Date.now());
  }

  function renderPredSection(): void {
    const el = host.querySelector('#ins-pred-body');
    if (!el) return;
    host.querySelectorAll<HTMLElement>('.ins-seg [data-pred-window]').forEach((b) => {
      b.setAttribute('aria-pressed', String((b.dataset.predWindow === 'all') === allTime));
    });
    const since = allTime ? -Infinity : addDays(startOfDay(Date.now()), -DEFAULT_WINDOW_DAYS);
    const runs = predictionRuns(activities, since);
    const ready = effortsCached(runs);
    renderPredictions(el, {
      activities,
      efforts: cachedEfforts(runs),
      since,
      allTime,
      calculating: !ready,
    });

    if (!ready && !effortsJob) {
      const job = new AbortController();
      effortsJob = job;
      void loadEfforts(runs, job.signal).then(() => {
        if (job.signal.aborted || disposed) return;
        effortsJob = null;
        renderPredSection();
      });
    }
  }

  function renderLoadSection(): void {
    const el = host.querySelector('#ins-load-body');
    if (!el) return;
    loadChart?.destroy();
    loadChart = renderOverload(el, activities, settings, Date.now());
  }

  // ---- Events (delegated) ----

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog) {
      if (typeof dialog.close === 'function') dialog.close(); // Click on the backdrop.
      return;
    }
    if (target.closest('[data-new-goal]')) {
      openGoalDialog(dialog);
      return;
    }
    const edit = target.closest<HTMLElement>('[data-edit-goal]');
    if (edit) {
      const goal = goals.find((g) => g.id === edit.dataset.editGoal);
      if (goal) openGoalDialog(dialog, goal);
      return;
    }
    const win = target.closest<HTMLElement>('[data-pred-window]');
    if (win) {
      const next = win.dataset.predWindow === 'all';
      if (next === allTime) return;
      allTime = next;
      saveAllTime(allTime);
      effortsJob?.abort();
      effortsJob = null;
      renderPredSection();
    }
  });

  const stopData = onDataChange((store) => {
    if (store === 'goals') void reloadGoals();
    else if (store === 'activities' || store === 'settings') void reload();
  });
  const stopLang = onLangChange(() => renderAll());

  renderAll();
  void reload();

  return () => {
    disposed = true;
    stopWork();
    stopData();
    stopLang();
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    root.classList.remove('ins-root');
  };
};
