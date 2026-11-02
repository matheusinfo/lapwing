import { Chart, chartColors } from '../../ui/chart-theme';
import { formatNumber } from '../../format';
import { t } from './i18n';
import type { WeekVolume } from './progress';
import { shortDate } from './view';

/** Planned volume colour (blue); "run" uses the app accent. Checked with the dataviz palette validator. */
const PLANNED_COLOR = '#2a78d6';

/**
 * Grouped bars of planned vs run km per week. The current week's label is
 * bold; clicking a bar opens that week.
 */
export function weeklyChart(
  canvas: HTMLCanvasElement,
  weeks: WeekVolume[],
  currentWeek: string,
  onPickWeek: (start: string) => void,
): Chart {
  const current = weeks.findIndex((w) => w.start === currentWeek);
  const bar = { borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 24, categoryPercentage: 0.7, barPercentage: 0.9 };
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => shortDate(w.start)),
      datasets: [
        { label: t('chartPlanned'), data: weeks.map((w) => w.planned / 1000), backgroundColor: PLANNED_COLOR, ...bar },
        { label: t('chartDone'), data: weeks.map((w) => w.actual / 1000), backgroundColor: chartColors.accent, ...bar },
      ],
    },
    options: {
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: {
          callbacks: {
            title: (items) => `${t('colWeek')} ${items[0]?.label ?? ''}`,
            label: (item) => ` ${item.dataset.label}: ${formatNumber(item.parsed.y ?? 0, 1)} km`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: (ctx) => ({ weight: ctx.index === current ? 'bold' : 'normal' }) },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          ticks: { callback: (v) => `${formatNumber(Number(v))} km`, maxTicksLimit: 6 },
        },
      },
      onClick: (_e, elements) => {
        const i = elements[0]?.index;
        if (i !== undefined && weeks[i]) onPickWeek(weeks[i].start);
      },
      onHover: (e, elements) => {
        const target = e.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  });
}
