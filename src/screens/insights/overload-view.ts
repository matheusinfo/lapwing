/** Training load alerts section of the Insights screen. */
import type { Activity, AthleteSettings } from '../../data/types';
import { formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import type { Chart } from '../../ui/chart-theme';
import { dailyLoadChart } from './charts';
import { t, type InsightsKey } from './i18n';
import { MIN_HISTORY_DAYS, overloadReport, type OverloadAlert, type OverloadStats } from './overload';
import { alertParams, esc, fmtDay, pct, SEVERITY } from './view';
import { hrStarts } from '../../data/zones';

const ratio = (v: number) => formatNumber(v, 2, 2);
const load = (v: number) => formatNumber(v);
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${pct(Math.abs(v))}`;

/** The numbers listed under each alert. */
function facts(a: OverloadAlert): [InsightsKey, string][] {
  const d = a.data;
  switch (a.kind) {
    case 'acwrDistance':
    case 'detrainingDistance':
      return [['factRatio', ratio(d.ratio)], ['factLast7', formatDistance(d.acute)], ['factAvgWeek', formatDistance(d.chronic)]];
    case 'acwrLoad':
    case 'detrainingLoad':
      return [['factRatio', ratio(d.ratio)], ['factLast7', `${load(d.acute)} TRIMP`], ['factAvgWeek', `${load(d.chronic)} TRIMP`]];
    case 'weeklyJump':
      return [['factChange', signedPct(d.change)], ['factLast7', formatDistance(d.current)], ['factPrevWeeks', formatDistance(d.previous)]];
    case 'streak':
      return [['factStreak', String(d.days)], ['factRest14', String(d.restDays14)]];
    case 'fewRestDays':
      return [['factRest14', String(d.restDays14)], ['factRest7', String(d.restDays7)]];
    case 'hardSessions':
      return [['factHard', String(d.count)], ['factShare', pct(d.share)]];
    case 'backToBackHard':
      return [['factDays', `${fmtDay(d.firstDay)}, ${fmtDay(d.secondDay)}`]];
    case 'hardShare':
      return [['factShare', pct(d.share)], ['factHardTime', formatDuration(d.hardTime)], ['factTotalTime', formatDuration(d.totalTime)]];
  }
}

function alertHtml(a: OverloadAlert): string {
  const sev = SEVERITY[a.severity];
  const params = alertParams(a);
  return `
    <li class="ins-alert sev-${a.severity}" data-alert="${a.kind}">
      <div class="ins-alert-head">
        <span class="badge ${sev.badge}">${t(sev.label)}</span>
        <h3>${t(`${a.kind}Title` as InsightsKey, params)}</h3>
      </div>
      <p>${t(`${a.kind}Text` as InsightsKey, params)}</p>
      <dl class="ins-facts">${facts(a)
        .map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl>
      <p class="ins-tip">${t(`${a.kind}Tip` as InsightsKey, params)}</p>
    </li>`;
}

function statsHtml(s: OverloadStats): string {
  const tile = (label: InsightsKey, value: string) => `<div class="stat"><dt>${t(label)}</dt><dd>${value}</dd></div>`;
  return `<dl class="stat-grid ins-load-stats">
    ${tile('statLast7', formatDistance(s.acuteDistance))}
    ${tile('statAvgWeek', formatDistance(s.chronicDistance))}
    ${tile('statAcwr', s.acwrDistance !== undefined ? ratio(s.acwrDistance) : '—')}
    ${s.loadReliable ? tile('statAcwrLoad', s.acwrLoad !== undefined ? ratio(s.acwrLoad) : '—') : ''}
    ${tile('statStreak', String(s.streak))}
    ${tile('statRest14', String(s.restDays14))}
    ${tile('statHard7', String(s.hardSessions7))}
  </dl>`;
}

/** Renders the alerts section and returns the chart it created (if any). */
export function renderOverload(
  el: Element,
  activities: Activity[],
  settings: AthleteSettings,
  now: number,
): Chart | undefined {
  const report = overloadReport(activities, settings, now);
  const { stats, alerts, days } = report;
  if (!days.some((d) => d.sessions > 0)) {
    el.innerHTML = `<p class="muted">${t('noTraining')}</p>`;
    return undefined;
  }

  const medPace = stats.medianPace;
  const bpm = hrStarts(settings)[2];
  const rule = medPace !== undefined ? t('hardRule', { bpm, pace: formatPace(medPace) }) : t('hardRuleNoPace', { bpm });

  el.innerHTML = `
    ${
      alerts.length
        ? `<ul class="ins-alerts">${alerts.map(alertHtml).join('')}</ul>`
        : `<div class="ins-all-good" role="status"><span class="badge good">${t('allGood')}</span> <span>${t('allGoodText')}</span></div>`
    }
    ${stats.historyDays < MIN_HISTORY_DAYS ? `<p class="muted ins-small">${t('shortHistory', { n: stats.historyDays })}</p>` : ''}
    ${statsHtml(stats)}
    <h3 class="ins-chart-title">${stats.loadReliable ? t('chartTitle') : t('chartTitleDistance')}</h3>
    <div class="ins-chart"><canvas role="img" aria-label="${stats.loadReliable ? t('chartTitle') : t('chartTitleDistance')}"></canvas></div>
    <p class="muted ins-small">${rule}</p>`;

  return dailyLoadChart(el.querySelector('canvas')!, days, stats.loadReliable);
}
