import type { ChartConfiguration, Plugin } from 'chart.js';
import { Chart, chartColors } from '../../ui/chart-theme';
import { formatDistance } from '../../format';
import { withAlpha } from '../activity/charts';

/** Run colours: blue for A, orange for B (distinct, colour-blind friendly). */
export const runColors = {
  get a() { return chartColors.pace; },
  get b() { return chartColors.accent; },
};

export interface OverlaySeries {
  label: string;
  color: string;
  /** x in km. */
  data: { x: number; y: number | null }[];
  fill?: boolean;
}

export interface OverlayDef {
  title: string;
  series: OverlaySeries[];
  /** Smaller values higher up (pace: faster is up). */
  reverse?: boolean;
  /** Fit the axis to the 2nd–98th percentile so outliers don't flatten the lines. */
  clipOutliers?: boolean;
  /** Draw a line at y = 0 (time gap). */
  zeroLine?: boolean;
  /** Tooltip text for a value, with the series label. */
  format: (value: number, label: string) => string;
  tick: (value: number) => string;
}

const crosshair: Plugin<'line'> = {
  id: 'cmpCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements()[0];
    if (!active) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = chartColors.muted;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(active.element.x, chartArea.top);
    ctx.lineTo(active.element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function clippedRange(values: number[]): [number, number] | [undefined, undefined] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length <= 10) return [undefined, undefined];
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
  const pad = (hi - lo) * 0.1 || 10;
  return [Math.floor((lo - pad) / 30) * 30, Math.ceil((hi + pad) / 30) * 30];
}

/** Stacked overlay charts, all against the same distance axis. */
export function createOverlayCharts(container: HTMLElement, defs: OverlayDef[]): { destroy(): void } {
  const charts: Chart<'line'>[] = [];
  const maxX = Math.max(0, ...defs.flatMap((d) => d.series.map((s) => s.data[s.data.length - 1]?.x ?? 0)));

  defs.forEach((def, i) => {
    const wrap = document.createElement('figure');
    wrap.className = 'cmp-chart';
    const caption = document.createElement('figcaption');
    caption.className = 'cmp-chart-title';
    caption.textContent = def.title;
    const box = document.createElement('div');
    box.className = 'cmp-chart-canvas';
    const canvas = document.createElement('canvas');
    box.append(canvas);
    wrap.append(caption, box);
    container.append(wrap);

    const [yMin, yMax] = def.clipOutliers
      ? clippedRange(def.series.flatMap((s) => s.data.map((p) => p.y).filter((y): y is number => y !== null)))
      : [undefined, undefined];
    const isLast = i === defs.length - 1;

    const config: ChartConfiguration<'line', { x: number; y: number | null }[]> = {
      type: 'line',
      data: {
        datasets: def.series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: s.fill ? withAlpha(s.color, 0.15) : s.color,
          fill: s.fill ? (def.zeroLine ? 'origin' : 'start') : false,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: chartColors.surface,
          pointHoverBackgroundColor: s.color,
          spanGaps: true,
        })),
      },
      options: {
        parsing: false,
        normalized: true,
        layout: { padding: { right: 6 } },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: maxX || undefined,
            grid: { display: false },
            ticks: { display: isLast, maxTicksLimit: 12, callback: (v) => `${Number(v).toFixed(0)}` },
          },
          y: {
            reverse: def.reverse,
            grace: '5%',
            min: yMin,
            max: yMax,
            grid: {
              color: (ctx) => (def.zeroLine && ctx.tick?.value === 0 ? chartColors.muted : chartColors.grid),
            },
            border: { display: false },
            ticks: { maxTicksLimit: 5, callback: (v) => def.tick(Number(v)) },
            afterFit: (scale) => {
              scale.width = 56; // Same width on every chart so the x positions line up.
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => formatDistance((items[0]?.parsed.x ?? 0) * 1000),
              label: (item) => def.format(item.parsed.y ?? 0, item.dataset.label ?? ''),
            },
          },
        },
      },
      plugins: [crosshair],
    };
    charts.push(new Chart(canvas, config));
  });

  return { destroy: () => charts.forEach((c) => c.destroy()) };
}
