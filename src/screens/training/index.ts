import './training.css';
import type { ScreenMount } from '../../app/screen';
import { currentQuery } from '../../app/router';
import { getAll, listActivities, onDataChange, remove } from '../../data/db';
import type { Activity } from '../../data/types';
import { onLangChange, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import type { Chart } from '../../ui/chart-theme';
import { weeklyChart } from './chart';
import { csvTemplate, exportPlanCsv, jsonTemplate } from './csv';
import { addDays, isDateStr, localDateOf, todayDate, weekStart } from './dates';
import { openExportDialog, openGeneratorDialog, openImportDialog, openPlanDialog, openWorkoutDialog, type DialogContext } from './dialogs';
import { t } from './i18n';
import { matchWorkouts } from './matching';
import { computeProgress } from './progress';
import { easyPaceOf } from './structure';
import type { PlannedWorkout, TrainingPlan } from './types';
import { chartCard, compareCard, emptyState, header, planCard, weekCard } from './view';
import { confirmDialog } from '../../ui/confirm';

const ACTIVE_PLAN_KEY = 'lapwing:training:active-plan';

function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';

function loadActivePlan(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PLAN_KEY);
  } catch {
    return null;
  }
}
function saveActivePlan(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PLAN_KEY, id);
  } catch {
    // Not important.
  }
}

/** Training plans: create, generate, import, and follow progress against imported runs. */
export const mount: ScreenMount = (root) => {
  root.classList.add('trn-root');
  root.innerHTML = `<div class="page trn-page"><p class="screen-message">…</p></div><dialog class="trn-dialog"></dialog>`;
  const page = root.querySelector<HTMLElement>('.trn-page')!;
  const dialog = root.querySelector<HTMLDialogElement>('.trn-dialog')!;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // Click on the backdrop.
  });

  let plans: TrainingPlan[] = [];
  let workouts: PlannedWorkout[] = [];
  let activities: Activity[] = [];
  let activePlanId = loadActivePlan();
  let chart: Chart | null = null;
  let loadId = 0;
  let loaded = false;

  const today = () => todayDate();
  const currentWeek = () => {
    const q = currentQuery().get('week');
    return q && isDateStr(q) ? weekStart(q) : weekStart(today());
  };
  const setWeek = (start: string | null) => {
    location.hash = start ? `#/training?week=${start}` : '#/training';
  };
  const activePlan = () => plans.find((p) => p.id === activePlanId) ?? plans[0];

  const ctx: DialogContext = {
    dialog,
    today,
    activities: () => activities,
    selectPlan: (id) => {
      activePlanId = id;
      saveActivePlan(id);
      setWeek(null);
      render();
    },
  };

  function render(): void {
    chart?.destroy();
    chart = null;
    if (!loaded) return;
    if (!plans.length) {
      page.innerHTML = emptyState();
      return;
    }
    const plan = activePlan();
    const now = today();
    const planWorkouts = workouts.filter((w) => w.planId === plan.id);
    const match = matchWorkouts(planWorkouts, activities, now);
    const progress = computeProgress(plan, planWorkouts, activities, match, now);
    const week = currentWeek();
    const weekEnd = addDays(week, 6);
    const weekRuns = activities.filter((a) => {
      const d = localDateOf(a.startTime);
      return d >= week && d <= weekEnd && (a.type === 'run' || a.type === 'trail-run');
    });
    // An easier week in a generated plan: about 75 % of the previous week's planned km.
    const idx = progress.weeks.findIndex((w) => w.start === week);
    const deload = idx > 0 && progress.weeks[idx].planned > 0 && progress.weeks[idx].planned < 0.85 * progress.weeks[idx - 1].planned && !!plan.raceDate && week < weekStart(plan.raceDate) && idx < progress.weeks.length - 2;

    page.innerHTML = [
      header(),
      planCard(plans, plan, progress),
      weekCard({
        start: week,
        today: now,
        workouts: planWorkouts.filter((w) => w.date >= week && w.date <= weekEnd),
        match,
        runs: weekRuns,
        deload,
      }),
      chartCard(progress.weeks),
      compareCard([...match.byWorkout.values()]),
    ].join('');

    const canvas = page.querySelector<HTMLCanvasElement>('#trn-chart');
    if (canvas) chart = weeklyChart(canvas, progress.weeks, week, setWeek);
  }

  async function reload(): Promise<void> {
    const id = ++loadId;
    const [p, w, a] = await Promise.all([
      getAll<TrainingPlan>('plans'),
      getAll<PlannedWorkout>('workouts'),
      listActivities(),
    ]);
    if (id !== loadId) return;
    plans = p.sort((x, y) => y.createdAt - x.createdAt);
    workouts = w;
    activities = a;
    loaded = true;
    render();
  }

  // ---- Actions ----

  const actions: Record<string, (el: HTMLElement) => void | Promise<void>> = {
    generate: () => openGeneratorDialog(ctx),
    import: () => openImportDialog(ctx, { csv: downloadCsvTemplate, json: downloadJsonTemplate }),
    'new-plan': () => openPlanDialog(ctx),
    'edit-plan': () => openPlanDialog(ctx, activePlan()),
    'delete-plan': async () => {
      const plan = activePlan();
      const own = workouts.filter((w) => w.planId === plan.id);
      const ok = await confirmDialog({
        title: tg('dlgDeletePlan'),
        message: t('confirmDeletePlan', { name: plan.name, count: own.length }),
        confirmLabel: tg('dlgDelete'),
        tone: 'danger',
      });
      if (!ok) return;
      for (const w of own) await remove('workouts', w.id);
      await remove('plans', plan.id);
      showToast(t('planDeleted'));
    },
    export: () => {
      const plan = activePlan();
      openExportDialog(ctx, plan, workouts.filter((w) => w.planId === plan.id));
    },
    'export-csv': () => {
      const plan = activePlan();
      downloadText(exportPlanCsv(workouts.filter((w) => w.planId === plan.id)), `${slug(plan.name)}.csv`, 'text/csv');
    },
    'template-csv': () => downloadCsvTemplate(),
    'template-json': () => downloadJsonTemplate(),
    'week-prev': () => setWeek(addDays(currentWeek(), -7)),
    'week-next': () => setWeek(addDays(currentWeek(), 7)),
    'week-today': () => setWeek(null),
    'add-workout': (el) => {
      const week = currentWeek();
      const now = today();
      const fallback = now >= week && now <= addDays(week, 6) ? now : week;
      const plan = activePlan();
      const easyPace = easyPaceOf(workouts.filter((w) => w.planId === plan.id));
      openWorkoutDialog(ctx, plan, { date: el.dataset.date ?? fallback, easyPace });
    },
    'edit-workout': (el) => {
      const w = workouts.find((x) => x.id === el.dataset.id);
      if (!w) return;
      const plan = activePlan();
      const planWorkouts = workouts.filter((x) => x.planId === plan.id);
      const match = matchWorkouts(planWorkouts, activities, today());
      openWorkoutDialog(ctx, plan, { workout: w, result: match.byWorkout.get(w.id), easyPace: easyPaceOf(planWorkouts) });
    },
  };

  function downloadCsvTemplate() {
    downloadText(csvTemplate(today()), 'training-plan-template.csv', 'text/csv');
  }
  function downloadJsonTemplate() {
    downloadText(jsonTemplate(today()), 'training-plan-template.json', 'application/json');
  }

  page.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const action = el && actions[el.dataset.action!];
    if (!action) return;
    Promise.resolve(action(el)).catch((err) => {
      console.error(err);
      showToast(String(err), 'error');
    });
  });
  page.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'trn-plan') ctx.selectPlan((target as HTMLSelectElement).value);
    render();
  });

  const onHash = () => {
    if (location.hash.startsWith('#/training')) render();
  };
  window.addEventListener('hashchange', onHash);
  const offData = onDataChange((store) => {
    if (store === 'activities' || store === 'plans' || store === 'workouts') void reload();
  });
  const offLang = onLangChange(render);

  void reload().catch((err) => {
    console.error(err);
    page.innerHTML = `<p class="screen-message">${t('readError')}</p>`;
  });

  return () => {
    window.removeEventListener('hashchange', onHash);
    offData();
    offLang();
    chart?.destroy();
    if (dialog.open) dialog.close();
    root.classList.remove('trn-root');
  };
};
