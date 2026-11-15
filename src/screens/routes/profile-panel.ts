import type { ChartConfiguration, Plugin, ScriptableContext } from 'chart.js';
import { Chart, chartColors } from '../../ui/chart-theme';
import { maplibregl } from '../../map/base';
import { elevationGainLoss } from '../../geo';
import { formatDistance, formatNumber } from '../../format';
import { onLangChange, t } from '../../i18n';
import { withAlpha } from '../activity/charts';
import { buildProfile, type ElevationProfile } from './profile';
import type { Coord } from '../../types';

const OPEN_KEY = 'lapwing:route-profile';
/** Flat routes still get this much height on the axis (metres), so noise doesn't look like hills. */
const MIN_AXIS_SPAN = 20;

type XY = { x: number; y: number };

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    // Not important if this fails.
  }
}

/** Suggested y range: the profile with some room above and below. */
function yRange(profile: ElevationProfile): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of profile.points) {
    if (p.ele < lo) lo = p.ele;
    if (p.ele > hi) hi = p.ele;
  }
  const span = Math.max(hi - lo, MIN_AXIS_SPAN);
  const mid = (lo + hi) / 2;
  return [mid - span * 0.6, mid + span * 0.6];
}

/** Draws a vertical line at the hovered point. */
const crosshair: Plugin<'line'> = {
  id: 'rmProfileCrosshair',
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

export interface ProfilePanel {
  /** Shows the profile of `track`, or hides the panel when it has no elevation. */
  update(track: Coord[]): void;
  destroy(): void;
}

/**
 * The elevation profile docked at the bottom of the route editor: a summary
 * (distance, gain, loss, lowest and highest point) and an area chart of
 * elevation against distance. Hovering or touching the chart shows the spot
 * on the map. Expects the `.rm-profile` markup and the `#btn-profile`
 * toolbar button in `root`.
 */
export function createProfilePanel(root: HTMLElement, map: maplibregl.Map): ProfilePanel {
  const panel = root.querySelector<HTMLElement>('.rm-profile')!;
  const canvas = panel.querySelector('canvas')!;
  const toggle = root.querySelector<HTMLButtonElement>('#btn-profile')!;
  const hideButton = panel.querySelector<HTMLButtonElement>('.rm-profile-hide')!;
  const field = (id: string) => panel.querySelector<HTMLElement>(`#${id}`)!;

  let wantOpen = loadOpen();
  let shown = false;
  let profile: ElevationProfile | null = null;
  let gain = 0;
  let loss = 0;
  let chart: Chart<'line', XY[]> | null = null;
  let chartStale = false;

  // ---- Marker on the map that follows the chart ----
  const dotEl = document.createElement('div');
  dotEl.className = 'rm-profile-dot';
  const dot = new maplibregl.Marker({ element: dotEl });
  let dotIndex: number | null = null;

  function showDot(index: number | null): void {
    const point = index === null ? undefined : profile?.points[index];
    if (!point) {
      if (dotIndex !== null) dot.remove();
      dotIndex = null;
      return;
    }
    if (index === dotIndex) return;
    dot.setLngLat([point.lng, point.lat]);
    if (dotIndex === null) dot.addTo(map);
    dotIndex = index;
  }

  const follow: Plugin<'line'> = {
    id: 'rmProfileFollow',
    afterEvent(c, args) {
      // Touch: show the spot while the finger is down, like a scrubber.
      const type = args.event.native?.type;
      if (type === 'touchend' || type === 'touchcancel') {
        c.setActiveElements([]);
        c.tooltip?.setActiveElements([], { x: 0, y: 0 });
        args.changed = true;
      }
      showDot(c.getActiveElements()[0]?.index ?? null);
    },
  };

  // ---- Chart ----

  function chartData(p: ElevationProfile): XY[] {
    return p.points.map((pt) => ({ x: pt.d / 1000, y: pt.ele }));
  }

  function createChart(p: ElevationProfile): Chart<'line', XY[]> {
    const color = chartColors.accent;
    const [yMin, yMax] = yRange(p);
    const config: ChartConfiguration<'line', XY[]> = {
      type: 'line',
      data: {
        datasets: [
          {
            data: chartData(p),
            borderColor: color,
            borderWidth: 2,
            fill: 'start',
            // Fades towards the bottom.
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
              const area = ctx.chart.chartArea;
              if (!area) return withAlpha(color, 0.2);
              const gradient = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              gradient.addColorStop(0, withAlpha(color, 0.4));
              gradient.addColorStop(1, withAlpha(color, 0.05));
              return gradient;
            },
            // Set explicitly so points don't fall back to the gradient above.
            pointBackgroundColor: color,
            pointBorderColor: color,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: chartColors.surface,
            pointHoverBackgroundColor: color,
          },
        ],
      },
      options: {
        parsing: false,
        normalized: true,
        events: ['mousemove', 'mouseout', 'touchstart', 'touchmove', 'touchend', 'touchcancel'],
        layout: { padding: { top: 4, right: 4 } },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: p.distance / 1000,
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkipPadding: 16,
              callback: (v) => `${formatNumber(Number(v), 1)} km`,
            },
          },
          y: {
            suggestedMin: yMin,
            suggestedMax: yMax,
            grid: { color: chartColors.grid },
            border: { display: false },
            ticks: { maxTicksLimit: 5, callback: (v) => `${formatNumber(Number(v))} m` },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => formatDistance((items[0]?.parsed.x ?? 0) * 1000),
              label: (item) => {
                const grade = Math.round((profile?.points[item.dataIndex]?.grade ?? 0) * 10) / 10 || 0;
                return [
                  `${t('elevation')}: ${formatNumber(Math.round(item.parsed.y ?? 0))} m`,
                  `${t('profileGrade')}: ${formatNumber(grade, 1)} %`,
                ];
              },
            },
          },
        },
      },
      plugins: [crosshair, follow],
    };
    return new Chart(canvas, config);
  }

  function refreshChart(p: ElevationProfile): void {
    if (!chart) {
      chart = createChart(p);
      chartStale = false;
      return;
    }
    if (!chartStale) return;
    chartStale = false;
    const [yMin, yMax] = yRange(p);
    chart.data.datasets[0].data = chartData(p);
    const scales = chart.options.scales as {
      x: { max?: number };
      y: { suggestedMin?: number; suggestedMax?: number };
    };
    scales.x.max = p.distance / 1000;
    scales.y.suggestedMin = yMin;
    scales.y.suggestedMax = yMax;
    // The old hover position may not exist any more.
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    showDot(null);
    chart.update('none');
  }

  // ---- Panel ----

  function renderSummary(p: ElevationProfile): void {
    field('profile-distance').textContent = formatDistance(p.distance);
    // Same rounding as the side panel, which shows the same numbers.
    field('profile-gain').textContent = `${Math.round(gain)} m`;
    field('profile-loss').textContent = `${Math.round(loss)} m`;
    field('profile-range').textContent = `${Math.round(p.min)}–${Math.round(p.max)} m`;
  }

  function render(): void {
    const open = profile !== null && wantOpen;
    toggle.disabled = profile === null;
    toggle.setAttribute('aria-pressed', String(open));
    if (open !== shown) {
      shown = open;
      panel.hidden = !open;
      root.classList.toggle('rm-profile-open', open);
      // The map shrinks or grows; resize now so a fitBounds right after uses the new size.
      map.resize();
    }
    if (!open || !profile) {
      showDot(null);
      return;
    }
    renderSummary(profile);
    refreshChart(profile);
  }

  function setOpen(open: boolean): void {
    wantOpen = open;
    saveOpen(open);
    render();
  }

  toggle.addEventListener('click', () => setOpen(!wantOpen));
  hideButton.addEventListener('click', () => {
    setOpen(false);
    toggle.focus(); // The hide button just disappeared.
  });

  const label = () => panel.setAttribute('aria-label', t('profileToggle'));
  label();
  const offLang = onLangChange(() => {
    label();
    if (!shown || !profile) {
      chartStale = true; // Redraw the axes' number formats when it shows again.
      return;
    }
    renderSummary(profile);
    chart?.update('none'); // Number formats on the axes.
  });

  render();

  return {
    update(track) {
      profile = buildProfile(track);
      const stats = elevationGainLoss(track);
      gain = stats.gain;
      loss = stats.loss;
      chartStale = true;
      render();
    },
    destroy() {
      offLang();
      chart?.destroy();
      dot.remove();
      root.classList.remove('rm-profile-open');
    },
  };
}
