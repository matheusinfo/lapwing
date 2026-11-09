/** HTML builders for the Today screen. All user text goes through esc(). */
import { trimpFromSummary } from '../../data/metrics';
import type { Activity, AthleteSettings } from '../../data/types';
import { formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import { getLang } from '../../i18n';
import { STATUS as GOAL_STATUS, goalTitle } from '../insights/goals-view';
import { t as ti, type InsightsKey } from '../insights/i18n';
import { alertParams, formatMetric, SEVERITY } from '../insights/view';
import { addDays, dateToMs } from '../training/dates';
import { isRunning } from '../training/export';
import { t as tt } from '../training/i18n';
import type { WorkoutResult } from '../training/matching';
import { durationText, stepKindLabel, targetText as stepTarget } from '../training/structure';
import type { PlannedWorkout, SimpleStep, WorkoutStep } from '../training/types';
import { esc, kindLabel, runText, statusBadge, structureBars, targetText, workoutTitle } from '../training/view';
import { daysAgo, loadLevel, type GoalToday, type PlanDay, type Readiness } from './calc';
import { t } from './i18n';

const km = (m: number) => `${formatNumber(m / 1000, 1)} km`;

const ICONS = {
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/** "Monday, November 9". */
export const longDate = (ms: number) =>
  new Intl.DateTimeFormat(getLang(), { weekday: 'long', day: 'numeric', month: 'long' }).format(ms);

/** "Tomorrow", or "Wed, Nov 11". */
function dayLabel(date: string, today: string): string {
  if (date === addDays(today, 1)) return t('tomorrow');
  return new Intl.DateTimeFormat(getLang(), { weekday: 'short', day: 'numeric', month: 'short' }).format(dateToMs(date));
}

/** "today", "yesterday", "3 days ago"; the date itself after a week. */
function whenText(a: Activity, today: string): string {
  const n = daysAgo(a, today);
  if (n >= 0 && n < 7) return new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' }).format(-n, 'day');
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium' }).format(a.startTime);
}

const timeOf = (a: Activity) =>
  a.hasStartTime ? new Intl.DateTimeFormat(getLang(), { timeStyle: 'short' }).format(a.startTime) : '';

export function header(now: number, plan: PlanDay | undefined): string {
  let race = '';
  if (plan?.daysToRace !== undefined) {
    const d = plan.daysToRace;
    race = `<span class="badge tdy-race">${d === 0 ? tt('raceToday') : d === 1 ? tt('raceTomorrow') : tt('raceIn', { days: d })}</span>`;
  }
  return `
    <header class="page-header tdy-header">
      <div class="tdy-heading">
        <h1>${t('title')}</h1>
        <p class="muted tdy-date">${esc(longDate(now))}</p>
      </div>
      ${race}
    </header>`;
}

export function welcome(): string {
  return `
    <section class="card tdy-welcome">
      <div class="empty-state">
        <h2>${t('welcomeTitle')}</h2>
        <p>${t('welcomeText')}</p>
        <div class="tdy-actions tdy-welcome-actions">
          <a class="btn primary" href="#/activity">${t('welcomeImport')}</a>
          <a class="btn" href="#/training">${t('welcomePlan')}</a>
          <a class="btn" href="#/routes">${t('welcomeRoute')}</a>
        </div>
      </div>
    </section>`;
}

// ---- Today's workout ----

function stepLine(s: SimpleStep): string {
  const detail = [durationText(s.duration), s.target ? `@ ${stepTarget(s.target)}` : ''].filter(Boolean).join(' ');
  return `<span class="tdy-step-kind trn-step-${s.kind}">${esc(stepKindLabel(s.kind))}</span>
    <span>${esc(detail)}${s.note ? ` <span class="muted">· ${esc(s.note)}</span>` : ''}</span>`;
}

function stepsList(steps: WorkoutStep[]): string {
  const items = steps
    .map((s) => {
      if (s.type === 'step') return `<li>${stepLine(s)}</li>`;
      const inner = s.steps.map((x) => `<li>${stepLine(x)}</li>`).join('');
      return `<li class="tdy-repeat"><strong>${t('repeatTimes', { n: s.times })}</strong><ol>${inner}</ol></li>`;
    })
    .join('');
  return `<ol class="tdy-steps" aria-label="${t('steps')}">${items}</ol>`;
}

function workoutBlock(r: WorkoutResult): string {
  const w = r.workout;
  if (w.kind === 'rest') {
    return `
      <article class="tdy-workout trn-kind-rest">
        <h3 class="tdy-wo-title">${t('restTitle')}</h3>
        <p class="muted">${w.title ? `${esc(w.title)} · ` : ''}${t('restText')}</p>
        ${w.description ? `<p class="tdy-desc">${esc(w.description)}</p>` : ''}
      </article>`;
  }
  const target = targetText(w);
  const actions: string[] = [];
  if (r.activity) {
    actions.push(
      `<a class="btn small" href="#/activity/${encodeURIComponent(r.activity.id)}">${icon('check')}${t('openRun')} · ${esc(runText(r.activity))}</a>`,
    );
  } else if (isRunning(w) && r.status === 'upcoming') {
    actions.push(
      `<button class="btn small primary" type="button" data-action="fit" data-id="${esc(w.id)}" title="${t('fitTitle')}">${icon('download')}${tt('exportFit')}</button>`,
    );
  }
  return `
    <article class="tdy-workout trn-kind-${w.kind}" data-workout="${esc(w.id)}">
      <div class="tdy-wo-head">
        <span class="tdy-wo-kind">${kindLabel(w.kind)}</span>
        ${statusBadge(r.status)}
      </div>
      <h3 class="tdy-wo-title">${esc(workoutTitle(w))}</h3>
      ${target ? `<p class="tdy-wo-target">${esc(target)}</p>` : ''}
      ${w.steps?.length ? `<div class="tdy-bars">${structureBars(w.steps)}</div>${stepsList(w.steps)}` : ''}
      ${w.description ? `<p class="tdy-desc">${esc(w.description)}</p>` : ''}
      ${actions.length ? `<div class="tdy-actions">${actions.join('')}</div>` : ''}
    </article>`;
}

function weekStats(p: PlanDay): string {
  const w = p.week;
  return `
    <dl class="tdy-week">
      <div><dt>${t('weekRun')}</dt><dd>${km(w.run)} <span class="muted">/ ${km(w.planned)}</span></dd></div>
      <div><dt>${t('weekWorkouts')}</dt><dd>${w.done} <span class="muted">/ ${w.total}</span></dd></div>
    </dl>`;
}

function upcomingList(list: PlannedWorkout[], today: string): string {
  if (!list.length) return `<p class="muted tdy-small">${t('upcomingEmpty')}</p>`;
  const items = list
    .map((w) => {
      const target = targetText(w);
      return `
        <li class="trn-kind-${w.kind}">
          <span class="tdy-up-day">${esc(dayLabel(w.date, today))}</span>
          <span class="tdy-up-name">${esc(workoutTitle(w))}</span>
          ${target ? `<span class="tdy-up-target muted">${esc(target)}</span>` : ''}
        </li>`;
    })
    .join('');
  return `<ul class="tdy-upcoming">${items}</ul>`;
}

export function workoutCard(p: PlanDay | undefined, today: string): string {
  if (!p) {
    return `
      <section class="card tdy-main" aria-labelledby="tdy-workout-title">
        <h2 class="card-title" id="tdy-workout-title">${t('workoutTitle')}</h2>
        <p class="muted">${t('noPlanText')}</p>
        <div class="tdy-actions"><a class="btn primary" href="#/training">${t('goToTraining')}</a></div>
      </section>`;
  }
  const body = p.today.length
    ? p.today.map(workoutBlock).join('')
    : `<p class="tdy-nothing">${t('nothingToday')}</p>`;
  return `
    <section class="card tdy-main" aria-labelledby="tdy-workout-title">
      <div class="tdy-card-head">
        <h2 class="card-title" id="tdy-workout-title">${t('workoutTitle')}</h2>
        <a class="tdy-plan-link" href="#/training">${t('planLabel')}: ${esc(p.plan.name)}</a>
      </div>
      ${body}
      ${weekStats(p)}
      <h3 class="tdy-subtitle">${t('upcomingTitle')}</h3>
      ${upcomingList(p.upcoming, today)}
      <a class="tdy-more" href="#/training">${t('openTraining')}${icon('arrow')}</a>
    </section>`;
}

// ---- How you are doing ----

export function readinessCard(r: Readiness): string {
  const form = r.form
    ? `<div class="tdy-form tdy-form-${r.form.state}" title="${esc(t('formHint'))}">
        <span class="tdy-form-label">${t('form')}</span>
        <strong>${t(`form_${r.form.state}`)}</strong>
        <span class="muted">${formatNumber(r.form.value)}</span>
      </div>`
    : '';

  let alerts: string;
  if (!r.hasTraining) {
    alerts = `<p class="muted">${ti('noTraining')}</p>`;
  } else if (!r.alerts.length) {
    alerts = `<p class="tdy-all-good"><span class="badge good">${ti('allGood')}</span> <span>${ti('allGoodText')}</span></p>`;
  } else {
    const a = r.alerts[0];
    const sev = SEVERITY[a.severity];
    const params = alertParams(a);
    const more = r.alerts.length - 1;
    alerts = `
      <div class="tdy-alert sev-${a.severity}" data-alert="${a.kind}">
        <div class="tdy-alert-head">
          <span class="badge ${sev.badge}">${ti(sev.label)}</span>
          <strong>${ti(`${a.kind}Title` as InsightsKey, params)}</strong>
        </div>
        <p>${ti(`${a.kind}Tip` as InsightsKey, params)}</p>
        ${more > 0 ? `<p class="muted tdy-small">${more === 1 ? t('moreAlertsOne') : t('moreAlerts', { n: more })}</p>` : ''}
      </div>`;
  }

  const s = r.stats;
  const stats = r.hasTraining
    ? `<dl class="tdy-mini-stats">
        <div><dt>${t('last7')}</dt><dd>${km(s.acuteDistance)}</dd></div>
        <div><dt>${t('avgWeek')}</dt><dd>${km(s.chronicDistance)}</dd></div>
        <div><dt>${t('streak')}</dt><dd>${s.streak}</dd></div>
      </dl>`
    : '';

  return `
    <section class="card tdy-readiness" aria-labelledby="tdy-ready-title">
      <h2 class="card-title" id="tdy-ready-title">${t('readinessTitle')}</h2>
      ${form}
      ${alerts}
      ${stats}
      <a class="tdy-more" href="#/insights">${t('seeAlerts')}${icon('arrow')}</a>
    </section>`;
}

// ---- Goals ----

export function goalsCard(goals: GoalToday[]): string {
  let body: string;
  if (!goals.length) {
    body = `
      <p class="muted">${t('goalsEmpty')}</p>
      <div class="tdy-actions"><a class="btn small" href="#/insights">${t('newGoal')}</a></div>`;
  } else {
    body = `<ul class="tdy-goals">${goals
      .map(({ goal, progress: p }) => {
        const status = GOAL_STATUS[p.status];
        const fill = Math.min(100, p.pct);
        const meta =
          p.status === 'achieved'
            ? ''
            : `${ti('toGo', { value: formatMetric(goal.metric, p.remaining) })} · ${p.daysLeft === 1 ? ti('dayLeft') : ti('daysLeft', { n: p.daysLeft })}`;
        return `
          <li class="tdy-goal" data-goal-id="${esc(goal.id)}">
            <div class="tdy-goal-head">
              <span>${goalTitle(goal)}</span>
              <span class="badge ${status.cls}">${ti(status.label)}</span>
            </div>
            <p class="tdy-goal-value"><strong>${formatMetric(goal.metric, p.value)}</strong>
              <span class="muted">${ti('ofTarget', { target: formatMetric(goal.metric, p.target) })} · ${formatNumber(p.pct)}%</span></p>
            <div class="tdy-bar tdy-bar-${p.status}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fill)}" aria-label="${esc(goalTitle(goal))}">
              <span style="width:${fill.toFixed(1)}%"></span>
            </div>
            ${meta ? `<p class="muted tdy-small">${meta}</p>` : ''}
          </li>`;
      })
      .join('')}</ul>`;
  }
  return `
    <section class="card tdy-goals-card" aria-labelledby="tdy-goals-title">
      <h2 class="card-title" id="tdy-goals-title">${t('goalsTitle')}</h2>
      ${body}
    </section>`;
}

// ---- Last run ----

export function lastRunCard(
  run: Activity | undefined,
  workout: PlannedWorkout | undefined,
  settings: AthleteSettings,
  today: string,
): string {
  if (!run) {
    return `
      <section class="card tdy-last" aria-labelledby="tdy-last-title">
        <h2 class="card-title" id="tdy-last-title">${t('lastRunTitle')}</h2>
        <p class="muted">${t('noRuns')}</p>
        <div class="tdy-actions"><a class="btn small" href="#/activity">${t('importRuns')}</a></div>
      </section>`;
  }
  const s = run.summary;
  const href = `#/activity/${encodeURIComponent(run.id)}`;
  const trimp = trimpFromSummary(s, settings);
  const tile = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const tiles = [
    tile(t('distance'), esc(formatDistance(s.distance))),
    s.movingTime ? tile(t('movingTime'), esc(formatDuration(s.movingTime))) : '',
    s.avgPace ? tile(t('pace'), esc(formatPace(s.avgPace))) : '',
    s.avgHr !== undefined ? tile(t('avgHr'), `${formatNumber(s.avgHr)} bpm`) : '',
    trimp !== undefined ? tile(t('load'), `${formatNumber(trimp)} <small class="muted">${t(`load_${loadLevel(trimp)}`)}</small>`) : '',
  ].join('');
  const when = [whenText(run, today), timeOf(run)].filter(Boolean).join(' · ');
  return `
    <section class="card tdy-last" aria-labelledby="tdy-last-title">
      <h2 class="card-title" id="tdy-last-title">${t('lastRunTitle')}</h2>
      <p class="tdy-run-name"><a href="${href}">${esc(run.name)}</a></p>
      <p class="muted tdy-small">${esc(when)}${workout ? ` · ${esc(t('forWorkout', { name: workoutTitle(workout) }))}` : ''}</p>
      <dl class="tdy-mini-stats">${tiles}</dl>
      ${
        run.rpe === undefined
          ? `<a class="tdy-more tdy-rpe" href="${href}">${t('rpeAsk')}${icon('arrow')}</a>`
          : `<p class="muted tdy-small">${t('rpeValue', { n: run.rpe })}</p>
             <a class="tdy-more" href="${href}">${t('openReport')}${icon('arrow')}</a>`
      }
    </section>`;
}
