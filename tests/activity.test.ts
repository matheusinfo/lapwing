// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActivityGpx } from '../src/data/parse-activity';
import type { TrackPoint } from '../src/data/types';
import { bestEffort, computeSummary, cumulativeDistance, cumulativeMovingTime } from '../src/data/analysis';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const file = (match: string) => fs.readdirSync(dir).find((f) => f.includes(match))!;

describe('parseActivityGpx (Strava format)', () => {
  it('reads time, elevation, heart rate, cadence and temperature', () => {
    const a = parseActivityGpx(read(file('tempo-run')));
    expect(a.name).toBe('Tempo run');
    expect(a.type).toBe('run');
    const p = a.points[100];
    expect(p.time).toBeTypeOf('number');
    expect(p.ele).toBeGreaterThan(500);
    expect(p.hr).toBeGreaterThan(80);
    expect(p.cad).toBeGreaterThan(150); // strides doubled to steps
    expect(p.temp).toBeGreaterThan(10);
    expect(p.power).toBeUndefined();
  });

  it('reads Strava power', () => {
    const a = parseActivityGpx(read(file('5x1000')));
    expect(a.points[500].power).toBeGreaterThan(100);
  });

  it('handles other prefixes and missing extensions', () => {
    const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="x"><trk><type>9</type><trkseg>
      <trkpt lat="0" lon="0"><time>2026-01-01T10:00:00Z</time><extensions><ns3:TrackPointExtension><ns3:hr>150</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
      <trkpt lat="0" lon="0.001"><time>2026-01-01T10:00:30Z</time></trkpt></trkseg></trk></gpx>`;
    const a = parseActivityGpx(gpx);
    expect(a.type).toBe('run');
    expect(a.points[0].hr).toBe(150);
    expect(a.points[1].hr).toBeUndefined();
  });
});

describe('computeSummary', () => {
  it('summarises a Strava run', () => {
    const { points } = parseActivityGpx(read(file('tempo-run')));
    const s = computeSummary(points);
    expect(s.distance / 1000).toBeCloseTo(8.5, 0);
    expect(s.has).toEqual({ time: true, ele: true, hr: true, cad: true, temp: true, power: false });
    expect(s.avgPace).toBeGreaterThan(300);
    expect(s.avgPace).toBeLessThan(370);
    expect(s.bestPace).toBeLessThan(s.avgPace!);
    expect(s.avgHr).toBeGreaterThan(120);
    expect(s.maxHr).toBeGreaterThanOrEqual(s.avgHr!);
    expect(s.elevationGain).toBeGreaterThan(0);
  });

  it('removes stops from moving time', () => {
    const { points } = parseActivityGpx(read(file('2026-10-30')));
    const s = computeSummary(points);
    expect(s.elapsedTime - s.movingTime).toBeGreaterThan(25);
  });

  it('finds best efforts', () => {
    // 2 km at 5:00/km then 1 km at 4:00/km, 1 point per second.
    const pts: TrackPoint[] = [];
    let lon = 0, t = 0;
    const step = (v: number) => { lon += v / 111320; t += 1000; pts.push({ lat: 0, lon, time: t }); };
    pts.push({ lat: 0, lon: 0, time: 0 });
    for (let i = 0; i < 600; i++) step(2000 / 600);
    for (let i = 0; i < 240; i++) step(1000 / 240);
    const d = cumulativeDistance(pts);
    const m = cumulativeMovingTime(pts, d);
    expect(bestEffort(d, m, 1000)).toBeCloseTo(240, -1);
    expect(bestEffort(d, m, 5000)).toBeUndefined();
  });
});
