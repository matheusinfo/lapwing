import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the IndexedDB module (no fake-indexeddb here).
const mem = vi.hoisted(() => {
  const STORES = ['activities', 'tracks', 'plans', 'workouts', 'settings', 'shoes', 'goals'] as const;
  const data = new Map<string, Map<unknown, { id: unknown }>>();
  const reset = () => STORES.forEach((s) => data.set(s, new Map()));
  reset();
  return { STORES, data, reset, notified: [] as string[] };
});

vi.mock('../src/data/db', () => ({
  STORES: [...mem.STORES],
  SCHEMA_VERSION: 2,
  readStores: async (stores: string[]) =>
    Object.fromEntries(stores.map((s) => [s, [...mem.data.get(s)!.values()].map((r) => structuredClone(r))])),
  get: async (store: string, id: string) => structuredClone(mem.data.get(store)!.get(id)),
  bulkWrite: async (writes: { store: string; records: { id: unknown }[] }[], opts: { replace?: boolean } = {}) => {
    const stores = [...new Set(writes.map((w) => w.store))];
    if (opts.replace) stores.forEach((s) => mem.data.get(s)!.clear());
    for (const w of writes) w.records.forEach((r) => mem.data.get(w.store)!.set(r.id, structuredClone(r)));
    mem.notified.push(...stores);
  },
}));

import {
  BackupError,
  backupFileName,
  createBackup,
  encodeBackup,
  isGzip,
  parseBackupFile,
  planRestore,
  restoreBackup,
  stripSecrets,
  summarizeBackup,
  validateBackup,
  type BackupFile,
} from '../src/data/backup';

const STRAVA = {
  id: 'strava',
  clientId: '123',
  clientSecret: 'shh',
  accessToken: 'acc',
  refreshToken: 'ref',
  athleteName: 'Ana',
};

function seed(store: string, ...records: { id: string; [k: string]: unknown }[]) {
  records.forEach((r) => mem.data.get(store)!.set(r.id, r));
}
const all = (store: string) => [...mem.data.get(store)!.values()];

function backup(stores: Record<string, { id: string | number; [k: string]: unknown }[]>, extra: object = {}): BackupFile {
  return validateBackup({ app: 'lapwing', format: 1, dbVersion: 2, exportedAt: '2026-11-01T10:00:00.000Z', stores, ...extra });
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof BackupError ? err.code : 'other';
  }
  return 'none';
};

let storage: Map<string, string>;
beforeEach(() => {
  mem.reset();
  mem.notified.length = 0;
  storage = new Map();
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
  });
});

describe('validateBackup', () => {
  it('rejects files that are not backups', () => {
    expect(codeOf(() => validateBackup(null))).toBe('not-a-backup');
    expect(codeOf(() => validateBackup([1, 2]))).toBe('not-a-backup');
    expect(codeOf(() => validateBackup({ type: 'FeatureCollection' }))).toBe('not-a-backup');
    expect(codeOf(() => validateBackup({ app: 'other-app', format: 1, stores: {} }))).toBe('not-a-backup');
  });

  it('rejects backups from a newer format', () => {
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: 2, stores: {} }))).toBe('newer-format');
  });

  it('rejects malformed backups', () => {
    expect(codeOf(() => validateBackup({ app: 'lapwing', stores: {} }))).toBe('malformed');
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: '1', stores: {} }))).toBe('malformed');
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: 1 }))).toBe('malformed');
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: 1, stores: { plans: {} } }))).toBe('malformed');
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: 1, stores: { plans: [{ name: 'x' }] } }))).toBe(
      'malformed',
    );
    expect(codeOf(() => validateBackup({ app: 'lapwing', format: 1, stores: { plans: [null] } }))).toBe('malformed');
  });

  it('accepts a valid backup, keeps only prefixed string localStorage keys and reports unknown stores', () => {
    const b = backup(
      { activities: [{ id: 'a1' }], tracks: [{ id: 'a1', points: [] }], laps: [{ whatever: true } as never] },
      { localStorage: { 'lapwing:lang': 'pt-BR', other: 'x', 'lapwing:n': 5 } },
    );
    expect(b.localStorage).toEqual({ 'lapwing:lang': 'pt-BR' });
    const s = summarizeBackup(b);
    expect(s.counts.activities).toBe(1);
    expect(s.counts.plans).toBe(0);
    expect(s.unknownStores).toEqual(['laps']);
    expect(s.exportedAt).toBe(Date.parse('2026-11-01T10:00:00.000Z'));
    expect(s.newerSchema).toBe(false);
    expect(summarizeBackup(backup({}, { dbVersion: 9 })).newerSchema).toBe(true);
  });

  it('accepts backups made before the rename to Lapwing and renames their localStorage keys', () => {
    const b = validateBackup({
      app: 'route-maker',
      format: 1,
      dbVersion: 2,
      exportedAt: '2026-11-01T10:00:00.000Z',
      stores: { activities: [{ id: 'a1' }] },
      localStorage: { 'route-maker:lang': 'pt-BR', 'route-maker:pace': '5:30' },
    });
    expect(b.app).toBe('lapwing');
    expect(b.localStorage).toEqual({ 'lapwing:lang': 'pt-BR', 'lapwing:pace': '5:30' });
  });
});

describe('createBackup', () => {
  beforeEach(() => {
    seed('activities', { id: 'a1', name: 'Run' } as never);
    seed('tracks', { id: 'a1', points: [{ lat: 1, lon: 2 }] } as never);
    seed('settings', { id: 'athlete', maxHr: 190 } as never, STRAVA);
    storage.set('lapwing:lang', 'pt-BR');
    storage.set('unrelated', 'x');
  });

  it('exports every store and the app localStorage keys, without secrets by default', async () => {
    const b = await createBackup({ now: new Date('2026-11-01T12:00:00Z') });
    expect(b).toMatchObject({ app: 'lapwing', format: 1, dbVersion: 2, exportedAt: '2026-11-01T12:00:00.000Z', secrets: false });
    expect(Object.keys(b.stores).sort()).toEqual([...mem.STORES].sort());
    expect(b.stores.tracks[0]).toEqual({ id: 'a1', points: [{ lat: 1, lon: 2 }] });
    expect(b.localStorage).toEqual({ 'lapwing:lang': 'pt-BR' });
    const strava = b.stores.settings.find((r) => r.id === 'strava')!;
    expect(strava).toEqual({ id: 'strava', clientId: '123', athleteName: 'Ana' });
    expect(b.stores.settings.find((r) => r.id === 'athlete')).toEqual({ id: 'athlete', maxHr: 190 });
    // The validator accepts what we export.
    expect(validateBackup(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });

  it('keeps secrets when asked', async () => {
    const b = await createBackup({ includeSecrets: true });
    expect(b.secrets).toBe(true);
    expect(b.stores.settings.find((r) => r.id === 'strava')).toEqual(STRAVA);
  });

  it('stripSecrets does not mutate its input', () => {
    const stores = { settings: [{ ...STRAVA }], plans: [{ id: 'p' }] };
    const out = stripSecrets(stores);
    expect(stores.settings[0].accessToken).toBe('acc');
    expect(out.settings[0]).not.toHaveProperty('accessToken');
    expect(out.plans).toBe(stores.plans);
  });
});

describe('file encoding', () => {
  it('detects gzip magic bytes', () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array([0x7b, 0x22]))).toBe(false);
    expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
  });

  it('round-trips plain and gzipped files', async () => {
    const b = backup({ plans: [{ id: 'p1', name: 'Marathon' }] });
    const plain = await encodeBackup(b);
    expect(isGzip(new Uint8Array(await plain.arrayBuffer()))).toBe(false);
    expect(await parseBackupFile(plain)).toEqual(b);

    const gz = await encodeBackup(b, { gzip: true });
    expect(isGzip(new Uint8Array(await gz.arrayBuffer()))).toBe(true);
    expect(await parseBackupFile(gz)).toEqual(b);
  });

  it('reports unreadable files', async () => {
    await expect(parseBackupFile(new Blob(['<gpx></gpx>']))).rejects.toMatchObject({ code: 'not-a-backup' });
    await expect(parseBackupFile(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]))).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('names files by local date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('lapwing-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 10, 1), true)).toBe('lapwing-backup-2026-11-01.json.gz');
  });
});

describe('restoreBackup', () => {
  beforeEach(() => {
    seed('plans', { id: 'p1', name: 'Old' } as never, { id: 'p2', name: 'Keep?' } as never);
    seed('shoes', { id: 's1', name: 'Pegasus' } as never);
  });

  it('merge puts records by id and keeps the rest', async () => {
    const res = await restoreBackup(backup({ plans: [{ id: 'p1', name: 'New' }, { id: 'p3', name: 'Added' }] }), 'merge');
    expect(all('plans')).toEqual([
      { id: 'p1', name: 'New' },
      { id: 'p2', name: 'Keep?' },
      { id: 'p3', name: 'Added' },
    ]);
    expect(all('shoes')).toHaveLength(1);
    expect(res.counts).toEqual({ plans: 2 });
    expect(mem.notified).toEqual(['plans']);
  });

  it('replace clears only the stores present in the file', async () => {
    await restoreBackup(backup({ plans: [{ id: 'p3', name: 'Only' }] }), 'replace');
    expect(all('plans')).toEqual([{ id: 'p3', name: 'Only' }]);
    expect(all('shoes')).toEqual([{ id: 's1', name: 'Pegasus' }]);

    await restoreBackup(backup({ shoes: [] }), 'replace');
    expect(all('shoes')).toEqual([]);
  });

  it('ignores and reports unknown stores, and restores localStorage keys', async () => {
    const res = await restoreBackup(
      backup({ laps: [{ id: 'x' }], goals: [{ id: 'g1' }] }, { localStorage: { 'lapwing:lang': 'en' } }),
      'merge',
    );
    expect(res.ignored).toEqual(['laps']);
    expect(res.counts).toEqual({ goals: 1 });
    expect(res.localStorage).toBe(1);
    expect(storage.get('lapwing:lang')).toBe('en');
    expect(mem.data.has('laps')).toBe(false);
  });

  it('keeps this device secrets when the file was exported without them', async () => {
    seed('settings', { ...STRAVA, athleteName: 'Old name' });
    const stripped = stripSecrets({ settings: [{ ...STRAVA, athleteName: 'Ana B' }] });
    await restoreBackup(backup(stripped), 'replace');
    expect(all('settings')).toEqual([{ ...STRAVA, athleteName: 'Ana B' }]);
  });

  it('uses secrets from the file when present', () => {
    const plan = planRestore(backup({ settings: [{ ...STRAVA, accessToken: 'new' }] }), {
      'settings/strava': { ...STRAVA },
    });
    expect(plan.writes[0].records[0]).toMatchObject({ accessToken: 'new', refreshToken: 'ref' });
  });
});
