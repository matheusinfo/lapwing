/** Small formatting helpers shared by the Insights views. */
import { formatDate, formatDistance, formatNumber } from '../../format';
import type { Activity } from '../../data/types';
import type { GoalMetric } from './goals';
import { t } from './i18n';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Seconds → "4 h 05 min" (or "45 min" under an hour). */
export function formatHours(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t('hoursMinutes', { h, m: String(m).padStart(2, '0') }) : `${m} min`;
}

export const formatRuns = (n: number) => (n === 1 ? t('runCountOne') : t('runCount', { n: formatNumber(n, 1) }));

/** A goal metric value in its natural unit. */
export function formatMetric(metric: GoalMetric, value: number): string {
  switch (metric) {
    case 'distance':
      return formatDistance(value);
    case 'time':
      return formatHours(value);
    case 'runs':
      return formatRuns(value);
  }
}

/** Link to a run, with its name escaped. */
export const runLink = (a: Activity) =>
  `<a href="#/activity/${encodeURIComponent(a.id)}">${esc(a.name)}</a>`;

export const runLinkWithDate = (a: Activity) => `${runLink(a)} <span class="muted">· ${formatDate(a.startTime)}</span>`;

/** Distance with fewer decimals for round numbers (5 km, 21.1 km). */
export function shortDistance(m: number): string {
  const km = m / 1000;
  const digits = Math.abs(km - Math.round(km)) < 0.005 ? 0 : km < 10 ? 2 : 1;
  return `${formatNumber(km, digits, digits)} km`;
}

export const pct = (ratio: number, digits = 0) => `${formatNumber(ratio * 100, digits)}%`;
