/** Goals section of the Insights screen: progress cards and the add/edit dialog. */
import { newId, put, remove } from '../../data/db';
import type { Activity, ActivityType } from '../../data/types';
import { formatDate, formatNumber } from '../../format';
import { getLang, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import {
  DEFAULT_GOAL_TYPES,
  GOAL_METRICS,
  GOAL_PERIODS,
  goalHistory,
  goalProgress,
  goalStreak,
  hoursInput,
  parseTarget,
  sortGoals,
  type Goal,
  type GoalMetric,
  type GoalPeriod,
  type GoalPeriodResult,
  type GoalStatus,
} from './goals';
import { t, type InsightsKey } from './i18n';
import { esc, formatMetric } from './view';
import { confirmDialog } from '../../ui/confirm';

const STATUS: Record<GoalStatus, { label: InsightsKey; cls: string }> = {
  achieved: { label: 'statusAchieved', cls: 'good' },
  'on-track': { label: 'statusOnTrack', cls: '' },
  behind: { label: 'statusBehind', cls: 'warn' },
};

const ALL_TYPES: { type: ActivityType; label: InsightsKey }[] = [
  { type: 'run', label: 'typeRun' },
  { type: 'trail-run', label: 'typeTrail' },
  { type: 'walk', label: 'typeWalk' },
  { type: 'other', label: 'typeOther' },
];

const PERIOD_LABEL: Record<GoalPeriod, InsightsKey> = { week: 'periodWeek', month: 'periodMonth' };
const METRIC_LABEL: Record<GoalMetric, InsightsKey> = {
  distance: 'metricDistance',
  time: 'metricTime',
  runs: 'metricRuns',
};
const UNIT: Record<GoalMetric, { unit: InsightsKey; hint: InsightsKey }> = {
  distance: { unit: 'unitKm', hint: 'hintKm' },
  time: { unit: 'unitHours', hint: 'hintHours' },
  runs: { unit: 'unitRuns', hint: 'hintRuns' },
};

const EDIT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

export const goalTitle = (g: Goal) => t(`goal_${g.period}_${g.metric}` as InsightsKey);

function periodLabel(g: Goal, p: GoalPeriodResult): string {
  return g.period === 'week'
    ? t('weekOf', { date: formatDate(p.start) })
    : new Intl.DateTimeFormat(getLang(), { month: 'long', year: 'numeric' }).format(p.start);
}

function historyHtml(g: Goal, history: GoalPeriodResult[]): string {
  const bars = history
    .map((p) => {
      const ratio = g.target > 0 ? p.value / g.target : 0;
      const height = Math.max(4, Math.min(100, ratio * 100));
      const cls = p.current ? (p.hit ? 'hit current' : 'current') : p.hit ? 'hit' : 'miss';
      const key: InsightsKey = p.current && !p.hit ? 'historyCurrent' : p.hit ? 'historyHit' : 'historyMiss';
      const label = t(key, { period: periodLabel(g, p), value: formatMetric(g.metric, p.value) });
      return `<span class="ins-hbar ${cls}" title="${esc(label)}" aria-label="${esc(label)}" role="img"><span style="height:${height.toFixed(1)}%"></span></span>`;
    })
    .join('');
  return `<div class="ins-history" aria-label="${t('historyLabel')}">${bars}</div>`;
}

function cardHtml(g: Goal, activities: Activity[], now: number, since: number): string {
  const p = goalProgress(g, activities, now);
  const status = STATUS[p.status];
  const history = goalHistory(g, activities, now, 8, since);
  const streak = goalStreak(g, activities, now);
  const fill = Math.min(100, p.pct);
  const marker = p.status === 'achieved' ? '' : Math.min(100, (p.expectedByNow / (p.target || 1)) * 100);
  const valueText = formatMetric(g.metric, p.value);
  const targetText = formatMetric(g.metric, p.target);

  const details: string[] = [];
  if (p.status === 'achieved') {
    if (p.value > p.target) details.push(t('exceededBy', { value: formatMetric(g.metric, p.value - p.target) }));
  } else {
    details.push(t('toGo', { value: formatMetric(g.metric, p.remaining) }));
    details.push(p.daysLeft === 1 ? t('dayLeft') : t('daysLeft', { n: p.daysLeft }));
    details.push(
      g.metric === 'runs'
        ? t('runsInDays', { n: formatNumber(Math.ceil(p.remaining)), days: p.daysLeft })
        : t('perDay', { value: formatMetric(g.metric, p.perDayNeeded) }),
    );
  }
  const streakText =
    streak > 0 ? t(g.period === 'week' ? 'streakWeeks' : 'streakMonths', { n: streak }) : t('streakNone');

  return `
    <article class="ins-goal" data-goal-id="${esc(g.id)}">
      <header class="ins-goal-head">
        <h3>${goalTitle(g)}</h3>
        <span class="badge ${status.cls}">${t(status.label)}</span>
        <button type="button" class="btn ghost small ins-icon-btn" data-edit-goal="${esc(g.id)}"
          title="${t('editGoal')}" aria-label="${t('editGoal')}">${EDIT_ICON}</button>
      </header>
      <p class="ins-goal-value"><strong>${valueText}</strong> <span class="muted">${t('ofTarget', { target: targetText })} · ${formatNumber(p.pct)}%</span></p>
      <div class="ins-bar ${p.status}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fill)}"
        aria-label="${esc(t('progressLabel', { value: valueText, target: targetText, pct: formatNumber(p.pct) }))}">
        <span class="ins-bar-fill" style="width:${fill.toFixed(1)}%"></span>
        ${marker === '' || marker <= 0 ? '' : `<span class="ins-bar-marker" style="left:${marker.toFixed(1)}%" title="${t('expectedMarker')}"></span>`}
      </div>
      ${details.length ? `<p class="ins-goal-meta">${details.join(' · ')}</p>` : ''}
      ${p.status !== 'achieved' ? `<p class="ins-goal-meta muted">${t('projected', { value: formatMetric(g.metric, p.projected) })}</p>` : ''}
      <footer class="ins-goal-foot">
        ${historyHtml(g, history)}
        <span class="ins-streak${streak > 0 ? ' on' : ''}">${streakText}</span>
      </footer>
    </article>`;
}

/** Renders the goals body: cards, or an empty state inviting to create one. */
export function renderGoals(el: Element, goals: Goal[], activities: Activity[], now: number): void {
  if (!goals.length) {
    el.innerHTML = `
      <div class="empty-state ins-empty">
        <h2>${t('goalsEmptyTitle')}</h2>
        <p>${t('goalsEmptyText')}</p>
        <button type="button" class="btn primary" data-new-goal>${t('newGoal')}</button>
      </div>`;
    return;
  }
  const since = activities.reduce((min, a) => Math.min(min, a.startTime), Infinity);
  el.innerHTML = `<div class="ins-goals">${sortGoals(goals)
    .map((g) => cardHtml(g, activities, now, since))
    .join('')}</div>`;
}

// ---- Dialog ----

function targetInput(g: Goal | undefined, metric: GoalMetric): string {
  if (!g || g.metric !== metric) return '';
  if (metric === 'distance') return String(Number((g.target / 1000).toFixed(2)));
  if (metric === 'time') return hoursInput(g.target);
  return String(g.target);
}

/** Opens the add (no goal) or edit dialog. Saving writes to the `goals` store. */
export function openGoalDialog(dialog: HTMLDialogElement, goal?: Goal): void {
  const types = goal?.activityTypes?.length ? goal.activityTypes : DEFAULT_GOAL_TYPES;
  const metric0 = goal?.metric ?? 'distance';
  dialog.innerHTML = `
    <form class="ins-form" novalidate>
      <h2>${goal ? t('dialogEdit') : t('dialogNew')}</h2>
      <div class="ins-form-grid">
        <label class="field">
          <span>${t('fieldPeriod')}</span>
          <select name="period">
            ${GOAL_PERIODS.map((p) => `<option value="${p}"${p === (goal?.period ?? 'week') ? ' selected' : ''}>${t(PERIOD_LABEL[p])}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>${t('fieldMetric')}</span>
          <select name="metric">
            ${GOAL_METRICS.map((m) => `<option value="${m}"${m === metric0 ? ' selected' : ''}>${t(METRIC_LABEL[m])}</option>`).join('')}
          </select>
        </label>
        <label class="field ins-span2">
          <span>${t('fieldTarget')} (<span data-unit>${t(UNIT[metric0].unit)}</span>)</span>
          <input type="text" name="target" inputmode="decimal" autocomplete="off" value="${esc(targetInput(goal, metric0))}" placeholder="${t(UNIT[metric0].hint)}" />
        </label>
        <fieldset class="field ins-span2 ins-types">
          <legend>${t('fieldTypes')}</legend>
          ${ALL_TYPES.map(
            ({ type, label }) =>
              `<label class="ins-check"><input type="checkbox" name="types" value="${type}"${types.includes(type) ? ' checked' : ''} /> ${t(label)}</label>`,
          ).join('')}
        </fieldset>
      </div>
      <p class="ins-form-error" role="alert" hidden></p>
      <div class="ins-form-actions">
        ${goal ? `<button type="button" class="btn danger" data-delete>${t('delete')}</button>` : ''}
        <span class="ins-spacer"></span>
        <button type="button" class="btn" data-close>${t('cancel')}</button>
        <button type="submit" class="btn primary">${t('save')}</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form')!;
  const metricSel = form.elements.namedItem('metric') as HTMLSelectElement;
  const targetEl = form.elements.namedItem('target') as HTMLInputElement;
  const errorEl = form.querySelector<HTMLElement>('.ins-form-error')!;
  const close = () => (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'));
  const showError = (msg: string | null) => {
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
  };

  metricSel.addEventListener('change', () => {
    const m = metricSel.value as GoalMetric;
    form.querySelector('[data-unit]')!.textContent = t(UNIT[m].unit);
    targetEl.placeholder = t(UNIT[m].hint);
    targetEl.value = targetInput(goal, m);
    targetEl.inputMode = m === 'runs' ? 'numeric' : m === 'time' ? 'text' : 'decimal';
  });
  form.querySelector('[data-close]')!.addEventListener('click', close);

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!goal) return;
    const ok = await confirmDialog({
      title: tg('dlgDeleteGoal'),
      message: t('confirmDelete'),
      confirmLabel: tg('dlgDelete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await remove('goals', goal.id); // onDataChange re-renders the screen.
      close();
      showToast(t('goalDeleted'));
    } catch (err) {
      console.error(err);
      showError(t('saveFailed'));
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const metric = metricSel.value as GoalMetric;
    const period = (form.elements.namedItem('period') as HTMLSelectElement).value as GoalPeriod;
    const target = parseTarget(metric, targetEl.value);
    const chosen = [...form.querySelectorAll<HTMLInputElement>('input[name="types"]:checked')].map(
      (i) => i.value as ActivityType,
    );
    if (target === null) return showError(t('errorTarget'));
    if (!chosen.length) return showError(t('errorTypes'));
    const next: Goal = {
      id: goal?.id ?? newId(),
      period,
      metric,
      target,
      activityTypes: chosen,
      createdAt: goal?.createdAt ?? Date.now(),
    };
    try {
      await put('goals', next);
      close();
      showToast(t('goalSaved'));
    } catch (err) {
      console.error(err);
      showError(t('saveFailed'));
    }
  });

  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  targetEl.focus();
}

