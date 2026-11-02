/** HTML builders for the training screen. All user text goes through esc(). */
import type { Activity } from '../../data/types';
import { formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import { getLang } from '../../i18n';
import { addDays, dateToMs, localDateOf, weekStart } from './dates';
import { t } from './i18n';
import { manualDoneDistance, plannedDistance, type MatchResult, type WorkoutResult } from './matching';
import type { PlanProgress, WeekVolume } from './progress';
import { estimateStep, flattenSteps, OPEN_STEP_SECONDS, stepKindLabel, stepsSummary, stepText } from './structure';
import { PLAN_GOALS, WORKOUT_KINDS, type PlannedWorkout, type TrainingPlan, type WorkoutKind, type WorkoutStatus, type WorkoutStep } from './types';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
export const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export const kindLabel = (k: WorkoutKind) => t(`kind_${k}`);
export const goalLabel = (g: TrainingPlan['goal']) => t(`goal_${g}`);
export const workoutTitle = (w: Pick<PlannedWorkout, 'title' | 'kind'>) => w.title || kindLabel(w.kind);

const STATUS_BADGE: Record<WorkoutStatus, string> = {
  done: 'good',
  partial: 'warn',
  missed: 'bad',
  upcoming: '',
  rest: '',
  skipped: '',
};
export const statusBadge = (s: WorkoutStatus) =>
  `<span class="badge ${STATUS_BADGE[s]}">${s === 'done' ? '✓ ' : ''}${t(`status_${s}`)}</span>`;

const km = (m: number) => `${formatNumber(m / 1000, 1)} km`;

/** "8 km · 45:00 · 5:30 /km" from whatever targets are set. */
export function targetText(w: Pick<PlannedWorkout, 'distance' | 'duration' | 'pace'>): string {
  const parts: string[] = [];
  if (w.distance) parts.push(km(w.distance));
  if (w.duration) parts.push(formatDuration(w.duration));
  if (w.pace) parts.push(formatPace(w.pace));
  return parts.join(' · ');
}

/** "6,02 km · 5:58 /km"; each part stays on one line. */
export const runText = (a: Activity) =>
  [formatDistance(a.summary.distance), a.summary.avgPace ? formatPace(a.summary.avgPace) : '']
    .filter(Boolean)
    .map((part) => part.replace(/ /g, '\u00a0'))
    .join(' · ');

export const shortDate = (d: string) =>
  new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(dateToMs(d));

const weekdayName = (d: string) => new Intl.DateTimeFormat(getLang(), { weekday: 'short' }).format(dateToMs(d));

export function weekRangeLabel(start: string): string {
  const fmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });
  return fmt.formatRange(dateToMs(start), dateToMs(addDays(start, 6)));
}

// ---- Page sections ----

export function emptyState(): string {
  return `
    <header class="page-header"><h1>${t('title')}</h1></header>
    <section class="card trn-empty">
      <div class="empty-state">
        <h2>${t('emptyTitle')}</h2>
        <p>${t('emptyText')}</p>
        <div class="trn-empty-actions">
          <button class="btn primary" type="button" data-action="generate">${icon('spark')}${t('generate')}</button>
          <button class="btn" type="button" data-action="import">${icon('upload')}${t('import')}</button>
          <button class="btn" type="button" data-action="new-plan">${icon('plus')}${t('newPlan')}</button>
        </div>
        <p class="trn-templates">
          <button class="btn ghost small" type="button" data-action="template-csv">${icon('file')}${t('templateCsv')}</button>
          <button class="btn ghost small" type="button" data-action="template-json">${icon('file')}${t('templateJson')}</button>
        </p>
      </div>
    </section>`;
}

export function header(): string {
  return `
    <header class="page-header">
      <h1>${t('title')}</h1>
      <div class="trn-header-actions">
        <button class="btn primary" type="button" data-action="generate">${icon('spark')}<span>${t('generate')}</span></button>
        <button class="btn" type="button" data-action="import">${icon('upload')}<span>${t('import')}</span></button>
        <button class="btn" type="button" data-action="new-plan">${icon('plus')}<span>${t('newPlan')}</span></button>
      </div>
    </header>`;
}

function raceText(days: number | undefined): string {
  if (days === undefined) return '';
  if (days > 1) return t('raceIn', { days });
  if (days === 1) return t('raceTomorrow');
  if (days === 0) return t('raceToday');
  return t('racePast', { days: -days });
}

export function planCard(plans: TrainingPlan[], plan: TrainingPlan, progress: PlanProgress): string {
  const pct = (v: number) => `${formatNumber(v * 100, 0)}%`;
  const options = plans
    .map((p) => `<option value="${esc(p.id)}" ${p.id === plan.id ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('');
  const race = raceText(progress.daysToRace);
  return `
    <section class="card trn-plan">
      <div class="trn-plan-head">
        <label class="trn-plan-select">
          <span class="muted">${t('plan')}</span>
          <select id="trn-plan" aria-label="${t('plan')}">${options}</select>
        </label>
        <span class="badge">${goalLabel(plan.goal)}</span>
        ${plan.raceDate ? `<span class="trn-race">${race} · ${esc(new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium' }).format(dateToMs(plan.raceDate)))}</span>` : ''}
        <div class="trn-plan-actions">
          <button class="btn ghost small" type="button" data-action="edit-plan" title="${t('editPlan')}" aria-label="${t('editPlan')}">${icon('edit')}</button>
          <button class="btn ghost small" type="button" data-action="export" title="${t('exportPlan')}" aria-label="${t('exportPlan')}">${icon('download')}</button>
          <button class="btn ghost small danger" type="button" data-action="delete-plan" title="${t('deletePlan')}" aria-label="${t('deletePlan')}">${icon('trash')}</button>
        </div>
      </div>
      <div class="trn-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.completion * 100)}" aria-label="${t('statCompletion')}">
        <span style="width:${Math.min(100, progress.completion * 100)}%"></span>
      </div>
      <dl class="stat-grid">
        <div class="stat main"><dt>${t('statCompletion')}</dt><dd>${pct(progress.completion)}</dd></div>
        <div class="stat"><dt>${t('statWorkouts')}</dt><dd>${progress.done + progress.partial}<small> / ${progress.total}</small></dd></div>
        <div class="stat"><dt>${t('statKm')}</dt><dd>${km(progress.doneTotal)}<small class="trn-of">${t('ofValue', { value: km(progress.plannedTotal) })}</small></dd></div>
        <div class="stat" title="${t('statConsistencyHint')}"><dt>${t('statConsistency')}</dt><dd>${progress.consistency === undefined ? '—' : pct(progress.consistency)}</dd></div>
        <div class="stat"><dt>${t('statStreak')}</dt><dd>${progress.streak === 1 ? t('streakOne') : t('streakValue', { n: progress.streak })}</dd></div>
      </dl>
    </section>`;
}

export interface WeekData {
  start: string;
  today: string;
  workouts: PlannedWorkout[];
  match: MatchResult;
  /** All runs in this week (any plan). */
  runs: Activity[];
  timeZone?: string;
  deload: boolean;
}

function workoutChip(r: WorkoutResult): string {
  const w = r.workout;
  const target = targetText(w);
  const run = r.activity
    ? `<a class="trn-run" href="#/activity/${encodeURIComponent(r.activity.id)}">${icon('check')}${esc(runText(r.activity))}</a>`
    : '';
  return `
    <div class="trn-wo trn-kind-${w.kind} trn-st-${r.status}">
      <button class="trn-wo-main" type="button" data-action="edit-workout" data-id="${esc(w.id)}" title="${t('editWorkout')}">
        <span class="trn-wo-kind">${kindLabel(w.kind)}</span>
        <span class="trn-wo-title">${esc(workoutTitle(w))}</span>
        ${target ? `<span class="trn-wo-target">${esc(target)}</span>` : ''}
        ${w.steps?.length ? structureBars(w.steps) : ''}
      </button>
      <div class="trn-wo-foot">${statusBadge(r.status)}${run}</div>
    </div>`;
}

export function weekCard(d: WeekData): string {
  const isThisWeek = d.start === weekStart(d.today);
  const dayHtml: string[] = [];
  let planned = 0, doneCount = 0, countable = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(d.start, i);
    const ws = d.workouts.filter((w) => w.date === date);
    const results = ws.map((w) => d.match.byWorkout.get(w.id)!);
    for (const r of results) {
      if (r.workout.kind === 'rest') continue;
      countable++;
      planned += plannedDistance(r.workout) ?? 0;
      if (r.status === 'done' || r.status === 'partial') doneCount++;
    }
    const extras = d.runs.filter((a) => localDateOf(a.startTime, d.timeZone) === date && !d.match.byActivity.has(a.id));
    const extraHtml = extras
      .map(
        (a) => `<a class="trn-extra" href="#/activity/${encodeURIComponent(a.id)}">
          <span class="badge">${t('extra')}</span><span>${esc(runText(a))}</span></a>`,
      )
      .join('');
    const classes = ['trn-day', date === d.today ? 'is-today' : '', date < d.today ? 'is-past' : ''].join(' ');
    const longDate = new Intl.DateTimeFormat(getLang(), { weekday: 'long', day: 'numeric', month: 'long' }).format(dateToMs(date));
    dayHtml.push(`
      <div class="${classes}">
        <div class="trn-day-head">
          <span class="trn-day-name">${esc(weekdayName(date))}</span>
          <span class="trn-day-num">${esc(shortDate(date))}</span>
          <button class="trn-day-add" type="button" data-action="add-workout" data-date="${date}" title="${esc(t('addOnDay', { date: longDate }))}" aria-label="${esc(t('addOnDay', { date: longDate }))}">${icon('plus')}</button>
        </div>
        ${results.map(workoutChip).join('')}
        ${extraHtml}
      </div>`);
  }
  // Runs this week, plus workouts marked done by hand without a run.
  const runKm =
    d.runs.reduce((s, a) => s + a.summary.distance, 0) +
    d.workouts.reduce((s, w) => s + manualDoneDistance(d.match.byWorkout.get(w.id)!), 0);
  const empty = !d.workouts.length && !d.runs.length;
  return `
    <section class="card trn-weekcard">
      <div class="trn-week-head">
        <h2 class="card-title">${esc(weekRangeLabel(d.start))}</h2>
        ${isThisWeek ? `<span class="badge good">${t('thisWeek')}</span>` : ''}
        ${d.deload ? `<span class="badge">${t('weekPhase_deload')}</span>` : ''}
        <div class="trn-week-nav">
          <button class="btn small" type="button" data-action="week-prev" title="${t('prevWeek')}" aria-label="${t('prevWeek')}">${icon('left')}</button>
          <button class="btn small" type="button" data-action="week-today" ${isThisWeek ? 'disabled' : ''}>${t('today')}</button>
          <button class="btn small" type="button" data-action="week-next" title="${t('nextWeek')}" aria-label="${t('nextWeek')}">${icon('right')}</button>
          <button class="btn small primary" type="button" data-action="add-workout">${icon('plus')}<span>${t('addWorkout')}</span></button>
        </div>
      </div>
      <dl class="trn-week-summary">
        <div><dt>${t('weekPlanned')}</dt><dd>${km(planned)}</dd></div>
        <div><dt>${t('weekDone')}</dt><dd>${km(runKm)}</dd></div>
        <div><dt>${t('weekWorkouts')}</dt><dd>${doneCount} / ${countable}</dd></div>
      </dl>
      ${empty ? `<p class="muted trn-week-empty">${t('noWorkoutsWeek')}</p>` : ''}
      <div class="trn-week">${dayHtml.join('')}</div>
    </section>`;
}

export function chartCard(weeks: WeekVolume[]): string {
  if (!weeks.length) return '';
  const rows = weeks
    .map((w) => `<tr><td>${esc(shortDate(w.start))}</td><td class="num">${km(w.planned)}</td><td class="num">${km(w.actual)}</td></tr>`)
    .join('');
  return `
    <section class="card trn-chartcard">
      <h2 class="card-title">${t('chartTitle')}</h2>
      <div class="trn-chart"><canvas id="trn-chart" role="img" aria-label="${t('chartTitle')}"></canvas></div>
      <details class="trn-table-toggle">
        <summary>${t('showTable')}</summary>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('colWeek')}</th><th class="num">${t('chartPlanned')}</th><th class="num">${t('chartDone')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </details>
    </section>`;
}

export function compareCard(results: WorkoutResult[]): string {
  const matched = results
    .filter((r) => r.activity && (r.status === 'done' || r.status === 'partial'))
    .sort((a, b) => b.workout.date.localeCompare(a.workout.date))
    .slice(0, 12);
  if (!matched.length) {
    return `<section class="card"><h2 class="card-title">${t('compareTitle')}</h2><p class="muted">${t('compareEmpty')}</p></section>`;
  }
  const rows = matched
    .map((r) => {
      const w = r.workout, a = r.activity!;
      let vs = '—';
      if (w.pace && a.summary.avgPace) {
        const diff = Math.round(a.summary.avgPace - w.pace);
        vs = Math.abs(diff) <= 10
          ? `<span class="badge good">${t('onTarget')}</span>`
          : diff < 0
            ? `<span class="badge">${t('faster', { s: -diff })}</span>`
            : `<span class="badge warn">${t('slower', { s: diff })}</span>`;
      } else if (r.status === 'partial') {
        vs = statusBadge('partial');
      }
      return `<tr>
        <td>${esc(shortDate(w.date))}</td>
        <td><a href="#/activity/${encodeURIComponent(a.id)}">${esc(workoutTitle(w))}</a></td>
        <td>${esc(targetText(w) || '—')}</td>
        <td>${esc(runText(a))}</td>
        <td>${vs}</td>
      </tr>`;
    })
    .join('');
  return `
    <section class="card">
      <h2 class="card-title">${t('compareTitle')}</h2>
      <div class="table-wrap"><table class="table trn-compare">
        <thead><tr><th>${t('colDate')}</th><th>${t('colWorkout')}</th><th>${t('colTarget')}</th><th>${t('colActual')}</th><th>${t('colVsTarget')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

// ---- Structured workouts ----

/** Relative bar height per step kind (a rough intensity profile). */
const STEP_HEIGHT = { warmup: 50, active: 100, recovery: 35, cooldown: 50, rest: 20 } as const;
const MAX_BARS = 200;

/**
 * Compact block diagram of a structured workout: one bar per step actually
 * run (repeats expanded), width ∝ estimated time, coloured by step kind.
 */
export function structureBars(steps: WorkoutStep[], easyPace?: number): string {
  const flat = flattenSteps(steps).slice(0, MAX_BARS);
  if (!flat.length) return '';
  const bars = flat
    .map((s) => {
      const seconds = estimateStep(s, easyPace).duration || OPEN_STEP_SECONDS;
      const label = `${stepKindLabel(s.kind)}: ${stepText(s)}`;
      return `<span class="trn-bar trn-step-${s.kind}" style="flex-grow:${Math.max(1, Math.round(seconds))};height:${STEP_HEIGHT[s.kind]}%" title="${esc(label)}"></span>`;
    })
    .join('');
  const summary = stepsSummary(steps);
  return `<span class="trn-bars" role="img" aria-label="${esc(t('structureLabel', { value: summary }))}" title="${esc(summary)}">${bars}</span>`;
}

// ---- Form fragments ----

export const kindOptions = (selected: WorkoutKind) =>
  WORKOUT_KINDS.map((k) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${kindLabel(k)}</option>`).join('');

export const goalOptions = (selected: TrainingPlan['goal'], goals = PLAN_GOALS) =>
  goals.map((g) => `<option value="${g}" ${g === selected ? 'selected' : ''}>${goalLabel(g)}</option>`).join('');

