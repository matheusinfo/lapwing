import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { getTheme } from '../ui/theme';

// MapLibre finds its worker relative to its own file, which breaks once Vite
// bundles it, so point it at the worker explicitly.
maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };

/** Free OpenStreetMap-based styles, no API key needed. */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** The map style for the current theme (maps are rebuilt when the theme changes). */
export const mapStyleUrl = () => (getTheme() === 'dark' ? DARK_STYLE_URL : STYLE_URL);

/**
 * Creates a MapLibre map with the app's style and the usual controls
 * (zoom buttons and a metric scale). Remember to call `map.remove()` when the
 * screen unmounts.
 */
export function createBaseMap(
  container: HTMLElement | string,
  options: Partial<maplibregl.MapOptions> = {},
): maplibregl.Map {
  const map = new maplibregl.Map({ container, style: mapStyleUrl(), ...options });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('error', (e) => console.error('Map error:', e.error));
  return map;
}

/** Resolves when the map's style has loaded (immediately if it already has). */
export function whenLoaded(map: maplibregl.Map): Promise<void> {
  return map.loaded() ? Promise.resolve() : new Promise((resolve) => map.once('load', () => resolve()));
}
