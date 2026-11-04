// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Activity, type AthleteSettings, type TrackPoint } from '../src/data/types';

// ---- In-memory stand-ins for IndexedDB ----

const tracks = new Map<string, TrackPoint[]>();
let activities: Activity[] = [];
let saved: AthleteSettings = { ...DEFAULT_SETTINGS };
const dataListeners = new Set<(s: string) => void>();

vi.mock('../src/data/db', () => ({
  getTrack: async (id: string) => tracks.get(id) ?? [],
  listActivities: async () => activities,
  getSettings: async () => ({ ...saved }),
  saveSettings: async (s: AthleteSettings) => {
    saved = s;
    dataListeners.forEach((fn) => fn('settings'));
  },
  onDataChange: (fn: (s: string) => void) => {
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
  },
}));
vi.mock('../src/ui/toast', () => ({ showToast: () => {} }));
vi.mock('../src/ui/confirm', () => ({ confirmDialog: async () => true }));

const zones = await import('../src/data/zones');
const { hrZone, hrZoneRanges } = await import('../src/data/metrics');
const { cumulativeDistance, cumulativeMovingTime } = await import('../src/data/analysis');
const { estimateZones } = await import('../src/screens/settings/zones-estimate');
const { mountZonesSection } = await import('../src/screens/settings/zones-section');
const { setLang } = await import('../src/i18n');

// ---- Synthetic runs ----

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 12);

/** A straight-line run made of [seconds, pace s/km, hr] pieces, one point every 5 s. */
function track(start: number, pieces: [number, number, number][]): TrackPoint[] {
  const points: TrackPoint[] = [];
  let t = 0, d = 0;
  for (const [seconds, pace, hr] of pieces) {
    for (let s = 0; s < seconds; s += 5) {
      points.push({ lat: d / 111_320, lon: 0, time: start + t * 1000, hr });
      t += 5;
      d += (5 / pace) * 1000;
    }
  }
  points.push({ lat: d / 111_320, lon: 0, time: start + t * 1000, hr: pieces[pieces.length - 1][2] });
  return points;
}

let n = 0;
function addRun(daysAgo: number, pieces: [number, number, number][], maxHr?: number): Activity {
  const id = `r${++n}`;
  const startTime = NOW - daysAgo * DAY;
  const points = track(startTime, pieces);
  const dist = cumulativeDistance(points);
  const moving = cumulativeMovingTime(points, dist);
  const total = moving[moving.length - 1];
  const avgHr = pieces.reduce((s, [sec, , hr]) => s + sec * hr, 0) / pieces.reduce((s, [sec]) => s + sec, 0);
  tracks.set(id, points);
  const a: Activity = {
    id,
    name: `Run ${id}`,
    type: 'run',
    startTime,
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: {
      distance: dist[dist.length - 1],
      elapsedTime: total,
      movingTime: total,
      avgPace: total / (dist[dist.length - 1] / 1000),
      avgHr,
      maxHr: maxHr ?? Math.max(...pieces.map((p) => p[2])),
      elevationGain: 0,
      elevationLoss: 0,
      has: { time: true, ele: false, hr: true, cad: false, temp: false, power: false },
      bounds: [[0, 0], [0, 0]],
    },
  };
  activities.push(a);
  return a;
}

beforeEach(() => {
  tracks.clear();
  activities = [];
  saved = { ...DEFAULT_SETTINGS };
});

// ---- Pure zone logic ----

describe('zones', () => {
  const mine: AthleteSettings = { ...DEFAULT_SETTINGS, maxHr: 196, hrZoneStarts: [159, 167, 177, 186], paceZoneStarts: [410, 375, 345, 315] };

  it('uses saved bpm zones, falling back to % of max HR', () => {
    expect(zones.hrStarts(DEFAULT_SETTINGS)).toEqual([114, 133, 152, 171]);
    expect(zones.hrStarts(mine)).toEqual([159, 167, 177, 186]);
    // Broken saved zones are ignored.
    expect(zones.hrStarts({ ...mine, hrZoneStarts: [170, 160, 177, 186] })).toEqual([118, 137, 157, 176]);
    expect(zones.paceStarts(DEFAULT_SETTINGS)).toBeUndefined();
    expect(hrZoneRanges(mine)).toEqual([[0, 158], [159, 166], [167, 176], [177, 185], [186, 196]]);
  });

  it('puts heart rate and pace in the right zone at the boundaries', () => {
    const hr = [158, 159, 166, 167, 176.4, 177, 185, 186, 200].map((v) => hrZone(v, mine));
    expect(hr).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const starts = zones.paceStarts(mine)!;
    expect([411, 410, 376, 375, 346, 345, 316, 315, 280].map((p) => zones.zoneOfPace(p, starts))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('builds Friel zones from threshold heart rate and pace', () => {
    expect(zones.hrZonesFromLthr(187)).toEqual([159, 168, 178, 187]);
    expect(zones.paceZonesFromThreshold(316)).toEqual([410, 360, 335, 315]);
    expect(zones.validPaceStarts([410, 360, 335, 315])).toBe(true);
    expect(zones.validPaceStarts([410, 420, 335, 315])).toBe(false);
  });

  it('measures time in pace zones', () => {
    const points = track(0, [[420, 420, 150], [300, 300, 180]]); // 1 km at 7:00, then 1 km at 5:00
    const dist = cumulativeDistance(points);
    const secs = zones.paceZoneSeconds(dist, cumulativeMovingTime(points, dist), [410, 375, 345, 315]);
    expect(secs[0]).toBeCloseTo(420, -1);
    expect(secs[4]).toBeCloseTo(300, -1);
    expect(secs[1] + secs[2] + secs[3]).toBeLessThan(15);
  });

  it('finds the best 30-minute heart rate', () => {
    const points = track(0, [[2400, 400, 150], [1800, 320, 182], [600, 400, 160]]);
    const dist = cumulativeDistance(points);
    expect(zones.bestWindowHr(points, cumulativeMovingTime(points, dist))).toBeCloseTo(182, 0);
    expect(zones.bestWindowHr(points.slice(0, 100), cumulativeMovingTime(points.slice(0, 100), dist.slice(0, 100)))).toBeUndefined();
  });
});

// ---- Estimate from runs ----

describe('estimateZones', () => {
  it('estimates max HR, threshold HR and pace from hard efforts', async () => {
    addRun(20, [[3000, 400, 150]], 170); // easy
    const race = addRun(40, [[600, 380, 160], [3100, 311, 187], [30, 280, 196]]); // 10K-ish race at 5:11, sprint finish
    // A lone sensor spike: one 5-second reading at 215 bpm in an easy run.
    const spiky = addRun(100, [[1000, 420, 140], [5, 420, 215], [1000, 420, 140]], 215);
    expect(spiky.summary.maxHr).toBe(215);
    const e = await estimateZones(activities, NOW, new AbortController().signal);
    expect(e.maxHr).toMatchObject({ value: 196, activity: race });
    expect(e.lthr?.value).toBe(187);
    expect(e.lthr?.activity).toBe(race);
    expect(e.hrZoneStarts).toEqual([159, 168, 178, 187]);
    expect(e.thresholdPace!.value).toBeGreaterThan(300);
    expect(e.thresholdPace!.value).toBeLessThan(335);
    expect(e.paceZoneStarts![3]).toBeCloseTo(e.thresholdPace!.value, -1);
  });

  it('falls back to 90 % of max HR without a hard effort', async () => {
    addRun(10, [[2400, 420, 140]]); // easy, long enough for 30 minutes
    addRun(12, [[600, 330, 175], [300, 300, 190]]); // short and hard: sets the max HR only
    const e = await estimateZones(activities, NOW, new AbortController().signal);
    expect(e.lthr).toEqual({ value: 171 });
  });
});

// ---- Settings card ----

describe('zones settings card', () => {
  let el: HTMLElement;
  let cleanup: () => void;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const input = (sel: string) => el.querySelector<HTMLInputElement>(sel)!;
  const type = (i: HTMLInputElement, value: string) => {
    i.value = value;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeAll(() => setLang('pt-BR'));
  beforeEach(async () => {
    saved = { ...DEFAULT_SETTINGS, maxHr: 196, restingHr: 52 };
    el = document.createElement('div');
    document.body.append(el);
    cleanup = mountZonesSection(el);
    await flush();
  });
  afterEach(() => {
    cleanup();
    el.remove();
  });

  it('edits each zone, keeps neighbours in step and saves bpm and pace zones', async () => {
    expect(el.textContent).toContain('60, 70, 80 e 90%');
    // Z2 "to" and Z3 "from" share a boundary.
    type(input('[data-hr="1"][data-side="hi"]'), '166');
    expect(input('[data-hr="1"][data-side="lo"]').value).toBe('167');
    for (const [b, v] of [[0, '159'], [2, '177'], [3, '186']] as const) type(input(`[data-hr="${b}"][data-side="lo"]`), v);
    for (const [b, v] of [[0, '6:50'], [1, '6:15'], [2, '5:45'], [3, '5:15']] as const) type(input(`[data-pace="${b}"][data-side="lo"]`), v);
    expect(input('[data-pace="1"][data-side="hi"]').value).toBe('6:15');
    expect(el.querySelector('.zn-dirty')).not.toBeNull();

    el.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(saved).toMatchObject({ maxHr: 196, restingHr: 52, hrZoneStarts: [159, 167, 177, 186], paceZoneStarts: [410, 375, 345, 315] });
    expect(el.textContent).toContain('Usando as suas zonas');
  });

  it('rejects zones that do not go up', async () => {
    type(input('[data-hr="2"][data-side="lo"]'), '120');
    el.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(el.querySelector<HTMLElement>('.zn-error')!.hidden).toBe(false);
    expect(saved.hrZoneStarts).toBeUndefined();
  });

  it('generates zones from typed threshold values, and from the runs', async () => {
    type(input('[name="lthr"]'), '187');
    type(input('[name="thresholdPace"]'), '5:16');
    el.querySelector<HTMLElement>('[data-zn="from-refs"]')!.click();
    expect(input('[data-hr="0"][data-side="lo"]').value).toBe('159');
    expect(input('[data-pace="0"][data-side="lo"]').value).toBe('6:50');

    addRun(40, [[600, 380, 160], [3100, 311, 187], [30, 280, 196]]);
    el.querySelector<HTMLElement>('[data-zn="estimate"]')!.click();
    for (let i = 0; i < 20 && el.querySelector('[data-zn="estimate"][disabled]'); i++) await flush();
    expect(el.querySelector('.zn-notes')!.textContent).toContain('melhor média de 30 minutos');
    expect(input('[name="lthr"]').value).toBe('187');
    expect(saved.hrZoneStarts).toBeUndefined(); // Only saved on "Save zones".
  });
});
