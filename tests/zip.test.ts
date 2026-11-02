import { describe, expect, it } from 'vitest';
import { gunzip, isGzip } from '../src/data/gzip';
import { crc32, decodeName, openZip, ZipError } from '../src/data/zip';
import { gz, makeZip, type ZipSpec } from './helpers/make-zip';

const blob = (entries: ZipSpec[], opts?: { zip64?: boolean; comment?: string }) =>
  new Blob([makeZip(entries, opts) as Uint8Array<ArrayBuffer>]);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function readAll(b: Blob) {
  const zip = await openZip(b);
  const out: Record<string, string> = {};
  for (const e of zip.entries) if (!e.isDirectory) out[e.name] = text(await zip.read(e));
  return { zip, out };
}

async function zipError(p: Promise<unknown>): Promise<ZipError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ZipError);
  return err as ZipError;
}

describe('openZip', () => {
  it('reads stored and deflated entries and folders', async () => {
    const long = 'trkpt '.repeat(50_000); // several output chunks when inflated
    const { zip, out } = await readAll(
      blob([
        { name: 'activities/', data: '', method: 0 },
        { name: 'activities.csv', data: 'a,b\n1,2\n', method: 0 },
        { name: 'activities/1.gpx', data: long },
      ]),
    );
    expect(zip.entries.map((e) => [e.name, e.method, e.isDirectory])).toEqual([
      ['activities/', 0, true],
      ['activities.csv', 0, false],
      ['activities/1.gpx', 8, false],
    ]);
    expect(out['activities.csv']).toBe('a,b\n1,2\n');
    expect(out['activities/1.gpx']).toBe(long);
    expect(zip.entries[2].compressedSize).toBeLessThan(zip.entries[2].size);
  });

  it('decodes UTF-8 names, flagged or not, and CP437 names', async () => {
    const { out } = await readAll(
      blob([
        { name: 'atividades/corrida-manhã.gpx', data: 'x' },
        { name: 'Ônibus.txt', data: 'y', utf8: false },
        { name: 'cp437', rawName: new Uint8Array([0x87, 0x61, 0x6f, 0x2e, 0x74, 0x78, 0x74]), data: 'z', utf8: false },
      ]),
    );
    expect(Object.keys(out)).toEqual(['atividades/corrida-manhã.gpx', 'Ônibus.txt', 'çao.txt']);
  });

  it('finds the end record past a comment that contains its signature', async () => {
    const { out } = await readAll(blob([{ name: 'a.txt', data: 'hello' }], { comment: 'see PK\u0005\u0006 here' }));
    expect(out['a.txt']).toBe('hello');
  });

  it('reads ZIP64 archives', async () => {
    const { zip, out } = await readAll(
      blob(
        [
          { name: 'activities.csv', data: 'id\n1\n' },
          { name: 'activities/2.fit', data: 'binary', method: 0 },
        ],
        { zip64: true },
      ),
    );
    expect(zip.entries).toHaveLength(2);
    expect(zip.entries[1].size).toBe(6);
    expect(out).toEqual({ 'activities.csv': 'id\n1\n', 'activities/2.fit': 'binary' });
  });

  it('reads entries written with data descriptors', async () => {
    const { out } = await readAll(
      blob([
        { name: 'a.gpx', data: '<gpx/>'.repeat(100), dataDescriptor: true },
        { name: 'b.txt', data: 'after', dataDescriptor: true },
      ]),
    );
    expect(out['a.gpx']).toBe('<gpx/>'.repeat(100));
    expect(out['b.txt']).toBe('after');
  });

  it('only reads the parts of the archive it needs', async () => {
    const noise = new Uint8Array(400_000).map((_, i) => (i * 7919) % 251);
    const data = makeZip([
      { name: 'media/big.jpg', data: noise, method: 0 },
      { name: 'activities/1.gpx', data: '<gpx></gpx>' },
    ]) as Uint8Array<ArrayBuffer>;
    const real = new Blob([data]);
    let sliced = 0;
    const tracking = {
      size: real.size,
      slice(start: number, end: number) {
        sliced += end - start;
        return real.slice(start, end);
      },
    } as unknown as Blob;
    const zip = await openZip(tracking);
    expect(text(await zip.read(zip.entries[1]))).toBe('<gpx></gpx>');
    expect(sliced).toBeLessThan(100_000);
  });

  it('rejects unsupported methods, encryption, corrupt data and non-ZIP files', async () => {
    const zip = await openZip(
      blob([
        { name: 'bzip2.bin', data: 'x', method: 12 },
        { name: 'secret.gpx', data: 'x', method: 0, encrypted: true },
      ]),
    );
    expect((await zipError(zip.read(zip.entries[0]))).code).toBe('unsupported');
    expect((await zipError(zip.read(zip.entries[1]))).code).toBe('encrypted');

    const bytes = makeZip([{ name: 'a.txt', data: 'hello world', method: 0 }]);
    bytes[30 + 'a.txt'.length] ^= 0xff; // flip the first data byte: CRC mismatch
    const damaged = await openZip(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    expect((await zipError(damaged.read(damaged.entries[0]))).code).toBe('corrupt');

    expect((await zipError(openZip(new Blob(['just some text, not an archive'])))).code).toBe('not-zip');
    expect((await zipError(openZip(new Blob([])))).code).toBe('not-zip');
  });
});

describe('helpers', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('maps every CP437 byte to one character', () => {
    const all = new Uint8Array(128).map((_, i) => 0x80 + i);
    expect([...decodeName(all, false)]).toHaveLength(128);
  });

  it('detects and decompresses gzip', async () => {
    const packed = gz('<gpx>olá</gpx>');
    expect(isGzip(packed)).toBe(true);
    expect(isGzip(new TextEncoder().encode('<gpx>'))).toBe(false);
    expect(text(await gunzip(packed))).toBe('<gpx>olá</gpx>');
    await expect(gunzip(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow();
  });
});
