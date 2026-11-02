/**
 * TCX activity files (Garmin Training Center XML, also exported by Strava).
 * Namespace-agnostic like the GPX parser: elements are matched by local name,
 * so any prefix works (ns3:TPX, ax:RunCadence…). Same output as
 * `parseActivityGpx`.
 */
import { GpxError } from '../gpx/parse';
import type { ParsedActivity } from './parse-activity';
import type { ActivityType, TrackPoint } from './types';

/** First direct child with the given local name. */
function child(el: Element, name: string): Element | undefined {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return undefined;
}

/** Text of the element reached by following `path` through direct children. */
function textAt(el: Element, ...path: string[]): string | undefined {
  let cur: Element | undefined = el;
  for (const name of path) {
    cur = child(cur, name);
    if (!cur) return undefined;
  }
  return cur.textContent?.trim();
}

/** Text of the first descendant with the given local name. */
function deepText(el: Element, name: string): string | undefined {
  return el.getElementsByTagNameNS('*', name)[0]?.textContent?.trim();
}

const num = (s: string | undefined) => {
  if (s === undefined || s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

/** TCX Sport attribute: Running, Biking or Other (some tools write other words). */
function activityType(raw: string | null): ActivityType {
  const v = (raw ?? '').toLowerCase();
  if (!v || v.includes('run')) return v.includes('trail') ? 'trail-run' : 'run';
  if (v.includes('walk') || v.includes('hik')) return 'walk';
  return 'other';
}

/** Parses a TCX activity. Throws GpxError('invalid') for non-TCX text, GpxError('empty') without GPS points. */
export function parseActivityTcx(text: string): ParsedActivity {
  // Strava's TCX exports can start with whitespace before the XML declaration, which XML forbids.
  const doc = new DOMParser().parseFromString(text.replace(/^[\s﻿]+/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'TrainingCenterDatabase') {
    throw new GpxError('invalid');
  }

  const activity = doc.getElementsByTagNameNS('*', 'Activity')[0];
  const type = activityType(activity?.getAttribute('Sport') ?? null);
  const onFoot = type !== 'other';

  const points: TrackPoint[] = [];
  for (const el of Array.from(doc.getElementsByTagNameNS('*', 'Trackpoint'))) {
    const lat = num(textAt(el, 'Position', 'LatitudeDegrees'));
    const lon = num(textAt(el, 'Position', 'LongitudeDegrees'));
    if (lat === undefined || lon === undefined) continue;
    const p: TrackPoint = { lat, lon };

    const ele = num(textAt(el, 'AltitudeMeters'));
    if (ele !== undefined) p.ele = ele;
    const time = Date.parse(textAt(el, 'Time') ?? '');
    if (Number.isFinite(time)) p.time = time;
    const hr = num(textAt(el, 'HeartRateBpm', 'Value'));
    if (hr !== undefined && hr > 0) p.hr = hr;

    const ext = child(el, 'Extensions');
    // RunCadence (TPX extension) is per leg; plain Cadence is per leg for runs and rpm for rides.
    const cad = num(ext && deepText(ext, 'RunCadence')) ?? num(textAt(el, 'Cadence'));
    if (cad !== undefined && cad > 0) p.cad = onFoot && cad < 130 ? cad * 2 : cad;
    const power = num(ext && deepText(ext, 'Watts'));
    if (power !== undefined && power >= 0) p.power = power;
    points.push(p);
  }
  if (points.length < 2) throw new GpxError('empty');

  return { name: undefined, type, points };
}
