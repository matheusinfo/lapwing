import { describe, expect, it } from 'vitest';
import { buildProfile, MAX_PROFILE_POINTS } from '../src/screens/routes/profile';
import { trackDistance } from '../src/geo';
import type { Coord } from '../src/types';

/** A straight track going north from (0, 0), `count` points `spacing` metres apart. */
function northTrack(count: number, spacing: number, ele: (i: number) => number | undefined): Coord[] {
  const degPerMetre = 1 / 111195;
  return Array.from({ length: count }, (_, i) => {
    const e = ele(i);
    const lat = i * spacing * degPerMetre;
    return e === undefined ? [0, lat] : [0, lat, e];
  });
}

describe('buildProfile', () => {
  it('returns null when there is nothing to draw', () => {
    expect(buildProfile([])).toBeNull();
    expect(buildProfile([[0, 0, 10]])).toBeNull();
    expect(buildProfile([[0, 0], [0, 0.01]])).toBeNull();
    expect(buildProfile([[0, 0, 10], [0, 0.01], [0, 0.02]])).toBeNull();
    expect(buildProfile([[1, 1, 10], [1, 1, 20]])).toBeNull();
  });

  it('spans the whole track and keeps the start and finish elevations', () => {
    const track = northTrack(50, 40, (i) => 500 + 20 * Math.sin(i / 5));
    const p = buildProfile(track)!;
    expect(p.distance).toBe(trackDistance(track));
    expect(p.points[0].d).toBe(0);
    expect(p.points[p.points.length - 1].d).toBe(p.distance);
    expect(p.points[0].ele).toBeCloseTo(track[0][2]!, 6);
    expect(p.points[p.points.length - 1].ele).toBeCloseTo(track[49][2]!, 6);
  });

  it('downsamples long tracks to evenly spaced points', () => {
    const track = northTrack(12000, 2, (i) => 100 + (i % 7));
    const p = buildProfile(track)!;
    expect(p.points).toHaveLength(MAX_PROFILE_POINTS);
    const step = p.distance / (MAX_PROFILE_POINTS - 1);
    for (let k = 1; k < p.points.length; k++) {
      expect(p.points[k].d - p.points[k - 1].d).toBeCloseTo(step, 6);
    }
    expect(buildProfile(track, { maxPoints: 100 })!.points).toHaveLength(100);
  });

  it('samples short tracks every few metres', () => {
    const p = buildProfile(northTrack(2, 100, () => 10))!;
    expect(p.points.length).toBe(Math.ceil(p.distance / 5) + 1);
  });

  it('follows a steady climb exactly and reports its grade', () => {
    // 5% grade: 5 m up every 100 m.
    const track = northTrack(21, 100, (i) => 200 + 5 * i);
    const p = buildProfile(track)!;
    for (const pt of p.points) {
      expect(pt.ele).toBeCloseTo(200 + (pt.d / p.distance) * 100, 6);
      expect(pt.grade).toBeCloseTo(5, 3);
    }
  });

  it('reports descents as negative grades', () => {
    const p = buildProfile(northTrack(11, 100, (i) => 300 - 8 * i))!;
    expect(p.points[Math.floor(p.points.length / 2)].grade).toBeCloseTo(-8, 3);
  });

  it('smooths noise but keeps the raw lowest and highest elevation', () => {
    // Flat ground with ±3 m of noise every 3 m, like a phone's GPS altitude.
    const track = northTrack(1001, 3, (i) => 100 + (i % 2 ? 3 : -3));
    const p = buildProfile(track)!;
    const inner = p.points.slice(5, -5).map((pt) => pt.ele);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(1);
    expect(p.min).toBe(97);
    expect(p.max).toBe(103);
  });

  it('interpolates points without elevation from their neighbours', () => {
    const track: Coord[] = [[0, 0], [0, 0.001, 100], [0, 0.002], [0, 0.003, 200], [0, 0.004]];
    const p = buildProfile(track, { smoothing: 0 })!;
    const q = p.distance / 4; // The points are evenly spaced.
    for (const pt of p.points) {
      // Level before the first known elevation and after the last one.
      const expected = pt.d <= q ? 100 : pt.d >= 3 * q ? 200 : 100 + (100 * (pt.d - q)) / (2 * q);
      // Each sample still averages over two steps, which rounds the corners a little.
      expect(Math.abs(pt.ele - expected)).toBeLessThan(1);
    }
  });

  it('places each sample on the track', () => {
    const track: Coord[] = [[0, 0, 10], [0, 0.01, 10], [0.01, 0.01, 10]];
    const p = buildProfile(track)!;
    const mid = p.points[Math.round((p.points.length - 1) / 2)];
    expect(mid.lng).toBeCloseTo(0, 4);
    expect(mid.lat).toBeCloseTo(0.01, 4);
    const quarter = p.points[Math.round((p.points.length - 1) / 4)];
    expect(quarter.lng).toBe(0);
    expect(quarter.lat).toBeCloseTo(0.005, 4);
  });

  it('handles repeated points', () => {
    const track: Coord[] = [[0, 0, 10], [0, 0, 12], [0, 0.001, 14], [0, 0.001, 14]];
    const p = buildProfile(track)!;
    for (const pt of p.points) {
      expect(Number.isFinite(pt.ele)).toBe(true);
      expect(Number.isFinite(pt.grade)).toBe(true);
    }
  });
});
