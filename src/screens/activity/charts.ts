import type { ChartConfiguration, Plugin } from 'chart.js';
import { Chart, chartColors } from '../../ui/chart-theme';
import { formatDistance } from '../../format';
import type { Sample } from './calc';

/** '#rrggbb' + alpha → 'rgba(…)' (canvas can't use color-mix). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export type StreamKey = 'pace' | 'hr' | 'ele' | 'cad' | 'power';

export interface StreamDef {
  key: StreamKey;
  title: string;
  color: string;
  /** Show smaller values higher up (pace: faster is up). */
  reverse?: boolean;
  /** Shade the area under the line (elevation). */
  fill?: boolean;
  /** Fit the axis to the 2nd–98th percentile so a few outliers don't flatten the line. */
  clipOutliers?: boolean;
  format: (value: number) => string;
  tick: (value: number) => string;
}

/** Draws a vertical line at the active point. */
const crosshair: Plugin<'line'> = {
  id: 'actCrosshair',
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

/**
 * One small chart per stream, stacked, all against distance and sharing the
 * hover position: hovering one chart highlights the same point on the
 * others and calls `onHover` with the sample index (null on leave).
 * Each chart has a single y axis (no dual axes).
 */
export function createStreamCharts(
  container: HTMLElement,
  samples: Sample[],
  defs: StreamDef[],
  onHover: (index: number | null) => void,
): { destroy(): void; highlight(index: number | null): void } {
  const charts: Chart<'line'>[] = [];
  let syncing = false;

  const highlight = (index: number | null, except?: Chart) => {
    syncing = true;
    for (const c of charts) {
      if (c === except) continue;
      const y = index === null ? null : (c.data.datasets[0].data[index] as { y: number | null } | undefined)?.y;
      if (index === null || y === null || y === undefined) {
        c.setActiveElements([]);
        c.tooltip?.setActiveElements([], { x: 0, y: 0 });
      } else {
        const els = [{ datasetIndex: 0, index }];
        c.setActiveElements(els);
        const meta = c.getDatasetMeta(0).data[index];
        c.tooltip?.setActiveElements(els, { x: meta?.x ?? 0, y: meta?.y ?? 0 });
      }
      c.update('none');
    }
    syncing = false;
  };

  const sync: Plugin<'line'> = {
    id: 'actSync',
    afterEvent(chart, args) {
      if (syncing) return;
      const type = args.event.type;
      if (type === 'mouseout') {
        highlight(null, chart);
        onHover(null);
        return;
      }
      if (type !== 'mousemove') return;
      const active = chart.getActiveElements()[0];
      const index = active ? active.index : null;
      highlight(index, chart);
      onHover(index);
    },
  };

  defs.forEach((def, i) => {
    const wrap = document.createElement('figure');
    wrap.className = 'act-chart';
    wrap.innerHTML = `<figcaption class="act-chart-title"><span class="act-swatch" style="background:${def.color}"></span>${def.title}</figcaption><div class="act-chart-canvas"><canvas></canvas></div>`;
    container.append(wrap);
    const canvas = wrap.querySelector('canvas')!;
    const isLast = i === defs.length - 1;
    let yMin: number | undefined, yMax: number | undefined;
    if (def.clipOutliers) {
      const vals = samples.map((s) => s[def.key]).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
      if (vals.length > 10) {
        const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)];
        const pad = (hi - lo) * 0.1 || 10;
        // Round to 30 units (30 s for pace) so the end ticks are tidy.
        yMin = Math.floor((lo - pad) / 30) * 30;
        yMax = Math.ceil((hi + pad) / 30) * 30;
      }
    }

    const config: ChartConfiguration<'line', { x: number; y: number | null }[]> = {
      type: 'line',
      data: {
        datasets: [
          {
            label: def.title,
            data: samples.map((s) => ({ x: s.d / 1000, y: s[def.key] ?? null })),
            borderColor: def.color,
            backgroundColor: def.fill ? withAlpha(def.color, 0.18) : def.color,
            fill: def.fill ? 'start' : false,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: chartColors.surface,
            pointHoverBackgroundColor: def.color,
            spanGaps: true,
          },
        ],
      },
      options: {
        parsing: false,
        normalized: true,
        layout: { padding: { right: 6 } },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: samples.length ? samples[samples.length - 1].d / 1000 : undefined,
            grid: { display: false },
            ticks: { display: isLast, maxTicksLimit: 12, callback: (v) => `${Number(v).toFixed(0)}` },
            title: { display: false },
          },
          y: {
            reverse: def.reverse,
            grace: '5%',
            min: yMin,
            max: yMax,
            grid: { color: chartColors.grid },
            border: { display: false },
            ticks: { maxTicksLimit: 4, callback: (v) => def.tick(Number(v)) },
            afterFit: (scale) => {
              scale.width = 52; // Same width on every chart so the x positions line up.
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => formatDistance((items[0]?.parsed.x ?? 0) * 1000),
              label: (item) => `${def.title}: ${def.format(item.parsed.y ?? 0)}`,
            },
          },
        },
      },
      plugins: [crosshair, sync],
    };
    charts.push(new Chart(canvas, config));
  });

  return {
    destroy: () => charts.forEach((c) => c.destroy()),
    highlight: (index) => highlight(index),
  };
}

/** Horizontal bars for time in each heart-rate zone. */
export function createZonesChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  seconds: number[],
  format: (seconds: number, share: number) => string,
): Chart<'bar'> {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: seconds.map((s) => s / 60),
          backgroundColor: chartColors.zones,
          borderRadius: 4,
          borderSkipped: 'start',
          barPercentage: 0.8,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: {
          grid: { color: chartColors.grid },
          border: { display: false },
          ticks: { callback: (v) => `${v} min` },
        },
        y: { grid: { display: false }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (item) => format(seconds[item.dataIndex], seconds[item.dataIndex] / total),
          },
        },
      },
    },
  });
}
