/**
 * Chart.js charts for the History screen. Colours were checked with the
 * dataviz palette validator (light surface; dark tokens in style.css): fitness/fatigue/form use
 * blue/red/purple, the pace trend blue dots with an orange trend line.
 */
import { Chart, chartColors } from '../../ui/chart-theme';
import { formatDate, formatDistance, formatDuration, formatNumber } from '../../format';
import { getLang } from '../../i18n';
import type { LoadDay, PacePoint, WeekBucket } from './aggregate';
import { t } from './i18n';

const DAY_MS = 86_400_000;

const shortDate = (ms: number) =>
  new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(ms);

/** Recessive axes: hairline grid on the value axis only, no axis border. */
const valueAxisGrid = { color: () => chartColors.grid, lineWidth: 1 };

export function weeklyVolumeChart(canvas: HTMLCanvasElement, buckets: WeekBucket[]): Chart {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets.map((b) => shortDate(b.weekStart)),
      datasets: [
        {
          label: t('totDistance'),
          data: buckets.map((b) => b.distance / 1000),
          backgroundColor: chartColors.accent,
          hoverBackgroundColor: chartColors.accentHover,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 24,
          categoryPercentage: 0.85,
          barPercentage: 0.9,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => t('weekOf', { date: formatDate(buckets[items[0].dataIndex].weekStart) }),
            label: (ctx) => {
              const b = buckets[ctx.dataIndex];
              const runs = b.runs === 1 ? t('weeklyTooltipRun') : t('weeklyTooltipRuns', { n: b.runs });
              return [formatDistance(b.distance), runs, formatDuration(b.movingTime)];
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: true,
          grid: valueAxisGrid,
          border: { display: false },
          ticks: { callback: (v) => `${formatNumber(Number(v))} km`, maxTicksLimit: 5 },
        },
      },
    },
  });
}

export function paceTrendChart(canvas: HTMLCanvasElement, points: PacePoint[], trend: number[]): Chart {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: t('paceRun'),
          data: points.map((p) => ({ x: p.time, y: p.pace })),
          showLine: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHitRadius: 12,
          pointBackgroundColor: chartColors.pace,
          pointBorderColor: chartColors.surface,
          pointBorderWidth: 2,
          borderColor: chartColors.pace,
          backgroundColor: chartColors.pace,
        },
        {
          label: t('paceTrend'),
          data: points.map((p, i) => ({ x: p.time, y: trend[i] })),
          borderColor: chartColors.accent,
          backgroundColor: chartColors.accent,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.3,
          borderCapStyle: 'round',
          borderJoinStyle: 'round',
        },
      ],
    },
    options: {
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            // Dots for the runs, a short line for the trend.
            generateLabels: (chart) =>
              Chart.defaults.plugins.legend.labels.generateLabels(chart).map((l, i) => ({
                ...l,
                pointStyle: i === 0 ? 'circle' : 'line',
                lineWidth: i === 0 ? 0 : 2,
              })),
          },
        },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => {
              const p = points[items[0].dataIndex];
              return `${p.name} · ${formatDate(p.time)}`;
            },
            label: (ctx) => {
              const p = points[ctx.dataIndex];
              return [`${t('paceRun')}: ${formatDuration(p.pace)} /km`, `${t('paceTrend')}: ${formatDuration(trend[ctx.dataIndex])} /km`];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          // Half a day of padding so the first and last dots aren't cut.
          min: points[0].time - DAY_MS / 2,
          max: points[points.length - 1].time + DAY_MS / 2,
          grid: { display: false },
          border: { display: false },
          ticks: { callback: (v) => shortDate(Number(v)), maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
          reverse: true, // Faster (smaller) pace at the top.
          grid: valueAxisGrid,
          border: { display: false },
          ticks: { callback: (v) => formatDuration(Number(v)), maxTicksLimit: 5 },
          grace: '5%',
        },
      },
    },
  });
}

export function fitnessChart(canvas: HTMLCanvasElement, days: LoadDay[]): Chart {
  const line = (label: string, color: string, values: number[]) => ({
    label,
    data: days.map((d, i) => ({ x: d.day, y: values[i] })),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderColor: chartColors.surface,
    pointHoverBorderWidth: 2,
    tension: 0.2,
    borderCapStyle: 'round' as const,
    borderJoinStyle: 'round' as const,
  });
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        line(t('fitness'), chartColors.pace, days.map((d) => d.fitness)),
        line(t('fatigue'), chartColors.hr, days.map((d) => d.fatigue)),
        line(t('form'), chartColors.cad, days.map((d) => d.form)),
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'line', pointStyleWidth: 18 } },
        tooltip: {
          callbacks: {
            title: (items) => formatDate(days[items[0].dataIndex].day),
            label: (ctx) => `${ctx.dataset.label}: ${formatNumber(Number(ctx.parsed.y), 0)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: days[0]?.day,
          max: days[days.length - 1]?.day,
          grid: { display: false },
          border: { display: false },
          ticks: { callback: (v) => shortDate(Number(v)), maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
          // The zero line is darker so negative form reads at a glance.
          grid: { color: (ctx) => (ctx.tick?.value === 0 ? chartColors.muted : chartColors.grid), lineWidth: 1 },
          border: { display: false },
          ticks: { maxTicksLimit: 6, callback: (v) => formatNumber(Number(v)) },
        },
      },
    },
  });
}
