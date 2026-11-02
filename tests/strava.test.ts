// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, ActivitySummary } from '../src/data/types';

const mem = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  activities: [] as Activity[],
  tracks: new Map<string, unknown[]>(),
  shoe: undefined as string | undefined,
}));

vi.mock('../src/data/db', () => ({
  get: async (_store: string, id: string) => structuredClone(mem.settings.get(id)),
  put: async (_store: string, value: { id: string }) => void mem.settings.set(value.id, structuredClone(value)),
  listActivities: async () => [...mem.activities].sort((a, b) => b.startTime - a.startTime),
  saveActivity: async (a: Activity, points: unknown[]) => {
    mem.activities.push(a);
    mem.tracks.set(a.id, points);
  },
  newId: () => `id-${mem.activities.length + 1}`,
}));
vi.mock('../src/data/shoes', () => ({ defaultShoeId: async () => mem.shoe }));

import {
  authorizeUrl,
  canReadActivities,
  captureStravaRedirect,
  exchangeCode,
  isDuplicate,
  mapSportType,
  parseRateLimit,
  rangeAfter,
  StravaApi,
  StravaError,
  streamsToPoints,
  syncStrava,
  takePendingAuth,
  type FetchFn,
  type StravaSettings,
  type StravaSummary,
} from '../src/data/strava';

const NOW = Date.UTC(2026, 10, 1, 12);
const sec = (ms: number) => Math.floor(ms / 1000);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function connected(extra: Partial<StravaSettings> = {}): StravaSettings {
  return {
    id: 'strava',
    clientId: '123',
    clientSecret: 'shh',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: sec(NOW) + 3600,
    athlete: { id: 9, name: 'Ana' },
    scope: 'read,activity:read_all',
    ...extra,
  };
}

function existing(startTime: number, distance: number, extra: Partial<Activity> = {}): Activity {
  return {
    id: `ex-${startTime}`,
    name: 'Morning Run',
    type: 'run',
    startTime,
    hasStartTime: true,
    fileName: 'run.gpx',
    importedAt: startTime,
    summary: { distance } as ActivitySummary,
    ...extra,
  };
}

/** A straight 1 km line heading north, one point every 6 s, as Strava streams. */
function streams(n = 101, extra: Record<string, unknown> = {}) {
  const idx = Array.from({ length: n }, (_, i) => i);
  return {
    latlng: { data: idx.map((i) => [-23.5 + (i * 0.01) / (n - 1) / 1.11, -46.6]) },
    time: { data: idx.map((i) => i * 6) },
    altitude: { data: idx.map(() => 760) },
    heartrate: { data: idx.map(() => 150) },
    cadence: { data: idx.map(() => 85) },
    ...extra,
  };
}

const summary = (id: number, start: number, extra: Partial<StravaSummary> = {}): StravaSummary => ({
  id,
  name: `Run ${id}`,
  sport_type: 'Run',
  start_date: new Date(start).toISOString(),
  distance: 1000,
  start_latlng: [-23.5, -46.6],
  ...extra,
});

/** A fake Strava API: activity list + per-activity streams (or a Response to return). */
function fakeStrava(list: StravaSummary[], streamFor: (id: number) => unknown) {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/api/v3/athlete/activities') {
      const page = Number(u.searchParams.get('page'));
      return json(page === 1 ? list : []);
    }
    const m = /\/activities\/(\d+)\/streams/.exec(u.pathname);
    if (m) {
      const s = streamFor(Number(m[1]));
      return s instanceof Response ? s : json(s);
    }
    return json({}, 404);
  };
  return { fetchFn, calls };
}

beforeEach(() => {
  mem.settings.clear();
  mem.activities = [];
  mem.tracks.clear();
  mem.shoe = undefined;
  sessionStorage.clear();
});

describe('mapping', () => {
  it('maps run-like sport types and ignores others', () => {
    expect(mapSportType('Run')).toBe('run');
    expect(mapSportType('VirtualRun')).toBe('run');
    expect(mapSportType('TrailRun')).toBe('trail-run');
    expect(mapSportType('Walk')).toBe('walk');
    expect(mapSportType('Hike')).toBe('walk');
    expect(mapSportType('Ride')).toBeNull();
    expect(mapSportType(undefined)).toBeNull();
  });

  it('builds track points from streams', () => {
    const start = Date.UTC(2026, 9, 1, 7);
    const pts = streamsToPoints(
      {
        latlng: { data: [[1, 2], [1.001, 2.001], null as unknown as [number, number], [1.002, 2.002]] },
        time: { data: [0, 5, 10, 15] },
        altitude: { data: [10, 11, 12, 13] },
        heartrate: { data: [0, 140, 141, 142] },
        cadence: { data: [0, 88, 89, 172] },
        temp: { data: [20, 20, 20, 21] },
        watts: { data: [null, 250, 260, 270] },
      },
      start,
    );
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 1, lon: 2, ele: 10, time: start, temp: 20 });
    expect(pts[1]).toEqual({ lat: 1.001, lon: 2.001, ele: 11, time: start + 5000, hr: 140, cad: 176, temp: 20, power: 250 });
    // Already in steps per minute: not doubled again.
    expect(pts[2].cad).toBe(172);
    expect(pts[2].time).toBe(start + 15000);
  });

  it('returns no points without latlng (treadmill)', () => {
    expect(streamsToPoints({ time: { data: [0, 1] } }, 0)).toEqual([]);
  });

  it('detects duplicates by Strava id or by start time and distance', () => {
    const t = Date.UTC(2026, 9, 1, 7);
    const list = [existing(t, 10_000), existing(t + 86_400_000, 5000, { stravaId: 42 })];
    expect(isDuplicate({ stravaId: 42, startTime: 0, distance: 0 }, list)?.stravaId).toBe(42);
    expect(isDuplicate({ stravaId: 1, startTime: t + 45_000, distance: 10_030 }, list)?.startTime).toBe(t);
    expect(isDuplicate({ stravaId: 1, startTime: t + 90_000, distance: 10_000 }, list)).toBeUndefined();
    expect(isDuplicate({ stravaId: 1, startTime: t, distance: 10_080 }, list)).toBeUndefined();
    expect(isDuplicate({ stravaId: 1, startTime: t, distance: 10_080 }, list, 200)).toBeDefined();
  });

  it('computes the range start', () => {
    expect(rangeAfter('all', {}, NOW)).toBe(0);
    expect(rangeAfter('30d', {}, NOW)).toBe(sec(NOW) - 30 * 86_400);
    expect(rangeAfter('12m', {}, NOW)).toBe(sec(NOW) - 365 * 86_400);
    expect(rangeAfter('since-last', { syncCursor: 1234 }, NOW)).toBe(1234);
    expect(rangeAfter('since-last', {}, NOW)).toBe(sec(NOW) - 30 * 86_400);
  });

  it('reads rate-limit headers and scopes', () => {
    const h = new Headers({ 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '20,300', 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '99,500' });
    expect(parseRateLimit(h)).toEqual({ short: [99, 100], daily: [500, 1000] });
    expect(parseRateLimit(new Headers())).toBeUndefined();
    expect(canReadActivities('read,activity:read_all')).toBe(true);
    expect(canReadActivities('read,activity:read')).toBe(true);
    expect(canReadActivities('read')).toBe(false);
  });
});

describe('OAuth', () => {
  it('builds the authorize URL', () => {
    const url = new URL(authorizeUrl('123', 'http://localhost:5173/', 'abc'));
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      response_type: 'code',
      redirect_uri: 'http://localhost:5173/',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state: 'abc',
    });
  });

  it('captures the redirect when the state matches and cleans the URL', () => {
    sessionStorage.setItem('lapwing:strava-state', 'nonce');
    history.replaceState(null, '', '/?state=nonce&code=CODE&scope=read,activity:read_all');
    expect(captureStravaRedirect()).toBe(true);
    expect(location.search).toBe('');
    expect(location.hash).toBe('#/settings');
    expect(takePendingAuth()).toEqual({ code: 'CODE', scope: 'read,activity:read_all' });
    expect(takePendingAuth()).toBeNull();
  });

  it('reports a mismatched state or a denied access', () => {
    sessionStorage.setItem('lapwing:strava-state', 'nonce');
    history.replaceState(null, '', '/?state=other&code=CODE');
    captureStravaRedirect();
    expect(takePendingAuth()).toEqual({ error: 'state' });

    sessionStorage.setItem('lapwing:strava-state', 'nonce');
    history.replaceState(null, '', '/?state=nonce&error=access_denied');
    captureStravaRedirect();
    expect(takePendingAuth()).toEqual({ error: 'denied' });

    history.replaceState(null, '', '/#/routes');
    expect(captureStravaRedirect()).toBe(false);
  });

  it('exchanges the code and saves tokens and athlete', async () => {
    let body: URLSearchParams | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      body = init?.body as URLSearchParams;
      return json({ access_token: 'A', refresh_token: 'R', expires_at: 999, athlete: { id: 7, firstname: 'Ana', lastname: 'Silva' } });
    };
    const s = await exchangeCode({ id: 'strava', clientId: '1', clientSecret: 'x' }, { code: 'C', scope: 'read' }, fetchFn);
    expect(body?.get('grant_type')).toBe('authorization_code');
    expect(body?.get('code')).toBe('C');
    expect(s).toMatchObject({ accessToken: 'A', refreshToken: 'R', expiresAt: 999, athlete: { id: 7, name: 'Ana Silva' }, scope: 'read' });
    expect(mem.settings.get('strava')).toMatchObject({ accessToken: 'A' });
  });

  it('rejects bad credentials', async () => {
    const fetchFn: FetchFn = async () => json({ message: 'Bad Request' }, 400);
    await expect(
      exchangeCode({ id: 'strava', clientId: '1', clientSecret: 'x' }, { code: 'C', scope: '' }, fetchFn),
    ).rejects.toMatchObject({ code: 'credentials' });
  });

  it('refreshes an expired token once and keeps a valid one', async () => {
    const saved: StravaSettings[] = [];
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      urls.push(url);
      if (url.endsWith('/oauth/token')) {
        expect((init?.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
        expect((init?.body as URLSearchParams).get('refresh_token')).toBe('ref');
        return json({ access_token: 'new', refresh_token: 'ref2', expires_at: sec(NOW) + 21600 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer new');
      return json({ ok: true });
    };
    const api = new StravaApi(connected({ expiresAt: sec(NOW) + 30 }), {
      fetch: fetchFn,
      now: () => NOW,
      onTokens: async (s) => void saved.push(s),
    });
    await api.get('/athlete');
    await api.get('/athlete');
    expect(urls.filter((u) => u.endsWith('/oauth/token'))).toHaveLength(1);
    expect(saved[0]).toMatchObject({ accessToken: 'new', refreshToken: 'ref2' });
  });

  it('maps a revoked refresh token and 401s to unauthorized', async () => {
    const expired = new StravaApi(connected({ expiresAt: 0 }), { fetch: async () => json({}, 400), now: () => NOW });
    await expect(expired.get('/athlete')).rejects.toMatchObject({ code: 'unauthorized' });
    const revoked = new StravaApi(connected(), { fetch: async () => json({}, 401), now: () => NOW });
    await expect(revoked.get('/athlete')).rejects.toBeInstanceOf(StravaError);
    await expect(revoked.get('/athlete')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('syncStrava', () => {
  const day = (d: number) => Date.UTC(2026, 9, d, 7);

  it('imports new runs oldest first, skipping duplicates, no-GPS runs and other sports', async () => {
    mem.settings.set('strava', connected());
    mem.shoe = 'shoe-1';
    mem.activities = [existing(day(3) + 20_000, 1010)]; // The same run, imported earlier from GPX.
    const list = [
      summary(4, day(4), { name: 'Long <run>' }),
      summary(1, day(1), { sport_type: 'TrailRun' }),
      summary(2, day(2), { sport_type: 'Ride' }),
      summary(3, day(3)),
      summary(5, day(5), { start_latlng: [] }), // Treadmill: not even downloaded.
      summary(6, day(6)),
    ];
    const { fetchFn, calls } = fakeStrava(list, (id) => (id === 6 ? { time: { data: [0, 1] } } : streams()));
    const progress: string[] = [];
    const res = await syncStrava({ range: 'all', fetch: fetchFn, now: () => NOW, onProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`) });

    expect(res).toMatchObject({ duplicates: 1, skipped: 2, failed: [], total: 5, ignored: 1, cancelled: false });
    expect(res.error).toBeUndefined();
    expect(res.imported.map((a) => a.stravaId)).toEqual([1, 4]);
    const trail = res.imported[0];
    expect(trail).toMatchObject({ type: 'trail-run', source: 'strava', fileName: 'strava-1', shoeId: 'shoe-1', startTime: day(1), hasStartTime: true });
    expect(trail.summary.distance).toBeGreaterThan(950);
    expect(trail.summary.avgCadence).toBe(170);
    expect(res.imported[1].name).toBe('Long <run>');
    expect(mem.tracks.get(trail.id)).toHaveLength(101);
    // Streams were fetched only for runs not known yet and with GPS.
    expect(calls.filter((u) => u.includes('/streams')).map((u) => /activities\/(\d+)/.exec(u)![1])).toEqual(['1', '4', '6']);
    expect(calls[0]).toContain('after=0&per_page=100&page=1');
    expect(progress.at(-1)).toBe('import:5/5');
    const saved = mem.settings.get('strava') as StravaSettings;
    expect(saved.syncCursor).toBe(sec(day(6)));
    expect(saved.lastSyncAt).toBe(NOW);
  });

  it('pages through the activity list', async () => {
    mem.settings.set('strava', connected({ syncCursor: 1000 }));
    const pages: number[] = [];
    const fetchFn: FetchFn = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/athlete/activities')) {
        expect(u.searchParams.get('after')).toBe('1000');
        const page = Number(u.searchParams.get('page'));
        pages.push(page);
        return json(page === 1 ? Array.from({ length: 100 }, (_, i) => summary(i + 1, day(1) + i * 1000, { sport_type: 'Ride' })) : []);
      }
      return json({}, 404);
    };
    const res = await syncStrava({ range: 'since-last', fetch: fetchFn, now: () => NOW });
    expect(pages).toEqual([1, 2]);
    expect(res).toMatchObject({ total: 0, ignored: 100 });
  });

  it('stops on a rate limit and resumes from the last handled run', async () => {
    mem.settings.set('strava', connected());
    const list = [summary(1, day(1)), summary(2, day(2)), summary(3, day(3))];
    const { fetchFn } = fakeStrava(list, (id) =>
      id === 2 ? json({}, 429, { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '101,300' }) : streams(),
    );
    const res = await syncStrava({ range: '30d', fetch: fetchFn, now: () => NOW });
    expect(res.error).toBe('rate-limit');
    expect(res.usage).toEqual({ short: [101, 100], daily: [300, 1000] });
    expect(res.imported.map((a) => a.stravaId)).toEqual([1]);
    expect((mem.settings.get('strava') as StravaSettings).syncCursor).toBe(sec(day(1)));

    // Next time: the already imported run is recognized without downloading it again.
    const second = fakeStrava(list, () => streams());
    const again = await syncStrava({ range: '30d', fetch: second.fetchFn, now: () => NOW });
    expect(again.imported.map((a) => a.stravaId)).toEqual([2, 3]);
    expect(again.duplicates).toBe(1);
  });

  it('keeps failed runs for the next sync', async () => {
    mem.settings.set('strava', connected());
    const list = [summary(1, day(1)), summary(2, day(2)), summary(3, day(3))];
    const { fetchFn } = fakeStrava(list, (id) => (id === 2 ? json({}, 500) : streams()));
    const res = await syncStrava({ range: '30d', fetch: fetchFn, now: () => NOW });
    expect(res.failed).toEqual([{ id: 2, name: 'Run 2' }]);
    expect(res.imported.map((a) => a.stravaId)).toEqual([1, 3]);
    expect((mem.settings.get('strava') as StravaSettings).syncCursor).toBe(sec(day(1)));
  });

  it('refreshes the token during a sync and saves it with the cursor', async () => {
    mem.settings.set('strava', connected({ expiresAt: 0 }));
    const { fetchFn: api } = fakeStrava([summary(1, day(1))], () => streams());
    const fetchFn: FetchFn = async (url, init) =>
      url.endsWith('/oauth/token') ? json({ access_token: 'new', refresh_token: 'ref2', expires_at: sec(NOW) + 21600 }) : api(url, init);
    const res = await syncStrava({ range: '30d', fetch: fetchFn, now: () => NOW });
    expect(res.imported).toHaveLength(1);
    expect(mem.settings.get('strava')).toMatchObject({ accessToken: 'new', refreshToken: 'ref2', syncCursor: sec(day(1)) });
  });

  it('reports unauthorized, network errors and cancellation', async () => {
    mem.settings.set('strava', connected());
    expect((await syncStrava({ range: '30d', fetch: async () => json({}, 401), now: () => NOW })).error).toBe('unauthorized');
    const offline: FetchFn = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect((await syncStrava({ range: '30d', fetch: offline, now: () => NOW })).error).toBe('network');

    const controller = new AbortController();
    const { fetchFn } = fakeStrava([summary(1, day(1)), summary(2, day(2))], () => streams());
    const res = await syncStrava({
      range: '30d',
      fetch: fetchFn,
      signal: controller.signal,
      now: () => NOW,
      onProgress: (p) => {
        if (p.phase === 'import' && p.done === 1) controller.abort();
      },
    });
    expect(res.cancelled).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.imported).toHaveLength(1);
  });

  it('needs a connection', async () => {
    expect((await syncStrava({ range: 'all', fetch: async () => json([]) })).error).toBe('not-connected');
  });
});
