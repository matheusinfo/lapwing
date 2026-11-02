import { createBaseMap, maplibregl } from '../../map/base';
import type { Segment } from './route/state';
import { cssVar } from '../../ui/theme';

const VIEW_KEY = 'lapwing:view';
const DEFAULT_VIEW = { center: [-51.9367, -23.4244] as [number, number], zoom: 14 };

const SOURCE_ID = 'route';
export const ROUTE_HIT_LAYER = 'route-hit';
export const ROUTE_COLOR = '#e8590c';
const PENDING_COLOR = '#7c8691';

function loadView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    if (Array.isArray(v?.center) && v.center.length === 2 && typeof v.zoom === 'number') return v;
  } catch {
    // Storage unavailable or corrupt: use the default view.
  }
  return DEFAULT_VIEW;
}

function saveView(map: maplibregl.Map): void {
  try {
    const c = map.getCenter();
    localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
  } catch {
    // Not important if this fails.
  }
}

/**
 * Creates the route editor's map. `ready` resolves once the style and route
 * layers are in place.
 */
export function createRouteMap(container: HTMLElement): { map: maplibregl.Map; ready: Promise<void> } {
  const view = loadView();
  const map = createBaseMap(container, {
    center: view.center,
    zoom: view.zoom,
    // Double-clicking would add two points *and* zoom, which is confusing.
    doubleClickZoom: false,
  });
  map.addControl(
    new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
    'top-right',
  );
  map.on('moveend', () => saveView(map));

  const ready = new Promise<void>((resolve) => {
    map.once('load', () => {
      addRouteLayers(map);
      resolve();
    });
  });
  return { map, ready };
}

function addRouteLayers(map: maplibregl.Map): void {
  map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': cssVar('--map-casing', '#ffffff'), 'line-width': 8, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'status'], 'ready'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ROUTE_COLOR, 'line-width': 4.5 },
  });
  // Waiting for the router (grey) or fell back to a straight line (orange).
  map.addLayer({
    id: 'route-dashed',
    type: 'line',
    source: SOURCE_ID,
    filter: ['!=', ['get', 'status'], 'ready'],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'status'], 'failed', ROUTE_COLOR, PENDING_COLOR],
      'line-width': 4,
      'line-dasharray': [1.2, 1.2],
    },
  });
  // Invisible, wide line that makes the route easy to click.
  map.addLayer({
    id: ROUTE_HIT_LAYER,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': 20, 'line-opacity': 0 },
  });
}

/** Draws the given segments on the map. */
export function setRouteData(map: maplibregl.Map, segments: Segment[]): void {
  const source = map.getSource<maplibregl.GeoJSONSource>(SOURCE_ID);
  source?.setData({
    type: 'FeatureCollection',
    features: segments.map((s, i) => ({
      type: 'Feature',
      properties: { status: s.status, index: i },
      geometry: { type: 'LineString', coordinates: s.coords.map((c) => [c[0], c[1]]) },
    })),
  });
}
