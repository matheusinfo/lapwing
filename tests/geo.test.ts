import { describe, expect, it } from 'vitest';
import { elevationGainLoss, haversine, nearestOnSegments, trackDistance } from '../src/geo';
import { formatDuration, parsePace } from '../src/format';

describe('distance', () => {
  it('measures one degree of latitude as ~111 km', () => {
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111195, -1);
  });

  it('sums a track', () => {
    const d = trackDistance([[0, 0], [0, 0.01], [0, 0.02]]);
    expect(d).toBeCloseTo(2 * 1111.95, 0);
    expect(trackDistance([])).toBe(0);
  });
});

describe('elevationGainLoss', () => {
  it('adds climbs and descents', () => {
    const r = elevationGainLoss([[0, 0, 100], [0, 0, 110], [0, 0, 105], [0, 0, 120]]);
    expect(r).toEqual({ gain: 25, loss: 5, hasElevation: true });
  });

  it('ignores noise below the threshold', () => {
    const r = elevationGainLoss([[0, 0, 100], [0, 0, 101], [0, 0, 100], [0, 0, 101]], 2);
    expect(r.gain).toBe(0);
    expect(r.loss).toBe(0);
  });

  it('reports when there is no elevation', () => {
    expect(elevationGainLoss([[0, 0], [1, 1]]).hasElevation).toBe(false);
  });
});

describe('nearestOnSegments', () => {
  it('finds the closest edge and interpolates the point', () => {
    const segments = [
      { coords: [[0, 0, 0], [0.01, 0, 10]] as [number, number, number][] },
      { coords: [[0.01, 0, 10], [0.01, 0.01, 20]] as [number, number, number][] },
    ];
    const hit = nearestOnSegments(segments, [0.005, 0.0001])!;
    expect(hit.segIndex).toBe(0);
    expect(hit.edgeIndex).toBe(0);
    expect(hit.point[0]).toBeCloseTo(0.005, 6);
    expect(hit.point[1]).toBeCloseTo(0, 6);
    expect(hit.point[2]).toBeCloseTo(5, 3);
  });
});

describe('pace and time', () => {
  it('parses pace', () => {
    expect(parsePace('5:30')).toBe(330);
    expect(parsePace('6')).toBe(360);
    expect(parsePace('5,5')).toBe(330);
    expect(parsePace('5:75')).toBeNull();
    expect(parsePace('')).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
