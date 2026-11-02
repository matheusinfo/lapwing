/**
 * FIT activity files (Garmin, Coros, Wahoo, Strava exports…), decoded without
 * a dependency, following the Garmin FIT SDK: file header, normal and
 * compressed-timestamp record headers, definition messages (either byte
 * order, developer fields) and data messages. Only `record`, `session` and
 * `sport` messages are read; everything else is skipped by size.
 * Same output as `parseActivityGpx`.
 */
import { GpxError } from '../gpx/parse';
import type { ParsedActivity } from './parse-activity';
import type { ActivityType, TrackPoint } from './types';

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

const MSG_SPORT = 12;
const MSG_SESSION = 18;
const MSG_RECORD = 20;
const FIELD_TIMESTAMP = 253;

/** Fields read per global message number (the timestamp is read from every message). */
const WANTED: Record<number, number[]> = {
  // position_lat, position_long, altitude, heart_rate, cadence, power, temperature, fractional_cadence, enhanced_altitude
  [MSG_RECORD]: [0, 1, 2, 3, 4, 7, 13, 53, 78],
  [MSG_SESSION]: [5, 6], // sport, sub_sport
  [MSG_SPORT]: [0, 1, 3], // sport, sub_sport, name
};

/** Size in bytes per base type number (low 5 bits of the base type byte). */
const BASE_SIZE = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];
const BASE_STRING = 7;

interface FieldReader {
  num: number;
  offset: number;
  size: number;
  base: number;
}

interface Definition {
  global: number;
  little: boolean;
  /** Bytes of a data message, developer fields included. */
  size: number;
  fields: FieldReader[];
}

/** CRC-16/ARC as used by FIT, byte-wise table for speed. */
const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc16(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return crc;
}

/** First element of a numeric field, or undefined when it holds the base type's invalid value. */
function readNumber(view: DataView, off: number, size: number, base: number, little: boolean): number | undefined {
  const bsize = BASE_SIZE[base];
  if (bsize === undefined || base === BASE_STRING || size < bsize || size % bsize) return undefined;
  let v: number;
  switch (base) {
    case 0: case 2: case 13: v = view.getUint8(off); return v === 0xff ? undefined : v;
    case 10: v = view.getUint8(off); return v === 0 ? undefined : v;
    case 1: v = view.getInt8(off); return v === 0x7f ? undefined : v;
    case 3: v = view.getInt16(off, little); return v === 0x7fff ? undefined : v;
    case 4: v = view.getUint16(off, little); return v === 0xffff ? undefined : v;
    case 11: v = view.getUint16(off, little); return v === 0 ? undefined : v;
    case 5: v = view.getInt32(off, little); return v === 0x7fffffff ? undefined : v;
    case 6: v = view.getUint32(off, little); return v === 0xffffffff ? undefined : v;
    case 12: v = view.getUint32(off, little); return v === 0 ? undefined : v;
    case 8:
      if (view.getUint32(off, little) === 0xffffffff) return undefined;
      v = view.getFloat32(off, little);
      return Number.isFinite(v) ? v : undefined;
    case 9:
      if (view.getUint32(off, little) === 0xffffffff && view.getUint32(off + 4, little) === 0xffffffff) return undefined;
      v = view.getFloat64(off, little);
      return Number.isFinite(v) ? v : undefined;
    case 14: {
      const b = view.getBigInt64(off, little);
      return b === 0x7fffffffffffffffn ? undefined : Number(b);
    }
    case 15: case 16: {
      const b = view.getBigUint64(off, little);
      return b === (base === 15 ? 0xffffffffffffffffn : 0n) ? undefined : Number(b);
    }
  }
  return undefined;
}

const utf8 = new TextDecoder();

function readString(bytes: Uint8Array, off: number, size: number): string | undefined {
  let end = off;
  while (end < off + size && bytes[end] !== 0) end++;
  const s = utf8.decode(bytes.subarray(off, end)).trim();
  return s || undefined;
}

interface Sport {
  sport?: number;
  subSport?: number;
}

interface Decoded {
  points: TrackPoint[];
  /** Cadence per point as stored (scaled once the sport is known, usually at the end of the file). */
  rawCad: (number | undefined)[];
  session: Sport;
  sportMsg: Sport;
  name?: string;
  /** Data messages decoded. */
  messages: number;
  /** Every file in the chain had a matching CRC. */
  crcOk: boolean;
  /** Decoding stopped early on malformed data. */
  broken: boolean;
}

function decode(bytes: Uint8Array): Decoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Decoded = { points: [], rawCad: [], session: {}, sportMsg: {}, messages: 0, crcOk: true, broken: false };
  let lastTimestamp: number | undefined; // FIT seconds, carried across chained files.
  let start = 0;

  // A file may chain several FIT files back to back.
  while (start + 12 <= bytes.length) {
    const headerSize = bytes[start];
    const isFit = bytes[start + 8] === 0x2e && bytes[start + 9] === 0x46 && bytes[start + 10] === 0x49 && bytes[start + 11] === 0x54;
    if (headerSize < 12 || !isFit) {
      if (start === 0) throw new GpxError('invalid');
      break; // Trailing padding after a complete file.
    }
    const dataStart = start + headerSize;
    let dataEnd = dataStart + view.getUint32(start + 4, true);
    // Lenient about the declared size: a zero (streamed) or too-large size reads to the end.
    if (dataEnd === dataStart) {
      dataEnd = Math.max(dataStart, bytes.length - 2);
      out.crcOk = false;
    } else if (dataEnd + 2 > bytes.length) {
      dataEnd = Math.min(dataEnd, bytes.length);
      out.crcOk = false;
    } else if (crc16(bytes, start, dataEnd) !== view.getUint16(dataEnd, true)) {
      out.crcOk = false;
    }

    const defs: (Definition | undefined)[] = new Array(16);
    let pos = dataStart;
    try {
      while (pos < dataEnd) {
        const header = bytes[pos++];
        let local: number;
        let compressedTime: number | undefined;

        if (header & 0x80) {
          // Compressed timestamp header: 5-bit offset from the last full timestamp.
          local = (header >> 5) & 0x03;
          const offset = header & 0x1f;
          if (lastTimestamp !== undefined) {
            let t = (lastTimestamp & ~0x1f) + offset;
            if (offset < (lastTimestamp & 0x1f)) t += 0x20;
            lastTimestamp = t >>> 0;
            compressedTime = lastTimestamp;
          }
        } else if (header & 0x40) {
          // Definition message.
          local = header & 0x0f;
          const hasDev = (header & 0x20) !== 0;
          if (pos + 5 > dataEnd) throw new RangeError('truncated definition');
          const little = bytes[pos + 1] === 0;
          const global = view.getUint16(pos + 2, little);
          const count = bytes[pos + 4];
          pos += 5;
          const wanted = WANTED[global];
          const fields: FieldReader[] = [];
          let size = 0;
          for (let i = 0; i < count; i++, pos += 3) {
            if (pos + 3 > dataEnd) throw new RangeError('truncated definition');
            const num = bytes[pos], fsize = bytes[pos + 1], base = bytes[pos + 2] & 0x1f;
            if (num === FIELD_TIMESTAMP || wanted?.includes(num)) fields.push({ num, offset: size, size: fsize, base });
            size += fsize;
          }
          if (hasDev) {
            if (pos + 1 > dataEnd) throw new RangeError('truncated definition');
            const devCount = bytes[pos++];
            for (let i = 0; i < devCount; i++, pos += 3) {
              if (pos + 3 > dataEnd) throw new RangeError('truncated definition');
              size += bytes[pos + 1];
            }
          }
          defs[local] = { global, little, size, fields };
          continue;
        } else {
          local = header & 0x0f;
        }

        // Data message.
        const def = defs[local];
        if (!def) throw new RangeError('data message without definition');
        if (pos + def.size > dataEnd) throw new RangeError('truncated data message');
        out.messages++;
        const { global, little } = def;

        if (global === MSG_RECORD) {
          const p: TrackPoint = { lat: NaN, lon: NaN };
          let lat: number | undefined, lon: number | undefined, alt: number | undefined, enhAlt: number | undefined;
          let cad: number | undefined, frac: number | undefined, time = compressedTime;
          for (const f of def.fields) {
            const v = readNumber(view, pos + f.offset, f.size, f.base, little);
            if (v === undefined) continue;
            switch (f.num) {
              case FIELD_TIMESTAMP: time = lastTimestamp = v; break;
              case 0: lat = v; break;
              case 1: lon = v; break;
              case 2: alt = v; break;
              case 78: enhAlt = v; break;
              case 3: if (v > 0) p.hr = v; break;
              case 4: cad = v; break;
              case 53: frac = v; break;
              case 7: p.power = v; break;
              case 13: p.temp = v; break;
            }
          }
          if (lat !== undefined && lon !== undefined) {
            p.lat = lat * SEMICIRCLE_TO_DEG;
            p.lon = lon * SEMICIRCLE_TO_DEG;
            const a = enhAlt ?? alt;
            if (a !== undefined) p.ele = a / 5 - 500;
            if (time !== undefined) p.time = FIT_EPOCH_MS + time * 1000;
            out.points.push(p);
            out.rawCad.push(cad !== undefined && cad > 0 ? cad + (frac ?? 0) / 128 : undefined);
          }
        } else {
          for (const f of def.fields) {
            const off = pos + f.offset;
            if (f.num === FIELD_TIMESTAMP) {
              const v = readNumber(view, off, f.size, f.base, little);
              if (v !== undefined) lastTimestamp = v;
              continue;
            }
            if (global === MSG_SPORT && f.num === 3) {
              out.name ??= readString(bytes, off, f.size);
              continue;
            }
            const v = readNumber(view, off, f.size, f.base, little);
            if (v === undefined) continue;
            // The first session decides the sport (later ones of a multisport file are ignored).
            const target = global === MSG_SESSION ? out.session : out.sportMsg;
            const key = (global === MSG_SESSION ? f.num === 5 : f.num === 0) ? 'sport' : 'subSport';
            target[key] ??= v;
          }
        }
        pos += def.size;
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      out.broken = true;
      break;
    }
    start = dataEnd + 2;
  }
  return out;
}

/** FIT sport / sub_sport enums to the app's activity types. */
function activityType(s: Sport): ActivityType {
  switch (s.sport) {
    case undefined: return 'run'; // Same default as a GPX file without a type.
    case 1: return s.subSport === 3 ? 'trail-run' : 'run';
    case 11: case 17: return 'walk';
    default: return 'other';
  }
}

/** Decodes a FIT activity. Throws GpxError('invalid') for non-FIT data, GpxError('empty') without GPS points. */
/** Some watches write this altitude in records that have no altitude, instead of the FIT "invalid" value. */
const ALTITUDE_PLACEHOLDER = -1;

/**
 * Removes placeholder altitudes: some watches fill the records between their
 * full (every few seconds) records with exactly -1.0 m instead of leaving
 * the field invalid. Read as real values, they add a climb of hundreds of
 * metres at every full record. A value counts as a placeholder only when it
 * is exactly -1, is frequent (≥ 10 % of the points) and the other altitudes
 * are far from it (median more than 30 m away), so runs that really are
 * near sea level keep their data.
 */
export function dropAltitudePlaceholders(points: TrackPoint[]): void {
  const others: number[] = [];
  let placeholders = 0;
  for (const p of points) {
    if (p.ele === undefined) continue;
    if (p.ele === ALTITUDE_PLACEHOLDER) placeholders++;
    else others.push(p.ele);
  }
  if (!placeholders || placeholders < points.length * 0.1 || !others.length) return;
  others.sort((a, b) => a - b);
  const median = others[Math.floor(others.length / 2)];
  if (Math.abs(median - ALTITUDE_PLACEHOLDER) <= 30) return;
  for (const p of points) if (p.ele === ALTITUDE_PLACEHOLDER) delete p.ele;
}

export function parseActivityFit(bytes: Uint8Array): ParsedActivity {
  const d = decode(bytes);
  const enough = d.points.length >= 2;
  // Malformed data is tolerated as long as it yields a track (truncated files keep what was recorded).
  if (!enough && (d.broken || !d.messages || !d.crcOk)) throw new GpxError('invalid');
  if (!enough) throw new GpxError('empty');

  const type = activityType(d.session.sport !== undefined ? d.session : d.sportMsg);
  // FIT stores running/walking cadence per leg (strides per minute); report steps per minute.
  const onFoot = type !== 'other';
  const { points, rawCad } = d;
  for (let i = 0; i < points.length; i++) {
    const cad = rawCad[i];
    if (cad !== undefined) points[i].cad = onFoot && cad < 130 ? cad * 2 : cad;
  }

  // Concatenated sessions are normally in order already; sort (stably) if not.
  let sorted = true;
  for (let i = 1; i < points.length && sorted; i++) {
    const a = points[i - 1].time, b = points[i].time;
    if (a !== undefined && b !== undefined && b < a) sorted = false;
  }
  if (!sorted) points.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  dropAltitudePlaceholders(points);

  return { name: d.name, type, points };
}
