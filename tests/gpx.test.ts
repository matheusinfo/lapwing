// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseGpx, GpxError } from '../src/gpx/parse';
import { fileNameFor, toGpx } from '../src/gpx/export';
import type { Coord } from '../src/types';

const coords: Coord[] = [
  [-51.9367, -23.4244, 560],
  [-51.935, -23.423, 562.5],
  [-51.93, -23.42, 558],
];

describe('GPX export → parse', () => {
  it('round-trips points, elevation and name', () => {
    const parsed = parseGpx(toGpx(coords, 'Volta <no> "Parque" & lago'));
    expect(parsed.name).toBe('Volta <no> "Parque" & lago');
    expect(parsed.coords).toHaveLength(3);
    parsed.coords.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(coords[i][0], 6);
      expect(c[1]).toBeCloseTo(coords[i][1], 6);
      expect(c[2]).toBeCloseTo(coords[i][2]!, 1);
    });
  });

  it('writes points without elevation', () => {
    const parsed = parseGpx(toGpx([[1, 2], [3, 4]], 'x'));
    expect(parsed.coords).toEqual([[1, 2], [3, 4]]);
  });
});

describe('parseGpx', () => {
  it('falls back to route points when there is no track', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
      <rte><name>Route</name><rtept lat="1" lon="2"/><rtept lat="3" lon="4"><ele>10</ele></rtept></rte></gpx>`;
    expect(parseGpx(gpx)).toEqual({ name: 'Route', coords: [[2, 1], [4, 3, 10]] });
  });

  it('joins several tracks and segments in order', () => {
    const gpx = `<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
      <trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
           <trkseg><trkpt lat="3" lon="3"/></trkseg></trk>
      <trk><trkseg><trkpt lat="4" lon="4"/></trkseg></trk></gpx>`;
    expect(parseGpx(gpx).coords.map((c) => c[1])).toEqual([1, 2, 3, 4]);
  });

  it('works without a namespace and skips bad points', () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="x" lon="2"/><trkpt lat="3" lon="3"/></trkseg></trk></gpx>`;
    expect(parseGpx(gpx).coords).toEqual([[1, 1], [3, 3]]);
  });

  it('rejects files that are not GPX', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow(GpxError);
    expect(() => parseGpx('not xml at all <')).toThrow(GpxError);
  });

  it('rejects GPX with fewer than two points', () => {
    try {
      parseGpx('<gpx><wpt lat="1" lon="1"/></gpx>');
      expect.unreachable();
    } catch (e) {
      expect((e as GpxError).code).toBe('empty');
    }
  });
});

describe('fileNameFor', () => {
  it('makes a safe file name', () => {
    expect(fileNameFor('Volta no Parque do Ingá!')).toBe('volta-no-parque-do-inga.gpx');
    expect(fileNameFor('   ')).toBe('route.gpx');
  });
});
