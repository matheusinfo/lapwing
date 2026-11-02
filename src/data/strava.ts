/**
 * Optional Strava sync. There is no backend: the user registers their own
 * Strava API application and enters its Client ID and Secret, which are kept
 * (with the OAuth tokens) only in this browser, in the `settings` store as
 * the record `{ id: 'strava', ... }`.
 *
 * Flow:
 * 1. `startAuthorization()` sends the browser to Strava's consent page.
 * 2. Strava returns to `origin + pathname?state=…&code=…`. `main.ts` calls
 *    `captureStravaRedirect()` before the first render: it keeps the code in
 *    sessionStorage, cleans the URL and opens `#/settings`.
 * 3. The settings screen calls `takePendingAuth()` + `exchangeCode()`.
 * 4. `syncStrava()` lists new runs and imports their streams as activities.
 *
 * Network access goes through an injectable `fetch` so the logic is testable.
 */
import { computeSummary } from './analysis';
import { get, listActivities, newId, put, saveActivity } from './db';
import { defaultShoeId } from './shoes';
import type { Activity, ActivityType, TrackPoint } from './types';

export const STRAVA_ID = 'strava';
const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const API = 'https://www.strava.com/api/v3';
export const STRAVA_SCOPE = 'read,activity:read_all';
const STATE_KEY = 'lapwing:strava-state';
const PENDING_KEY = 'lapwing:strava-pending';
const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

/** The `settings` store record for Strava. */
export interface StravaSettings {
  id: typeof STRAVA_ID;
  clientId: string;
  /** Missing in records restored from a backup made without secrets. */
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  /** When the access token expires, in epoch seconds (as Strava sends it). */
  expiresAt?: number;
  athlete?: { id: number; name: string };
  /** Scopes the athlete granted, e.g. "read,activity:read_all". */
  scope?: string;
  /** Epoch ms of the last sync that made progress or finished. */
  lastSyncAt?: number;
  /**
   * Start time (epoch seconds) of the newest Strava activity already handled.
   * "Since last sync" lists activities after it, so an interrupted sync resumes.
   */
  syncCursor?: number;
}

export type StravaErrorCode =
  | 'unauthorized' // token rejected or revoked: reconnect
  | 'credentials' // client id/secret rejected
  | 'rate-limit'
  | 'network'
  | 'http'
  | 'aborted'
  | 'denied' // the athlete refused access on Strava
  | 'state' // the redirect didn't match a sign-in started here
  | 'not-connected';

export interface RateUsage {
  /** Requests used / allowed in the current 15-minute window. */
  short: [number, number];
  /** Requests used / allowed today. */
  daily: [number, number];
}

export class StravaError extends Error {
  readonly code: StravaErrorCode;
  readonly status?: number;
  readonly usage?: RateUsage;
  constructor(code: StravaErrorCode, status?: number, usage?: RateUsage) {
    super(`Strava: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'StravaError';
    this.code = code;
    this.status = status;
    this.usage = usage;
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchFn = (input, init) => fetch(input, init);

// ---- Settings ----

export const loadStrava = () => get<StravaSettings>('settings', STRAVA_ID);
export const saveStrava = (s: StravaSettings) => put('settings', s);

/** Connected = has tokens. A record with only a client id (e.g. restored without secrets) is not. */
export const isConnected = (s: StravaSettings | undefined): s is StravaSettings & { accessToken: string } =>
  !!s?.accessToken && !!s.refreshToken && !!s.clientSecret;

/** Whether the granted scopes allow reading activities. */
export const canReadActivities = (scope: string | undefined) =>
  scope === undefined || /(^|,)activity:read(_all)?(,|$)/.test(scope);

/** The same record without tokens or athlete (credentials kept for reconnecting). */
export function withoutTokens(s: StravaSettings): StravaSettings {
  const next: StravaSettings = { id: STRAVA_ID, clientId: s.clientId };
  if (s.clientSecret) next.clientSecret = s.clientSecret;
  return next;
}

// ---- OAuth ----

/** Where Strava sends the browser back: this page without query or hash. */
export const redirectUri = (loc: Location = window.location) => loc.origin + loc.pathname;

export function authorizeUrl(clientId: string, redirect: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sends the browser to Strava's consent page. */
export function startAuthorization(clientId: string): void {
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  window.location.assign(authorizeUrl(clientId, redirectUri(), state));
}

export type PendingAuth = { code: string; scope: string } | { error: 'denied' | 'state' };

/**
 * Call once at startup. If the URL is a Strava redirect (`?state=…&code=…`
 * or `?state=…&error=…`), remembers the outcome for the settings screen,
 * removes the query from the address bar and opens `#/settings`.
 * Returns whether it handled a redirect.
 */
export function captureStravaRedirect(): boolean {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  if (!state || (!code && !error)) return false;

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // Storage blocked: treated as a mismatch below.
  }
  let pending: PendingAuth;
  if (!expected || expected !== state) pending = { error: 'state' };
  else if (error || !code) pending = { error: 'denied' };
  else pending = { code, scope: params.get('scope') ?? '' };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Nothing else we can do; the settings screen just shows "not connected".
  }
  // Don't leave the one-time code in the address bar or history.
  history.replaceState(history.state, '', window.location.pathname + '#/settings');
  return true;
}

/** The outcome saved by `captureStravaRedirect`, removed once read. */
export function takePendingAuth(): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

function isAbort(err: unknown, signal?: AbortSignal) {
  return signal?.aborted || (err instanceof Error && err.name === 'AbortError');
}

/** Reads Strava's rate-limit headers (read limits preferred), if exposed. */
export function parseRateLimit(headers: Headers): RateUsage | undefined {
  const pick = (name: string) => headers.get(`X-ReadRateLimit-${name}`) ?? headers.get(`X-RateLimit-${name}`);
  const usage = pick('Usage')?.split(',').map(Number);
  const limit = pick('Limit')?.split(',').map(Number);
  if (!usage || !limit || usage.length < 2 || limit.length < 2 || [...usage, ...limit].some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return { short: [usage[0], limit[0]], daily: [usage[1], limit[1]] };
}

async function send(fetchFn: FetchFn, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new StravaError('aborted');
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal });
  } catch (err) {
    throw new StravaError(isAbort(err, signal) ? 'aborted' : 'network');
  }
  if (res.status === 429) throw new StravaError('rate-limit', 429, parseRateLimit(res.headers));
  return res;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string; username?: string };
}

async function tokenRequest(
  fetchFn: FetchFn,
  body: Record<string, string>,
  rejected: StravaErrorCode,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  // Form encoding keeps this a "simple" CORS request (no preflight).
  const res = await send(fetchFn, TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) }, signal);
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new StravaError(rejected, res.status);
  if (!res.ok) throw new StravaError('http', res.status);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) throw new StravaError('http', res.status);
  return data;
}

const athleteName = (a: NonNullable<TokenResponse['athlete']>) =>
  [a.firstname, a.lastname].filter(Boolean).join(' ').trim() || a.username || String(a.id);

/** Trades the one-time code for tokens. Returns (and saves) the connected settings. */
export async function exchangeCode(
  settings: StravaSettings,
  pending: { code: string; scope: string },
  fetchFn: FetchFn = defaultFetch,
): Promise<StravaSettings> {
  const data = await tokenRequest(
    fetchFn,
    {
      client_id: settings.clientId,
      client_secret: settings.clientSecret ?? '',
      code: pending.code,
      grant_type: 'authorization_code',
    },
    'credentials',
  );
  const next: StravaSettings = {
    ...settings,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    scope: pending.scope || undefined,
    athlete: data.athlete ? { id: data.athlete.id, name: athleteName(data.athlete) } : settings.athlete,
  };
  // A different athlete than before: start syncing from scratch.
  if (settings.athlete && next.athlete && settings.athlete.id !== next.athlete.id) {
    delete next.syncCursor;
    delete next.lastSyncAt;
  }
  await saveStrava(next);
  return next;
}

/** Revokes access on Strava (best effort) and forgets the tokens. */
export async function disconnect(settings: StravaSettings, fetchFn: FetchFn = defaultFetch): Promise<StravaSettings> {
  if (settings.accessToken) {
    try {
      await fetchFn(DEAUTHORIZE_URL, {
        method: 'POST',
        body: new URLSearchParams({ access_token: settings.accessToken }),
      });
    } catch {
      // Offline or already revoked: forgetting the tokens locally is what matters.
    }
  }
  const next = withoutTokens(settings);
  await saveStrava(next);
  return next;
}

/**
 * Authenticated API access. Refreshes the access token when it is about to
 * expire and saves the new tokens through `onTokens`.
 */
export class StravaApi {
  settings: StravaSettings;
  /** Latest rate-limit usage seen in a response, if Strava exposes it. */
  usage?: RateUsage;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly onTokens: (s: StravaSettings) => Promise<void>;

  constructor(
    settings: StravaSettings,
    opts: { fetch?: FetchFn; now?: () => number; onTokens?: (s: StravaSettings) => Promise<void> } = {},
  ) {
    this.settings = settings;
    this.fetchFn = opts.fetch ?? defaultFetch;
    this.now = opts.now ?? Date.now;
    this.onTokens = opts.onTokens ?? saveStrava;
  }

  /** A valid access token, refreshing it first if it expires within a minute. */
  async token(signal?: AbortSignal): Promise<string> {
    const s = this.settings;
    if (!s.accessToken || !s.refreshToken) throw new StravaError('not-connected');
    if (s.expiresAt !== undefined && s.expiresAt - 60 > this.now() / 1000) return s.accessToken;
    const data = await tokenRequest(
      this.fetchFn,
      {
        client_id: s.clientId,
        client_secret: s.clientSecret ?? '',
        refresh_token: s.refreshToken,
        grant_type: 'refresh_token',
      },
      'unauthorized',
      signal,
    );
    this.settings = { ...s, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at };
    await this.onTokens(this.settings);
    return data.access_token;
  }

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const token = await this.token(signal);
    const res = await send(this.fetchFn, API + path, { headers: { Authorization: `Bearer ${token}` } }, signal);
    this.usage = parseRateLimit(res.headers) ?? this.usage;
    if (res.status === 401) throw new StravaError('unauthorized', 401);
    if (!res.ok) throw new StravaError('http', res.status);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new StravaError(isAbort(err, signal) ? 'aborted' : 'network');
    }
  }
}

// ---- Mapping (pure) ----

/** The fields of Strava's SummaryActivity that the sync uses. */
export interface StravaSummary {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  start_date: string;
  distance: number;
  manual?: boolean;
  start_latlng?: number[] | null;
}

type Stream<T> = { data: T[] } | undefined;
export interface StravaStreams {
  latlng?: Stream<[number, number]>;
  time?: Stream<number>;
  altitude?: Stream<number>;
  heartrate?: Stream<number>;
  cadence?: Stream<number>;
  temp?: Stream<number>;
  watts?: Stream<number | null>;
  distance?: Stream<number>;
}

/** Strava sport type → activity type, or null for sports the app doesn't track. */
export function mapSportType(sport: string | undefined): ActivityType | null {
  switch (sport) {
    case 'Run':
    case 'VirtualRun':
      return 'run';
    case 'TrailRun':
      return 'trail-run';
    case 'Walk':
    case 'Hike':
      return 'walk';
    default:
      return null;
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Builds track points from Strava streams (`key_by_type=true`). Points
 * without coordinates are dropped. Cadence is doubled to steps per minute
 * (Strava, like GPX files, stores one foot), as in the GPX parser.
 */
export function streamsToPoints(streams: StravaStreams, startMs: number): TrackPoint[] {
  const latlng = streams.latlng?.data ?? [];
  const time = streams.time?.data;
  const ele = streams.altitude?.data;
  const hr = streams.heartrate?.data;
  const cad = streams.cadence?.data;
  const temp = streams.temp?.data;
  const watts = streams.watts?.data;
  const points: TrackPoint[] = [];
  for (let i = 0; i < latlng.length; i++) {
    const ll = latlng[i];
    if (!ll || !finite(ll[0]) || !finite(ll[1])) continue;
    const p: TrackPoint = { lat: ll[0], lon: ll[1] };
    const e = ele?.[i], t = time?.[i], h = hr?.[i], c = cad?.[i], tc = temp?.[i], w = watts?.[i];
    if (finite(e)) p.ele = e;
    if (finite(t)) p.time = startMs + t * 1000;
    if (finite(h) && h > 0) p.hr = h;
    if (finite(c) && c > 0) p.cad = c < 130 ? c * 2 : c;
    if (finite(tc)) p.temp = tc;
    if (finite(w) && w >= 0) p.power = w;
    points.push(p);
  }
  return points;
}

/**
 * An existing activity that is the same run: the same Strava id, or a start
 * within 60 s and a distance within `tolerance` metres (e.g. the run was
 * imported earlier from a GPX file).
 */
export function isDuplicate(
  candidate: { stravaId: number; startTime: number; distance: number },
  existing: Activity[],
  tolerance = 50,
): Activity | undefined {
  return (
    existing.find((a) => a.stravaId === candidate.stravaId) ??
    existing.find(
      (a) =>
        a.hasStartTime &&
        Math.abs(a.startTime - candidate.startTime) <= 60_000 &&
        Math.abs(a.summary.distance - candidate.distance) < tolerance,
    )
  );
}

export type SyncRange = 'since-last' | '30d' | '12m' | 'all';

/** The `after` parameter (epoch seconds) for a sync range. */
export function rangeAfter(range: SyncRange, settings: Pick<StravaSettings, 'syncCursor'>, now = Date.now()): number {
  switch (range) {
    case 'since-last':
      return settings.syncCursor ?? Math.floor((now - 30 * DAY_MS) / 1000);
    case '30d':
      return Math.floor((now - 30 * DAY_MS) / 1000);
    case '12m':
      return Math.floor((now - 365 * DAY_MS) / 1000);
    case 'all':
      return 0;
  }
}

// ---- Sync ----

export interface SyncProgress {
  phase: 'list' | 'import';
  /** Activities handled so far (import phase) or listed so far (list phase). */
  done: number;
  /** Run-like activities to handle (0 while listing). */
  total: number;
}

export interface SyncResult {
  imported: Activity[];
  duplicates: number;
  /** Runs without GPS data (treadmill, manual entries). */
  skipped: number;
  failed: { id: number; name: string }[];
  /** Run-like activities found in the range. */
  total: number;
  /** Other sports in the range, not imported. */
  ignored: number;
  cancelled: boolean;
  /** Why the sync stopped early, if it did (not set when cancelled). */
  error?: StravaErrorCode;
  usage?: RateUsage;
}

export interface SyncOptions {
  range: SyncRange;
  fetch?: FetchFn;
  signal?: AbortSignal;
  now?: () => number;
  onProgress?: (p: SyncProgress) => void;
}

const STREAM_KEYS = 'latlng,time,altitude,heartrate,cadence,temp,watts,distance';

/**
 * Imports new runs from Strava, oldest first. Saves the sync cursor after each
 * handled activity so an interrupted sync resumes. Rate limits, revoked
 * access and network errors stop the sync and are reported in `error`.
 */
export async function syncStrava(opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? Date.now;
  const { signal, onProgress } = opts;
  const result: SyncResult = { imported: [], duplicates: 0, skipped: 0, failed: [], total: 0, ignored: 0, cancelled: false };

  const stored = await loadStrava();
  if (!isConnected(stored)) return { ...result, error: 'not-connected' };
  let settings: StravaSettings = stored;
  const save = async (s: StravaSettings) => {
    settings = s;
    await saveStrava(s);
  };
  // Token refreshes update `settings` too, so later saves keep the new tokens.
  const api = new StravaApi(settings, { fetch: opts.fetch, now, onTokens: (s) => save({ ...settings, ...tokenFields(s) }) });

  try {
    // 1. List everything in the range (Strava returns pages of up to 100).
    const after = rangeAfter(opts.range, settings, now());
    const listed: StravaSummary[] = [];
    for (let page = 1; ; page++) {
      onProgress?.({ phase: 'list', done: listed.length, total: 0 });
      const batch = await api.get<StravaSummary[]>(
        `/athlete/activities?after=${after}&per_page=${PAGE_SIZE}&page=${page}`,
        signal,
      );
      listed.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    const runs = listed
      .map((a) => ({ a, type: mapSportType(a.sport_type ?? a.type), start: Date.parse(a.start_date) }))
      .filter((r): r is { a: StravaSummary; type: ActivityType; start: number } => r.type !== null && Number.isFinite(r.start))
      .sort((x, y) => x.start - y.start);
    result.ignored = listed.length - runs.length;
    result.total = runs.length;

    // 2. Import each one.
    const existing = await listActivities();
    const shoeId = runs.length ? await defaultShoeId() : undefined;
    // After a failure the cursor stops moving, so the failed run is retried next time.
    let cursorFrozen = false;
    let done = 0;
    for (const { a, type, start } of runs) {
      if (signal?.aborted) throw new StravaError('aborted');
      onProgress?.({ phase: 'import', done, total: runs.length });
      const outcome = await importOne(api, a, type, start, existing, shoeId, now(), signal);
      if (outcome === 'failed') {
        result.failed.push({ id: a.id, name: a.name });
        cursorFrozen = true;
      } else if (outcome === 'duplicate') result.duplicates++;
      else if (outcome === 'skipped') result.skipped++;
      else {
        result.imported.push(outcome);
        existing.push(outcome);
      }
      done++;
      if (!cursorFrozen) {
        const startSec = Math.floor(start / 1000);
        await save({ ...settings, syncCursor: Math.max(settings.syncCursor ?? 0, startSec), lastSyncAt: now() });
      }
    }
    onProgress?.({ phase: 'import', done, total: runs.length });
    await save({ ...settings, lastSyncAt: now() });
  } catch (err) {
    if (!(err instanceof StravaError)) throw err;
    if (err.code === 'aborted') result.cancelled = true;
    else result.error = err.code;
    if (err.usage) api.usage = err.usage;
  }
  result.usage = api.usage;
  return result;
}

const tokenFields = (s: StravaSettings) => ({
  accessToken: s.accessToken,
  refreshToken: s.refreshToken,
  expiresAt: s.expiresAt,
});

async function importOne(
  api: StravaApi,
  a: StravaSummary,
  type: ActivityType,
  start: number,
  existing: Activity[],
  shoeId: string | undefined,
  now: number,
  signal?: AbortSignal,
): Promise<Activity | 'duplicate' | 'skipped' | 'failed'> {
  // Check before downloading streams to save API requests. Strava computes
  // its distance differently from the GPS sum, so allow a little more slack.
  if (isDuplicate({ stravaId: a.id, startTime: start, distance: a.distance }, existing, Math.max(50, a.distance * 0.02))) {
    return 'duplicate';
  }
  if (a.manual || (Array.isArray(a.start_latlng) && a.start_latlng.length === 0)) return 'skipped';

  let streams: StravaStreams;
  try {
    streams = await api.get<StravaStreams>(`/activities/${a.id}/streams?keys=${STREAM_KEYS}&key_by_type=true`, signal);
  } catch (err) {
    // Stop for rate limits, auth, network and cancel; a single bad activity just fails.
    if (err instanceof StravaError && err.code === 'http') return err.status === 404 ? 'skipped' : 'failed';
    throw err;
  }
  const points = streamsToPoints(streams, start);
  if (points.length < 2) return 'skipped';

  const summary = computeSummary(points);
  if (isDuplicate({ stravaId: a.id, startTime: start, distance: summary.distance }, existing)) return 'duplicate';

  const activity: Activity = {
    id: newId(),
    name: a.name?.trim() || `Strava ${a.id}`,
    type,
    startTime: start,
    hasStartTime: true,
    fileName: `strava-${a.id}`,
    importedAt: now,
    summary,
    source: 'strava',
    stravaId: a.id,
  };
  if (shoeId) activity.shoeId = shoeId;
  try {
    await saveActivity(activity, points);
  } catch {
    return 'failed';
  }
  return activity;
}
