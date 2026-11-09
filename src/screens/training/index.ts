import './training.css';
import type { ScreenMount } from '../../app/screen';
import { currentQuery } from '../../app/router';
import { getAll, listActivities, onDataChange, putMany, remove } from '../../data/db';
import type { Activity } from '../../data/types';
import { onLangChange, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import type { Chart } from '../../ui/chart-theme';
import { weeklyChart } from './chart';
import { csvTemplate, exportPlanCsv, jsonTemplate } from './csv';
import { loadActivePlan, pickActivePlan, saveActivePlan } from './active-plan';
import { addDays, isDateStr, localDateOf, todayDate, weekStart } from './dates';
import { openExportDialog, openGeneratorDialog, openImportDialog, openPlanDialog, openWorkoutDialog, type DialogContext } from './dialogs';
import { t } from './i18n';
import { linkRunTo, matchWorkouts } from './matching';
import { computeProgress } from './progress';
import { easyPaceOf } from './structure';
import type { PlannedWorkout, TrainingPlan } from './types';
import { chartCard, compareCard, emptyState, header, planCard, shortDate, WEEK_SPANS, weekCard, workoutTitle, type WeekSpan } from './view';
import { confirmDialog } from '../../ui/confirm';

const WEEK_SPAN_KEY = 'lapwing:training:week-span';
/** dataTransfer type of a run dragged in the week view. */
const RUN_MIME = 'application/x-lapwing-run';

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

function loadWeekSpan(): WeekSpan {
  try {
    const n = Number(localStorage.getItem(WEEK_SPAN_KEY));
    return (WEEK_SPANS as readonly number[]).includes(n) ? (n as WeekSpan) : 1;
  } catch {
    return 1;
  }
}
function saveWeekSpan(n: WeekSpan): void {
  try {
    localStorage.setItem(WEEK_SPAN_KEY, String(n));
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
  let weekSpan = loadWeekSpan();
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
  const activePlan = () => pickActivePlan(plans, activePlanId)!;

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
    const weekEnd = addDays(week, 7 * weekSpan - 1);
    const weekRuns = activities.filter((a) => {
      const d = localDateOf(a.startTime);
      return d >= week && d <= weekEnd && (a.type === 'run' || a.type === 'trail-run');
    });
    // An easier week in a generated plan: about 75 % of the previous week's planned km.
    const isDeload = (start: string) => {
      const idx = progress.weeks.findIndex((w) => w.start === start);
      return idx > 0 && progress.weeks[idx].planned > 0 && progress.weeks[idx].planned < 0.85 * progress.weeks[idx - 1].planned && !!plan.raceDate && start < weekStart(plan.raceDate) && idx < progress.weeks.length - 2;
    };
    const deload = Array.from({ length: weekSpan }, (_, i) => isDeload(addDays(week, 7 * i)));

    page.innerHTML = [
      header(),
      planCard(plans, plan, progress),
      weekCard({
        start: week,
        span: weekSpan,
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
    'week-span': (el) => {
      const n = Number(el.dataset.span) as WeekSpan;
      if (!WEEK_SPANS.includes(n) || n === weekSpan) return;
      weekSpan = n;
      saveWeekSpan(n);
      render();
    },
    'add-workout': (el) => {
      const week = currentWeek();
      const now = today();
      const fallback = now >= week && now <= addDays(week, 7 * weekSpan - 1) ? now : week;
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

  // ---- Drag a run onto a workout (of any day of the week) to link it ----

  let draggedRun: string | null = null;
  let dropTarget: HTMLElement | null = null;
  const setDropTarget = (found: HTMLElement | null) => {
    // Over a day, highlight the workout of that day that will get the run.
    const el =
      found?.classList.contains('trn-day')
        ? [...found.querySelectorAll<HTMLElement>('.trn-wo[data-drop]')].find((c) => c.dataset.drop === found.dataset.drop) ?? found
        : found;
    if (el === dropTarget) return;
    dropTarget?.classList.remove('is-drop-target');
    dropTarget = el;
    dropTarget?.classList.add('is-drop-target');
  };
  const endDrag = () => {
    draggedRun = null;
    setDropTarget(null);
    page.classList.remove('trn-dragging');
    page.querySelector('.is-dragging')?.classList.remove('is-dragging');
  };

  async function linkRun(activityId: string, workoutId: string): Promise<void> {
    const plan = activePlan();
    const changed = linkRunTo(workouts.filter((w) => w.planId === plan.id), activityId, workoutId);
    if (!changed.length) return;
    await putMany('workouts', changed);
    const target = changed.find((w) => w.id === workoutId)!;
    showToast(t('runLinked', { workout: workoutTitle(target), date: shortDate(target.date) }));
  }

  page.addEventListener('dragstart', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-run]');
    if (!el || !e.dataTransfer) return;
    draggedRun = el.dataset.run!;
    e.dataTransfer.setData(RUN_MIME, draggedRun);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('is-dragging');
    page.classList.add('trn-dragging');
  });
  page.addEventListener('dragover', (e) => {
    if (!draggedRun) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    setDropTarget(target);
    if (!target) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  page.addEventListener('dragleave', (e) => {
    if (dropTarget && !dropTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
  });
  page.addEventListener('drop', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    const run = draggedRun;
    endDrag();
    if (!run || !target) return;
    e.preventDefault();
    linkRun(run, target.dataset.drop!).catch((err) => {
      console.error(err);
      showToast(String(err), 'error');
    });
  });
  page.addEventListener('dragend', endDrag);

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
