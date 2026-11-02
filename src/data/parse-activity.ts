import { GpxError } from '../gpx/parse';
import type { ActivityType, TrackPoint } from './types';

export interface ParsedActivity {
  name?: string;
  type: ActivityType;
  points: TrackPoint[];
}

/** Text of the first descendant whose local name is one of `names` (namespace-agnostic). */
function findText(el: Element, names: string[]): string | undefined {
  const stack = Array.from(el.children);
  while (stack.length) {
    const node = stack.shift()!;
    if (names.includes(node.localName.toLowerCase())) return node.textContent?.trim();
    stack.push(...Array.from(node.children));
  }
  return undefined;
}

const num = (s: string | undefined) => {
  if (s === undefined || s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

function activityType(raw: string | undefined): ActivityType {
  const v = (raw ?? '').toLowerCase();
  if (!v || v === '9' || v.includes('run')) return v.includes('trail') ? 'trail-run' : 'run';
  if (v.includes('walk') || v.includes('hik') || v === '10') return 'walk';
  return 'other';
}

/**
 * Reads a GPX activity (Strava, Garmin, Coros, Polar…) with all the data it
 * can find: time, elevation, heart rate, cadence, temperature and power.
 * Extension tags are matched by local name, so any namespace prefix works
 * (gpxtpx:hr, ns3:hr, hr…).
 */
export function parseActivityGpx(text: string): ParsedActivity {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') {
    throw new GpxError('invalid');
  }

  let nodes = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
  if (!nodes.length) nodes = Array.from(doc.getElementsByTagNameNS('*', 'rtept'));

  const points: TrackPoint[] = [];
  for (const el of nodes) {
    const lat = num(el.getAttribute('lat') ?? undefined);
    const lon = num(el.getAttribute('lon') ?? undefined);
    if (lat === undefined || lon === undefined) continue;
    const p: TrackPoint = { lat, lon };

    const ele = num(findText(el, ['ele']));
    if (ele !== undefined) p.ele = ele;
    const time = Date.parse(findText(el, ['time']) ?? '');
    if (Number.isFinite(time)) p.time = time;

    const ext = Array.from(el.children).find((c) => c.localName === 'extensions');
    if (ext) {
      const hr = num(findText(ext, ['hr', 'heartrate']));
      if (hr !== undefined && hr > 0) p.hr = hr;
      const cad = num(findText(ext, ['cad', 'cadence', 'runcadence']));
      // Files store strides per minute (one foot); report steps per minute.
      if (cad !== undefined && cad > 0) p.cad = cad < 130 ? cad * 2 : cad;
      const temp = num(findText(ext, ['atemp', 'temp', 'temperature']));
      if (temp !== undefined) p.temp = temp;
      const power = num(findText(ext, ['power', 'watts']));
      if (power !== undefined && power >= 0) p.power = power;
    }
    points.push(p);
  }
  if (points.length < 2) throw new GpxError('empty');

  const trk = doc.getElementsByTagNameNS('*', 'trk')[0];
  const nameEl = Array.from(doc.getElementsByTagNameNS('*', 'name')).find((el) =>
    ['metadata', 'trk', 'rte'].includes(el.parentElement?.localName ?? ''),
  );
  const typeEl = trk && Array.from(trk.children).find((c) => c.localName === 'type');

  return {
    name: nameEl?.textContent?.trim() || undefined,
    type: activityType(typeEl?.textContent?.trim()),
    points,
  };
}
