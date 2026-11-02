/**
 * Chart.js chart for the Insights screen: daily load (or distance) of the
 * last 28 days as bars, with the trailing 7- and 28-day averages as lines.
 */
import { Chart, chartColors } from '../../ui/chart-theme';
import { formatDate, formatNumber } from '../../format';
import { getLang } from '../../i18n';
import type { DaySummary } from './overload';
import { rollingMean } from './overload';
import { t } from './i18n';

const shortDate = (ms: number) => new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(ms);

/**
 * `days` should cover 56 days so the 28-day average is warmed up; only the
 * last 28 are drawn. `useLoad` picks TRIMP, otherwise kilometres.
 */
export function dailyLoadChart(canvas: HTMLCanvasElement, days: DaySummary[], useLoad: boolean): Chart {
  const values = days.map((d) => (useLoad ? d.load : d.distance / 1000));
  const avg7 = rollingMean(values, 7);
  const avg28 = rollingMean(values, 28);
  const from = Math.max(0, days.length - 28);
  const shown = days.slice(from);
  const unit = useLoad ? t('chartUnitLoad') : 'km';
  const fmt = (v: number) => `${formatNumber(v, useLoad ? 0 : 1)} ${unit}`;
  const line = (label: string, color: string, data: number[], dash?: number[]) => ({
    type: 'line' as const,
    label,
    data: data.slice(from),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: dash,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.25,
  });

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: shown.map((d) => shortDate(d.day)),
      datasets: [
        {
          type: 'bar' as const,
          label: t('chartDaily'),
          data: values.slice(from),
          backgroundColor: chartColors.accent,
          borderRadius: 3,
          maxBarThickness: 16,
          order: 2,
        },
        { ...line(t('chartAvg7'), chartColors.pace, avg7), order: 1 },
        { ...line(t('chartAvg28'), chartColors.ele, avg28, [5, 4]), order: 0 },
      ],
    },
    options: {
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => formatDate(shown[items[0].dataIndex].day),
            label: (ctx) => `${ctx.dataset.label}: ${fmt(Number(ctx.parsed.y))}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          grid: { color: () => chartColors.grid },
          border: { display: false },
          ticks: { maxTicksLimit: 5, callback: (v) => formatNumber(Number(v)) },
        },
      },
    },
  });
}
