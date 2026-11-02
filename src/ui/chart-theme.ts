/**
 * Shared Chart.js setup so every screen's charts look the same.
 * Import { Chart } from here (not from 'chart.js' directly): this file
 * registers all chart types once and applies the app's fonts and colours.
 */
import { Chart, registerables } from 'chart.js';
import { cssVar, onThemeChange } from './theme';

Chart.register(...registerables);

const css = cssVar;

/** Series colours, read from the CSS tokens in src/style.css (so they follow the theme). */
export const chartColors = {
  get accent() { return css('--accent', '#e8590c'); },
  get pace() { return css('--chart-pace', '#1c7ed6'); },
  get hr() { return css('--chart-hr', '#e03131'); },
  get ele() { return css('--chart-ele', '#7c8691'); },
  get cad() { return css('--chart-cad', '#7048e8'); },
  get power() { return css('--chart-power', '#f08c00'); },
  get grid() { return css('--chart-grid', '#e9ecef'); },
  get muted() { return css('--muted', '#5f6b76'); },
  get accentHover() { return css('--accent-hover', '#c94c08'); },
  /** Page panel colour, e.g. for point borders that must stand out from lines. */
  get surface() { return css('--surface', '#ffffff'); },
  /** Heart-rate zones 1–5, cool to hot. */
  zones: ['#74c0fc', '#69db7c', '#ffd43b', '#ffa94d', '#ff6b6b'],
};

Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
Chart.defaults.font.size = 12;
function applyThemeDefaults(): void {
  Chart.defaults.color = chartColors.muted;
  Chart.defaults.borderColor = chartColors.grid;
}
applyThemeDefaults();
// Runs before the screen remounts after a theme change (main.ts awaits the
// screen module first), so new charts get the new colours.
onThemeChange(applyThemeDefaults);
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation = false;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.tooltip.intersect = false;
Chart.defaults.interaction.mode = 'index';
Chart.defaults.interaction.intersect = false;

export { Chart };
