import zlib from 'node:zlib';

/** One entry of a synthetic ZIP archive built in tests. */
export interface ZipSpec {
  name: string;
  data: Uint8Array | string;
  /** 0 stored, 8 deflate (default), anything else is written as-is with stored bytes. */
  method?: number;
  /** Set the UTF-8 name flag (default true). */
  utf8?: boolean;
  /** Name bytes to write instead of the UTF-8 encoding of `name`. */
  rawName?: Uint8Array;
  /** Write sizes in a data descriptor after the data (local header sizes are 0). */
  dataDescriptor?: boolean;
  /** Set the encryption flag (the data isn't really encrypted). */
  encrypted?: boolean;
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.length;
  }
  u16(v: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.bytes(b);
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.bytes(b);
  }
  u64(v: number) {
    this.u32(v % 0x1_0000_0000);
    this.u32(Math.floor(v / 0x1_0000_0000));
  }
  result() {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

const enc = new TextEncoder();

/**
 * Builds a ZIP archive in memory. With `zip64`, the central directory uses
 * ZIP64 extra fields for sizes and offsets and the archive ends with a ZIP64
 * end-of-central-directory record and locator (with small real values).
 */
export function makeZip(entries: ZipSpec[], opts: { zip64?: boolean; comment?: string } = {}): Uint8Array {
  const w = new Writer();
  const central: { spec: ZipSpec; name: Uint8Array; flags: number; method: number; crc: number; csize: number; size: number; offset: number }[] = [];

  for (const spec of entries) {
    const raw = typeof spec.data === 'string' ? enc.encode(spec.data) : spec.data;
    const method = spec.method ?? 8;
    const body = method === 8 ? new Uint8Array(zlib.deflateRawSync(raw)) : raw;
    const name = spec.rawName ?? enc.encode(spec.name);
    const flags = (spec.utf8 === false ? 0 : 0x800) | (spec.dataDescriptor ? 0x8 : 0) | (spec.encrypted ? 0x1 : 0);
    const crc = zlib.crc32(raw);
    const offset = w.length;
    const localExtra = opts.zip64 ? 20 : 0;
    w.u32(0x04034b50);
    w.u16(opts.zip64 ? 45 : 20);
    w.u16(flags);
    w.u16(method);
    w.u16(0); // time
    w.u16(0x21); // date
    w.u32(spec.dataDescriptor ? 0 : crc);
    w.u32(spec.dataDescriptor ? 0 : opts.zip64 ? 0xffffffff : body.length);
    w.u32(spec.dataDescriptor ? 0 : opts.zip64 ? 0xffffffff : raw.length);
    w.u16(name.length);
    w.u16(localExtra);
    w.bytes(name);
    if (opts.zip64) {
      w.u16(0x0001);
      w.u16(16);
      w.u64(raw.length);
      w.u64(body.length);
    }
    w.bytes(body);
    if (spec.dataDescriptor) {
      w.u32(0x08074b50);
      w.u32(crc);
      w.u32(body.length);
      w.u32(raw.length);
    }
    central.push({ spec, name, flags, method, crc, csize: body.length, size: raw.length, offset });
  }

  const cdOffset = w.length;
  for (const c of central) {
    w.u32(0x02014b50);
    w.u16(opts.zip64 ? 45 : 20);
    w.u16(opts.zip64 ? 45 : 20);
    w.u16(c.flags);
    w.u16(c.method);
    w.u16(0);
    w.u16(0x21);
    w.u32(c.crc);
    w.u32(opts.zip64 ? 0xffffffff : c.csize);
    w.u32(opts.zip64 ? 0xffffffff : c.size);
    w.u16(c.name.length);
    w.u16(opts.zip64 ? 28 : 0);
    w.u16(0); // comment
    w.u16(0); // disk
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(opts.zip64 ? 0xffffffff : c.offset);
    w.bytes(c.name);
    if (opts.zip64) {
      w.u16(0x0001);
      w.u16(24);
      w.u64(c.size);
      w.u64(c.csize);
      w.u64(c.offset);
    }
  }
  const cdSize = w.length - cdOffset;

  if (opts.zip64) {
    const recOffset = w.length;
    w.u32(0x06064b50);
    w.u64(44);
    w.u16(45);
    w.u16(45);
    w.u32(0);
    w.u32(0);
    w.u64(central.length);
    w.u64(central.length);
    w.u64(cdSize);
    w.u64(cdOffset);
    w.u32(0x07064b50);
    w.u32(0);
    w.u64(recOffset);
    w.u32(1);
  }
  const comment = enc.encode(opts.comment ?? '');
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(opts.zip64 ? 0xffff : central.length);
  w.u16(opts.zip64 ? 0xffff : central.length);
  w.u32(opts.zip64 ? 0xffffffff : cdSize);
  w.u32(opts.zip64 ? 0xffffffff : cdOffset);
  w.u16(comment.length);
  w.bytes(comment);
  return w.result();
}

/** A synthetic ZIP as a File (works in Node and jsdom). */
export const zipFile = (entries: ZipSpec[], name = 'export.zip', opts?: { zip64?: boolean; comment?: string }) =>
  new File([makeZip(entries, opts) as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' });

/** Gzips text or bytes (like Strava's `.gpx.gz` files). */
export const gz = (data: string | Uint8Array) => new Uint8Array(zlib.gzipSync(typeof data === 'string' ? enc.encode(data) : data));
