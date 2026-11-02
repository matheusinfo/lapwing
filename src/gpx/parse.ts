import type { Coord } from '../types';

export interface ParsedGpx {
  name?: string;
  coords: Coord[];
}

export class GpxError extends Error {
  constructor(public readonly code: 'invalid' | 'empty') {
    super(code === 'invalid' ? 'Not a GPX file' : 'No track or route points');
  }
}

const childText = (el: Element, name: string) =>
  Array.from(el.children).find((c) => c.localName === name)?.textContent?.trim();

/**
 * Reads the points of a GPX file. Track points (`trkpt`) are used when
 * present, otherwise route points (`rtept`). Several tracks or segments are
 * joined into one line, in file order.
 */
export function parseGpx(text: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') {
    throw new GpxError('invalid');
  }

  let points = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
  if (!points.length) points = Array.from(doc.getElementsByTagNameNS('*', 'rtept'));

  const coords: Coord[] = [];
  for (const pt of points) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = parseFloat(childText(pt, 'ele') ?? '');
    coords.push(Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat]);
  }
  if (coords.length < 2) throw new GpxError('empty');

  const nameEl = Array.from(doc.getElementsByTagNameNS('*', 'name')).find((el) =>
    ['metadata', 'trk', 'rte'].includes(el.parentElement?.localName ?? ''),
  );
  const name = nameEl?.textContent?.trim() || undefined;

  return { name, coords };
}
