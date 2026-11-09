import { beforeEach, describe, expect, it, vi } from 'vitest';

// Two in-memory "devices" standing in for IndexedDB (no fake-indexeddb here):
// `mem.current` picks whose database the db module reads and writes.
const mem = vi.hoisted(() => {
  const STORES = ['activities', 'tracks', 'plans', 'workouts', 'settings', 'shoes', 'goals'] as const;
  type DB = Map<string, Map<unknown, { id: unknown } & Record<string, unknown>>>;
  const fresh = (): DB => new Map(STORES.map((s) => [s, new Map()]));
  const state = { STORES, dbs: { A: fresh(), B: fresh() } as Record<string, DB>, current: 'A', fresh };
  return state;
});

vi.mock('../src/data/db', () => {
  const db = () => mem.dbs[mem.current];
  return {
    STORES: [...mem.STORES],
    setWriteHook: () => {},
    listKeys: async (store: string) => [...db().get(store)!.keys()],
    getMany: async (store: string, ids: unknown[]) => ids.map((id) => structuredClone(db().get(store)!.get(id))),
    applyRemoteChanges: async (changes: { store: string; id: unknown; deleted: boolean; data?: { id: unknown } }[]) => {
      for (const c of changes) {
        if (c.deleted) db().get(c.store)!.delete(c.id);
        else db().get(c.store)!.set(c.id, structuredClone(c.data!));
      }
    },
  };
});

import { SyncAuthError, SyncEngine } from '../src/data/sync';

/** A small in-memory copy of sync/server.py. */
function fakeServer() {
  const s = {
    epoch: 'e1',
    seq: 0,
    rows: new Map<string, { store: string; id: unknown; seq: number; device: string; deleted: boolean; data?: unknown }>(),
    pushes: 0,
    loginRedirect: false,
    pageRows: 500,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch: typeof globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (s.loginRedirect) return { type: 'opaqueredirect', status: 0, ok: false } as Response;
    const url = new URL(String(input), 'https://run.example');
    if (url.pathname === '/api/sync/status') return json({ app: 'lapwing-sync', protocol: 1, epoch: s.epoch, seq: s.seq });
    if (url.pathname === '/api/sync/push' && init.method === 'POST') {
      s.pushes++;
      const body = JSON.parse(String(init.body)) as {
        device: string;
        changes: { store: string; id: unknown; deleted: boolean; data?: unknown }[];
      };
      for (const c of body.changes) {
        s.rows.set(`${c.store}|${JSON.stringify(c.id)}`, { ...c, seq: ++s.seq, device: body.device });
      }
      return json({ seq: s.seq });
    }
    if (url.pathname === '/api/sync/changes') {
      const since = Number(url.searchParams.get('since'));
      const device = url.searchParams.get('device');
      const rows = [...s.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      const page = rows.slice(0, s.pageRows);
      return json({
        epoch: s.epoch,
        changes: page
          .filter((r) => r.device !== device)
          .map((r) => (r.deleted ? { store: r.store, id: r.id, deleted: true } : { store: r.store, id: r.id, deleted: false, data: r.data })),
        next: page.length ? page[page.length - 1].seq : since,
        more: rows.length > page.length,
      });
    }
    return new Response('<!doctype html>', { status: 404 });
  };
  return { s, fetch: fakeFetch };
}

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let server: ReturnType<typeof fakeServer>;
const storages: Record<string, Storage> = {};

function device(name: 'A' | 'B') {
  storages[name] ??= memStorage();
  const engine = new SyncEngine({ fetch: server.fetch, storage: storages[name], compress: false });
  const on = <T>(fn: () => Promise<T>) => async () => {
    mem.current = name;
    return fn();
  };
  const put = (store: string, rec: { id: unknown } & Record<string, unknown>) => {
    mem.dbs[name].get(store)!.set(rec.id, rec);
    engine.record(store as never, [rec.id as IDBValidKey]);
  };
  const del = (store: string, id: unknown) => {
    mem.dbs[name].get(store)!.delete(id);
    engine.record(store as never, [id as IDBValidKey]);
  };
  return {
    engine,
    probe: on(() => engine.probe()),
    sync: on(() => engine.sync()),
    put,
    del,
    db: (store: string) => mem.dbs[name].get(store)!,
  };
}

beforeEach(() => {
  server = fakeServer();
  mem.dbs = { A: mem.fresh(), B: mem.fresh() };
  for (const k of Object.keys(storages)) delete storages[k];
});

describe('SyncEngine', () => {
  it('stays off on a site without a sync server', async () => {
    const e = new SyncEngine({ fetch: (async () => new Response('<!doctype html>', { status: 404 })) as typeof fetch, storage: memStorage() });
    expect(await e.probe()).toBe(false);
    expect(e.status.state).toBe('off');
    await e.sync(); // a no-op
    const html = new SyncEngine({ fetch: (async () => new Response('<!doctype html>')) as typeof fetch, storage: memStorage() });
    expect(await html.probe()).toBe(false);
  });

  it('sends what a device already had and brings it to another device', async () => {
    const a = device('A');
    mem.dbs.A.get('activities')!.set('r1', { id: 'r1', name: 'Longão' });
    mem.dbs.A.get('tracks')!.set('r1', { id: 'r1', points: [[1, 2]] });
    expect(await a.probe()).toBe(true);
    expect(a.engine.status.pending).toBe(2);
    await a.sync();
    expect(a.engine.status).toMatchObject({ state: 'idle', pending: 0 });
    expect(a.engine.status.lastSync).not.toBeNull();

    const b = device('B');
    await b.probe();
    await b.sync();
    expect(b.db('activities').get('r1')).toEqual({ id: 'r1', name: 'Longão' });
    expect(b.db('tracks').get('r1')).toEqual({ id: 'r1', points: [[1, 2]] });
  });

  it('syncs edits and deletions both ways', async () => {
    const a = device('A');
    const b = device('B');
    await a.probe();
    await b.probe();
    a.put('goals', { id: 'g1', km: 30 });
    await a.sync();
    await b.sync();
    expect(b.db('goals').get('g1')).toEqual({ id: 'g1', km: 30 });

    b.put('goals', { id: 'g1', km: 40 });
    await b.sync();
    await a.sync();
    expect(a.db('goals').get('g1')).toEqual({ id: 'g1', km: 40 });

    a.del('goals', 'g1');
    await a.sync();
    await b.sync();
    expect(b.db('goals').has('g1')).toBe(false);
  });

  it('keeps a local edit not sent yet over the server copy', async () => {
    const a = device('A');
    const b = device('B');
    await a.probe();
    await b.probe();
    a.put('plans', { id: 'p', v: 'from A' });
    await a.sync();
    mem.dbs.B.get('plans')!.set('p', { id: 'p', v: 'from B' });
    b.engine.record('plans', ['p']);
    await b.sync(); // pushes B's version; A's must not overwrite it
    expect(b.db('plans').get('p')).toEqual({ id: 'p', v: 'from B' });
    await a.sync();
    expect(a.db('plans').get('p')).toEqual({ id: 'p', v: 'from B' });
  });

  it('never sends or applies the Strava login', async () => {
    const a = device('A');
    a.db('settings').set('strava', { id: 'strava', refreshToken: 'secret' });
    a.db('settings').set('athlete', { id: 'athlete', maxHr: 190 });
    await a.probe();
    await a.sync();
    expect([...server.s.rows.keys()]).toEqual(['settings|"athlete"']);

    server.s.rows.set('settings|"strava"', { store: 'settings', id: 'strava', seq: ++server.s.seq, device: 'X', deleted: false, data: { id: 'strava', refreshToken: 'other' } });
    await a.sync();
    expect(a.db('settings').get('strava')).toEqual({ id: 'strava', refreshToken: 'secret' });
  });

  it('sends large outboxes in several requests and reads paged changes', async () => {
    const a = device('A');
    await a.probe();
    for (let i = 0; i < 450; i++) a.put('goals', { id: `g${i}`, i });
    await a.sync();
    expect(server.s.pushes).toBe(3);
    expect(server.s.rows.size).toBe(450);

    server.s.pageRows = 100;
    const b = device('B');
    await b.probe();
    await b.sync();
    expect(b.db('goals').size).toBe(450);
  });

  it('keeps a key changed while its push was in flight', async () => {
    mem.current = 'A';
    mem.dbs.A.get('goals')!.set('g', { id: 'g', v: 1 });
    let e: SyncEngine;
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // The record changes again while its first version is on the wire.
      if (String(input).endsWith('/push')) e.record('goals', ['g']);
      return server.fetch(input, init);
    }) as typeof fetch;
    e = new SyncEngine({ fetch: racing, storage: memStorage(), compress: false });
    await e.probe();
    await e.sync();
    expect(server.s.pushes).toBeGreaterThanOrEqual(1);
    expect(e.status.pending).toBe(1);
  });

  it('reports an expired sign-in', async () => {
    const a = device('A');
    await a.probe();
    server.s.loginRedirect = true;
    await expect(a.sync()).rejects.toBeInstanceOf(SyncAuthError);
    expect(a.engine.status.state).toBe('auth');
    const fresh = new SyncEngine({ fetch: server.fetch, storage: memStorage() });
    expect(await fresh.probe()).toBe(true);
    expect(fresh.status.state).toBe('auth');
  });

  it('resends everything when the server was reset', async () => {
    const a = device('A');
    await a.probe();
    a.put('goals', { id: 'g', v: 1 });
    await a.sync();
    server.s.rows.clear();
    server.s.seq = 0;
    server.s.epoch = 'e2';
    await a.sync();
    expect([...server.s.rows.keys()]).toEqual(['goals|"g"']);
  });
});
