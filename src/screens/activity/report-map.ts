import { createBaseMap, maplibregl, whenLoaded } from '../../map/base';
import type { Feature } from 'geojson';
import type { TrackPoint } from '../../data/types';
import { binOf, indexAt, quantileBreaks, type Sample, type Streams } from './calc';

export type ColorMode = 'pace' | 'hr';

/** Sequential single-hue ramps, light → dark (darker = faster / higher HR). */
export const RAMPS: Record<ColorMode, string[]> = {
  pace: ['#a5d8ff', '#74c0fc', '#339af0', '#1c7ed6', '#1864ab'],
  hr: ['#ffc9c9', '#ffa8a8', '#ff6b6b', '#f03e3e', '#c92a2a'],
};

const SOURCE = 'act-track';

export interface LegendInfo {
  colors: string[];
  /** Value at the low end and high end of the colour ramp. */
  from: number;
  to: number;
}

function markerEl(cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `act-marker ${cls}`;
  return el;
}

/**
 * Map of the run: the track coloured by pace or heart rate (in 5 equal-count
 * bins), start and finish markers, and a marker that follows chart hover.
 */
export function createReportMap(
  container: HTMLElement,
  streams: Streams,
  samples: Sample[],
  bounds: [[number, number], [number, number]],
) {
  const map = createBaseMap(container, {
    bounds,
    fitBoundsOptions: { padding: 32 },
    attributionControl: { compact: true },
  });
  const pts = streams.points;
  const ll = (p: TrackPoint): [number, number] => [p.lon, p.lat];

  new maplibregl.Marker({ element: markerEl('act-marker-start') }).setLngLat(ll(pts[0])).addTo(map);
  new maplibregl.Marker({ element: markerEl('act-marker-end') }).setLngLat(ll(pts[pts.length - 1])).addTo(map);
  const hoverEl = markerEl('act-marker-hover');
  const hover = new maplibregl.Marker({ element: hoverEl });
  let hoverShown = false;

  const ready = whenLoaded(map).then(() => {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'act-track-casing',
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#1f2328', 'line-width': 7, 'line-opacity': 0.35 },
    });
    map.addLayer({
      id: 'act-track-line',
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
    });
  });

  /** Colours the track; returns legend info, or null if the stream is missing. */
  function setMode(mode: ColorMode): LegendInfo | null {
    const values = samples.map((s) => s[mode]).filter((v): v is number => v !== undefined);
    const colors = RAMPS[mode];
    const breaks = quantileBreaks(values, colors.length);
    // Pace: smaller is faster, so it gets the darker colour.
    const colorFor = (v: number | undefined) => {
      if (v === undefined || !values.length) return colors[2];
      const bin = binOf(v, breaks);
      return mode === 'pace' ? colors[colors.length - 1 - bin] : colors[bin];
    };

    const features: Feature[] = [];
    for (let k = 0; k < samples.length; k++) {
      const a = samples[k].d;
      const b = k + 1 < samples.length ? samples[k + 1].d : streams.total;
      if (b <= a) continue;
      const i0 = indexAt(streams.dist, a);
      const i1 = Math.min(pts.length - 1, indexAt(streams.dist, b) + 1);
      const coords = pts.slice(i0, i1 + 1).map(ll);
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: { color: colorFor(samples[k][mode]) },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
    void ready.then(() =>
      map.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData({ type: 'FeatureCollection', features }),
    );
    if (!values.length) return null;
    const sorted = [...values].sort((x, y) => x - y);
    const lowEnd = sorted[Math.floor(sorted.length * 0.05)];
    const highEnd = sorted[Math.floor(sorted.length * 0.95)];
    return mode === 'pace'
      ? { colors, from: highEnd, to: lowEnd } // slow (light) → fast (dark)
      : { colors, from: lowEnd, to: highEnd };
  }

  function highlight(sample: Sample | null): void {
    if (!sample) {
      if (hoverShown) hover.remove();
      hoverShown = false;
      return;
    }
    hover.setLngLat([sample.lon, sample.lat]);
    if (!hoverShown) hover.addTo(map);
    hoverShown = true;
  }

  return { map, setMode, highlight, destroy: () => map.remove() };
}
