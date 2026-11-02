import { describe, expect, it } from 'vitest';
import { dropAltitudePlaceholders, parseActivityFit } from '../src/data/parse-fit';
import { computeSummary } from '../src/data/analysis';
import { GpxError } from '../src/gpx/parse';
import { FitBuilder, type FieldSpec, fitTime, semi } from './helpers/fit-builder';

const T0 = Date.UTC(2026, 9, 1, 7, 0, 0);
const alt = (m: number) => Math.round((m + 500) * 5);

const RECORD: FieldSpec[] = [
  { num: 253, type: 'uint32' },
  { num: 0, type: 'sint32' },
  { num: 1, type: 'sint32' },
  { num: 2, type: 'uint16' },
  { num: 3, type: 'uint8' },
  { num: 4, type: 'uint8' },
  { num: 7, type: 'uint16' },
  { num: 13, type: 'sint8' },
];
const SESSION: FieldSpec[] = [
  { num: 253, type: 'uint32' },
  { num: 5, type: 'enum' },
  { num: 6, type: 'enum' },
];

/** file_id + `n` records one second apart + a session with the given sport. */
function simpleRun(sport = 1, subSport = 0, n = 3): FitBuilder {
  const b = new FitBuilder()
    .define(0, 0, [{ num: 0, type: 'enum' }])
    .data(0, [4])
    .define(1, 20, RECORD);
  for (let i = 0; i < n; i++) {
    b.data(1, [fitTime(T0) + i, semi(-23.5), semi(-46.6 + i * 0.0001), alt(760 + i), 150 + i, 85, 250, 22]);
  }
  return b.define(2, 18, SESSION).data(2, [fitTime(T0) + n, sport, subSport]);
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof GpxError ? e.code : String(e);
  }
  return undefined;
}

describe('parseActivityFit', () => {
  it('decodes record fields with FIT units', () => {
    const a = parseActivityFit(simpleRun().build());
    expect(a.type).toBe('run');
    expect(a.name).toBeUndefined();
    expect(a.points).toHaveLength(3);
    const p = a.points[1];
    expect(p.lat).toBeCloseTo(-23.5, 6);
    expect(p.lon).toBeCloseTo(-46.5999, 6);
    expect(p.ele).toBeCloseTo(761, 6);
    expect(p.time).toBe(T0 + 1000);
    expect(p.hr).toBe(151);
    expect(p.cad).toBe(170); // 85 strides per minute doubled to steps
    expect(p.power).toBe(250);
    expect(p.temp).toBe(22);
  });

  it('accepts a 12-byte header and tolerates a bad CRC', () => {
    expect(parseActivityFit(simpleRun().build({ headerSize: 12 })).points).toHaveLength(3);
    expect(parseActivityFit(simpleRun().build({ badCrc: true })).points).toHaveLength(3);
    // A view into a larger buffer, as a ZIP reader may hand over.
    const bytes = simpleRun().build();
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 3);
    expect(parseActivityFit(padded.subarray(3, 3 + bytes.length)).points).toHaveLength(3);
  });

  it('prefers enhanced_altitude and keeps fractional cadence', () => {
    const b = new FitBuilder().define(0, 20, [
      { num: 253, type: 'uint32' },
      { num: 0, type: 'sint32' },
      { num: 1, type: 'sint32' },
      { num: 2, type: 'uint16' },
      { num: 78, type: 'uint32' },
      { num: 4, type: 'uint8' },
      { num: 53, type: 'uint8' },
    ]);
    b.data(0, [fitTime(T0), semi(1), semi(2), alt(100), alt(-20.4), 80, 64]);
    b.data(0, [fitTime(T0) + 1, semi(1), semi(2.0001), alt(101), undefined, 80, undefined]);
    const [p, q] = parseActivityFit(b.build()).points;
    expect(p.ele).toBeCloseTo(-20.4, 6);
    expect(p.cad).toBe(161); // (80 + 64/128) × 2
    expect(q.ele).toBeCloseTo(101, 6); // falls back to altitude
    expect(q.cad).toBe(160);
  });

  it('expands compressed timestamp headers, with rollover', () => {
    const fields: FieldSpec[] = [
      { num: 0, type: 'sint32' },
      { num: 1, type: 'sint32' },
    ];
    const base = fitTime(T0) - (fitTime(T0) % 32) + 30; // low 5 bits = 30
    const b = new FitBuilder()
      .define(0, 21, [{ num: 253, type: 'uint32' }]) // event message carrying the reference time
      .data(0, [base])
      .define(1, 20, fields)
      .data(1, [semi(0), semi(0)], { compressedTime: 31 })
      .data(1, [semi(0), semi(0.0001)], { compressedTime: 2 }) // wraps past 32
      .data(1, [semi(0), semi(0.0002)], { compressedTime: 2 }); // same second
    const times = parseActivityFit(b.build()).points.map((p) => (p.time! - T0) / 1000);
    const d = base - fitTime(T0);
    expect(times).toEqual([d + 1, d + 4, d + 4]);
  });

  it('reads big-endian definitions', () => {
    const b = new FitBuilder().define(3, 20, RECORD, { bigEndian: true });
    b.data(3, [fitTime(T0), semi(45), semi(-120), alt(1234.4), 172, 90, 300, -5]);
    b.data(3, [fitTime(T0) + 5, semi(45.001), semi(-120), alt(1235), 173, 91, 301, -4]);
    b.define(4, 18, SESSION, { bigEndian: true }).data(4, [fitTime(T0) + 6, 1, 3]);
    const a = parseActivityFit(b.build());
    expect(a.type).toBe('trail-run');
    expect(a.points[0]).toMatchObject({ hr: 172, cad: 180, power: 300, temp: -5, time: T0 });
    expect(a.points[0].lat).toBeCloseTo(45, 6);
    expect(a.points[0].lon).toBeCloseTo(-120, 6);
    expect(a.points[0].ele).toBeCloseTo(1234.4, 6);
    expect(a.points[1].time).toBe(T0 + 5000);
  });

  it('skips developer fields, arrays, odd-sized and unknown fields', () => {
    const fields: FieldSpec[] = [
      { num: 253, type: 'uint32' },
      { num: 99, type: 'string', size: 7 }, // unknown field
      { num: 3, type: 'uint16', size: 3 }, // size not a multiple of the type: skipped
      { num: 0, type: 'sint32' },
      { num: 1, type: 'sint32' },
      { num: 7, type: 'uint16', size: 4 }, // array: first element used
    ];
    const b = new FitBuilder().define(5, 20, fields, { dev: [[0, 4, 0], [1, 2, 0]] });
    b.data(5, [fitTime(T0), 'abcdef', 0, semi(10), semi(20), [210, 999]]);
    b.data(5, [fitTime(T0) + 1, 'x', 0, semi(10.0001), semi(20), [211, 999]], { devBytes: [0xff, 0x00, 0x01, 0x02, 0x03, 0x04] });
    const a = parseActivityFit(b.build());
    expect(a.points).toHaveLength(2);
    expect(a.points[0].hr).toBeUndefined();
    expect(a.points[0].power).toBe(210);
    expect(a.points[1]).toMatchObject({ time: T0 + 1000, power: 211 });
    expect(a.points[1].lat).toBeCloseTo(10.0001, 6);
  });

  it('treats invalid values as missing and drops records without position', () => {
    const b = new FitBuilder().define(0, 20, RECORD);
    b.data(0, [fitTime(T0), semi(1), semi(1), undefined, undefined, undefined, undefined, undefined]);
    b.data(0, [fitTime(T0) + 1, undefined, undefined, alt(5), 140, 80, 200, 20]); // no position
    b.data(0, [undefined, semi(1.0001), semi(1), alt(6), 0, 0, 0, 21]);
    const a = parseActivityFit(b.build());
    expect(a.points).toEqual([
      { lat: expect.closeTo(1, 6), lon: expect.closeTo(1, 6), time: T0 },
      { lat: expect.closeTo(1.0001, 6), lon: expect.closeTo(1, 6), ele: expect.closeTo(6, 6), power: 0, temp: 21 },
    ]);
  });

  it('maps sport and sub_sport', () => {
    expect(parseActivityFit(simpleRun(1, 0).build()).type).toBe('run');
    expect(parseActivityFit(simpleRun(1, 3).build()).type).toBe('trail-run');
    expect(parseActivityFit(simpleRun(11).build()).type).toBe('walk');
    expect(parseActivityFit(simpleRun(17).build()).type).toBe('walk');
    const ride = parseActivityFit(simpleRun(2).build());
    expect(ride.type).toBe('other');
    expect(ride.points[0].cad).toBe(85); // rpm, not doubled
  });

  it('falls back to the sport message (with its name) and defaults to run', () => {
    const b = new FitBuilder()
      .define(0, 12, [{ num: 0, type: 'enum' }, { num: 1, type: 'enum' }, { num: 3, type: 'string', size: 16 }])
      .data(0, [11, 0, 'Walk ção'])
      .define(1, 20, RECORD);
    b.data(1, [fitTime(T0), semi(0), semi(0), undefined, undefined, 60, undefined, undefined]);
    b.data(1, [fitTime(T0) + 1, semi(0), semi(0.0001), undefined, undefined, 60, undefined, undefined]);
    const a = parseActivityFit(b.build());
    expect(a.type).toBe('walk');
    expect(a.name).toBe('Walk ção');
    expect(a.points[0].cad).toBe(120);

    const plain = new FitBuilder().define(0, 20, RECORD);
    plain.data(0, [fitTime(T0), semi(0), semi(0), undefined, undefined, undefined, undefined, undefined]);
    plain.data(0, [fitTime(T0) + 1, semi(0), semi(0.0001), undefined, undefined, undefined, undefined, undefined]);
    expect(parseActivityFit(plain.build()).type).toBe('run');
  });

  it('concatenates sessions and chained files in timestamp order', () => {
    const second = new FitBuilder().define(0, 20, RECORD);
    second.data(0, [fitTime(T0) + 100, semi(2), semi(2), undefined, 120, undefined, undefined, undefined]);
    second.data(0, [fitTime(T0) + 101, semi(2), semi(2.0001), undefined, 121, undefined, undefined, undefined]);
    const first = simpleRun().build();
    const chained = new Uint8Array([...second.build(), ...first]);
    const a = parseActivityFit(chained);
    expect(a.points.map((p) => (p.time! - T0) / 1000)).toEqual([0, 1, 2, 100, 101]);
    expect(a.type).toBe('run');
  });

  it('keeps the points of a truncated file', () => {
    const bytes = simpleRun(1, 0, 5).build();
    expect(parseActivityFit(bytes.slice(0, bytes.length - 20)).points.length).toBeGreaterThanOrEqual(2);
  });

  it('throws empty without positioned records', () => {
    const b = new FitBuilder().define(0, 20, RECORD);
    b.data(0, [fitTime(T0), undefined, undefined, alt(5), 140, 80, 200, 20]);
    b.data(0, [fitTime(T0) + 1, undefined, undefined, alt(5), 140, 80, 200, 20]);
    expect(code(() => parseActivityFit(b.build()))).toBe('empty');
  });

  it('throws invalid for non-FIT or undecodable data', () => {
    expect(code(() => parseActivityFit(new Uint8Array(0)))).toBe('invalid');
    expect(code(() => parseActivityFit(new TextEncoder().encode('<gpx version="1.1"></gpx>')))).toBe('invalid');
    const noSignature = simpleRun().build();
    noSignature[9] = 0x58;
    expect(code(() => parseActivityFit(noSignature))).toBe('invalid');
    expect(code(() => parseActivityFit(new FitBuilder().build()))).toBe('invalid'); // header only
    // Data message whose local type was never defined.
    expect(code(() => parseActivityFit(new FitBuilder().raw(0x07, 1, 2, 3).build()))).toBe('invalid');
  });

  it('decodes a large file quickly', () => {
    const b = new FitBuilder().define(0, 20, RECORD);
    for (let i = 0; i < 40000; i++) b.data(0, [fitTime(T0) + i, semi(-23.5 + i * 1e-6), semi(-46.6), alt(700), 150, 85, 250, 22]);
    const bytes = b.build();
    const t = performance.now();
    expect(parseActivityFit(bytes).points).toHaveLength(40000);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('dropAltitudePlaceholders', () => {
  const pts = (eles: (number | undefined)[]) => eles.map((ele, i) => ({ lat: 0, lon: i * 0.0001, ele }));

  it('removes frequent -1 m placeholders between real altitudes', () => {
    // Full record every 5 s, placeholders in between (as some watches write).
    const p = pts(Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 540 + i / 10 : -1)));
    dropAltitudePlaceholders(p);
    expect(p.filter((x) => x.ele === -1)).toHaveLength(0);
    expect(p.filter((x) => x.ele !== undefined)).toHaveLength(10);
    expect(computeSummary(p).elevationGain).toBeLessThan(10);
  });

  it('keeps -1 m when the run really is near sea level', () => {
    const p = pts(Array.from({ length: 40 }, (_, i) => (i % 2 ? -1 : 2)));
    dropAltitudePlaceholders(p);
    expect(p.filter((x) => x.ele === -1)).toHaveLength(20);
  });

  it('keeps a rare -1 m value', () => {
    const p = pts([500, 501, -1, 502, 503, 504, 505, 506, 507, 508, 509, 510]);
    dropAltitudePlaceholders(p);
    expect(p[2].ele).toBe(-1);
  });
});
