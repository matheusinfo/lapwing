// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseActivityTcx } from '../src/data/parse-tcx';
import { GpxError } from '../src/gpx/parse';

const NS = 'xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"';

const tcx = (sport: string, trackpoints: string, ns = NS) => `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase ${ns}>
  <Activities><Activity Sport="${sport}"><Id>2026-10-01T07:00:00Z</Id><Notes>Morning</Notes>
    <Lap StartTime="2026-10-01T07:00:00Z"><Track>${trackpoints}</Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;

const tp = (sec: number, lat: number | null, inner = '') => `<Trackpoint>
  <Time>2026-10-01T07:00:${String(sec).padStart(2, '0')}Z</Time>
  ${lat === null ? '' : `<Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>-46.6</LongitudeDegrees></Position>`}
  ${inner}
</Trackpoint>`;

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof GpxError ? e.code : String(e);
  }
  return undefined;
}

describe('parseActivityTcx', () => {
  it('reads a Strava running export with leading whitespace', () => {
    const text = '\n   ' + tcx('Running',
      tp(0, -23.5, `<AltitudeMeters>760.4</AltitudeMeters><DistanceMeters>0</DistanceMeters>
        <HeartRateBpm><Value>148</Value></HeartRateBpm>
        <Extensions><ns3:TPX><ns3:Speed>3.1</ns3:Speed><ns3:RunCadence>86</ns3:RunCadence><ns3:Watts>260</ns3:Watts></ns3:TPX></Extensions>`) +
      tp(1, -23.5001, '<AltitudeMeters>761</AltitudeMeters>'));
    const a = parseActivityTcx(text);
    expect(a.type).toBe('run');
    expect(a.name).toBeUndefined();
    expect(a.points).toEqual([
      { lat: -23.5, lon: -46.6, ele: 760.4, time: Date.UTC(2026, 9, 1, 7), hr: 148, cad: 172, power: 260 },
      { lat: -23.5001, lon: -46.6, ele: 761, time: Date.UTC(2026, 9, 1, 7, 0, 1) },
    ]);
  });

  it('accepts a BOM and any namespace prefix', () => {
    const ns = 'xmlns:t="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:x="ext"';
    const text = `﻿<t:TrainingCenterDatabase ${ns}><t:Activities><t:Activity Sport="Running"><t:Lap><t:Track>
      <t:Trackpoint><t:Time>2026-10-01T07:00:00Z</t:Time><t:Position><t:LatitudeDegrees>1</t:LatitudeDegrees><t:LongitudeDegrees>2</t:LongitudeDegrees></t:Position>
        <t:Cadence>84</t:Cadence><t:Extensions><x:TPX><x:Watts>199</x:Watts></x:TPX></t:Extensions></t:Trackpoint>
      <t:Trackpoint><t:Position><t:LatitudeDegrees>1.0001</t:LatitudeDegrees><t:LongitudeDegrees>2</t:LongitudeDegrees></t:Position></t:Trackpoint>
    </t:Track></t:Lap></t:Activity></t:Activities></t:TrainingCenterDatabase>`;
    const a = parseActivityTcx(text);
    expect(a.points[0]).toMatchObject({ lat: 1, lon: 2, cad: 168, power: 199 });
    expect(a.points[1].time).toBeUndefined();
  });

  it('maps the Sport attribute and keeps bike cadence in rpm', () => {
    const pts = tp(0, 1, '<Cadence>90</Cadence>') + tp(1, 1.0001);
    const ride = parseActivityTcx(tcx('Biking', pts));
    expect(ride.type).toBe('other');
    expect(ride.points[0].cad).toBe(90);
    expect(parseActivityTcx(tcx('Other', pts)).type).toBe('other');
    expect(parseActivityTcx(tcx('Running', pts)).points[0].cad).toBe(180);
  });

  it('skips trackpoints without a position and ignores zero heart rate', () => {
    const a = parseActivityTcx(tcx('Running',
      tp(0, 1, '<HeartRateBpm><Value>0</Value></HeartRateBpm>') + tp(1, null, '<HeartRateBpm><Value>150</Value></HeartRateBpm>') + tp(2, 1.0001)));
    expect(a.points).toHaveLength(2);
    expect(a.points[0].hr).toBeUndefined();
    expect(a.points[1].time).toBe(Date.UTC(2026, 9, 1, 7, 0, 2));
  });

  it('throws empty without positioned trackpoints', () => {
    expect(code(() => parseActivityTcx(tcx('Running', tp(0, null) + tp(1, null))))).toBe('empty');
    expect(code(() => parseActivityTcx(tcx('Running', '')))).toBe('empty');
  });

  it('throws invalid for other documents', () => {
    expect(code(() => parseActivityTcx('<gpx><trk/></gpx>'))).toBe('invalid');
    expect(code(() => parseActivityTcx('not xml'))).toBe('invalid');
    expect(code(() => parseActivityTcx(''))).toBe('invalid');
  });
});
