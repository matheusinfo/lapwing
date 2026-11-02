import { createBaseMap, whenLoaded } from '../../map/base';
import type { TrackPoint } from '../../data/types';
import { cssVar } from '../../ui/theme';

type Bounds = [[number, number], [number, number]];

/** Union of two bounding boxes. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ];
}

export interface MapTrack {
  points: TrackPoint[];
  color: string;
  bounds: Bounds;
}

/** Map with both tracks overlaid (A drawn under B). Returns null if the map can't be created. */
export function createCompareMap(container: HTMLElement, a: MapTrack, b: MapTrack): { destroy(): void } | null {
  let map: ReturnType<typeof createBaseMap>;
  try {
    map = createBaseMap(container, {
      bounds: unionBounds(a.bounds, b.bounds),
      fitBoundsOptions: { padding: 32 },
      attributionControl: { compact: true },
    });
  } catch (err) {
    console.error('Map unavailable:', err);
    return null;
  }
  let removed = false;
  void whenLoaded(map).then(() => {
    if (removed) return;
    (
      [
        ['a', a],
        ['b', b],
      ] as const
    ).forEach(([id, track]) => {
      map.addSource(`cmp-${id}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: track.points.map((p) => [p.lon, p.lat]) },
        },
      });
      map.addLayer({
        id: `cmp-${id}-casing`,
        type: 'line',
        source: `cmp-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': cssVar('--map-casing', '#ffffff'), 'line-width': 7, 'line-opacity': 0.8 },
      });
      map.addLayer({
        id: `cmp-${id}-line`,
        type: 'line',
        source: `cmp-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': track.color, 'line-width': 4, 'line-opacity': 0.9 },
      });
    });
  });
  return {
    destroy: () => {
      removed = true;
      map.remove();
    },
  };
}
