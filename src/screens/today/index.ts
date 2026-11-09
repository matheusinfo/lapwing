import '../training/training.css';
import './today.css';
import type { ScreenMount } from '../../app/screen';
import { getAll, getSettings, listActivities, onDataChange } from '../../data/db';
import { DEFAULT_SETTINGS, type Activity, type AthleteSettings } from '../../data/types';
import { onLangChange } from '../../i18n';
import type { Goal } from '../insights/goals';
import { loadActivePlan } from '../training/active-plan';
import { todayDate } from '../training/dates';
import { downloadFile, exportWorkoutFit, fileSlug } from '../training/export';
import type { PlannedWorkout, TrainingPlan } from '../training/types';
import { workoutTitle } from '../training/view';
import { goalsToday, lastRun, planDay, readiness } from './calc';
import { t } from './i18n';
import { goalsCard, header, lastRunCard, readinessCard, welcome, workoutCard } from './view';

/** How often to check whether the day changed while the screen stays open. */
const DAY_CHECK_MS = 60_000;
const STORES = new Set(['activities', 'settings', 'plans', 'workouts', 'goals']);

/** Home screen: today's workout, how training is going, goals and the last run. */
export const mount: ScreenMount = (root) => {
  root.classList.add('tdy-root');

  let activities: Activity[] = [];
  let settings: AthleteSettings = { ...DEFAULT_SETTINGS };
  let plans: TrainingPlan[] = [];
  let workouts: PlannedWorkout[] = [];
  let goals: Goal[] = [];
  let loaded = false;
  let failed = false;
  let disposed = false;
  let loadId = 0;
  let renderedDay = '';

  async function load(): Promise<void> {
    const id = ++loadId;
    try {
      const [a, s, p, w, g] = await Promise.all([
        listActivities(),
        getSettings(),
        getAll<TrainingPlan>('plans'),
        getAll<PlannedWorkout>('workouts'),
        getAll<Goal>('goals'),
      ]);
      if (disposed || id !== loadId) return;
      [activities, settings, plans, workouts, goals] = [a, s, p, w, g];
      failed = false;
    } catch (err) {
      console.error('Today: could not load data', err);
      if (disposed || id !== loadId) return;
      failed = true;
    }
    loaded = true;
    render();
  }

  function render(): void {
    const now = Date.now();
    const today = todayDate();
    renderedDay = today;
    if (!loaded || failed) {
      root.innerHTML = `<div class="page tdy-page"><p class="muted">${failed ? t('loadFailed') : t('loading')}</p></div>`;
      return;
    }
    const plan = planDay(plans, loadActivePlan(), workouts, activities, today);
    if (!activities.length && !plan && !goals.length) {
      root.innerHTML = `<div class="page tdy-page">${header(now, undefined)}${welcome()}</div>`;
      return;
    }
    const run = lastRun(activities, now);
    root.innerHTML = `
      <div class="page tdy-page">
        ${header(now, plan)}
        <div class="tdy-grid">
          ${workoutCard(plan, today)}
          <div class="tdy-side">
            ${readinessCard(readiness(activities, settings, now))}
            ${goalsCard(goalsToday(goals, activities, now))}
            ${lastRunCard(run, run && plan?.workoutOfRun.get(run.id), settings, today)}
          </div>
        </div>
      </div>`;
  }

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="fit"]');
    if (!btn) return;
    const w = workouts.find((x) => x.id === btn.dataset.id);
    if (!w) return;
    const name = `${w.date}-${fileSlug(workoutTitle(w), 'workout')}`;
    downloadFile(exportWorkoutFit(w), `${name}.fit`, 'application/vnd.ant.fit');
  });

  // A screen left open (e.g. on a wall display) moves to the next day by itself.
  const dayTimer = setInterval(() => {
    if (loaded && todayDate() !== renderedDay) render();
  }, DAY_CHECK_MS);
  const stopData = onDataChange((store) => {
    if (STORES.has(store)) void load();
  });
  const stopLang = onLangChange(render);

  render();
  void load();

  return () => {
    disposed = true;
    clearInterval(dayTimer);
    stopData();
    stopLang();
    root.classList.remove('tdy-root');
  };
};
