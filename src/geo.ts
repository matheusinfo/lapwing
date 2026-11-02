import type { Coord, LngLat } from './types';

const EARTH_RADIUS_M = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversine(a: Coord | LngLat, b: Coord | LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a track, in metres. */
export function trackDistance(coords: Coord[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

export interface ElevationStats {
  gain: number;
  loss: number;
  hasElevation: boolean;
}

/**
 * Elevation gain and loss in metres. Changes smaller than `threshold` are
 * ignored, which filters out noise from GPS and elevation models.
 */
export function elevationGainLoss(coords: Coord[], threshold = 2): ElevationStats {
  let gain = 0;
  let loss = 0;
  let ref: number | undefined;
  for (const c of coords) {
    const ele = c[2];
    if (ele === undefined) continue;
    if (ref === undefined) {
      ref = ele;
      continue;
    }
    const diff = ele - ref;
    if (diff >= threshold) {
      gain += diff;
      ref = ele;
    } else if (diff <= -threshold) {
      loss -= diff;
      ref = ele;
    }
  }
  return { gain, loss, hasElevation: ref !== undefined };
}

/** Bounding box as [[west, south], [east, north]], or null for an empty track. */
export function bounds(coords: Coord[]): [LngLat, LngLat] | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [[w, s], [e, n]];
}

export interface NearestHit {
  /** Index of the segment that holds the nearest point. */
  segIndex: number;
  /** The nearest point lies between coords[edgeIndex] and coords[edgeIndex + 1]. */
  edgeIndex: number;
  /** The nearest point on the line, with elevation interpolated when known. */
  point: Coord;
  /** Distance from the query point, in metres (approximate). */
  distance: number;
}

/** Finds the point on any segment's line that is closest to `p`. */
export function nearestOnSegments(segments: { coords: Coord[] }[], p: LngLat): NearestHit | null {
  // Flat projection around p: accurate enough at the scale of a click.
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  let best: NearestHit | null = null;

  for (let si = 0; si < segments.length; si++) {
    const coords = segments[si].coords;
    for (let k = 0; k < coords.length - 1; k++) {
      const a = coords[k];
      const b = coords[k + 1];
      const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
      const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const distance = Math.hypot(ax + t * dx, ay + t * dy);
      if (best && distance >= best.distance) continue;

      const point: Coord = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const ea = a[2], eb = b[2];
      if (ea !== undefined && eb !== undefined) point[2] = ea + t * (eb - ea);
      best = { segIndex: si, edgeIndex: k, point, distance };
    }
  }
  return best;
}
