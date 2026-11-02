/**
 * Minimal ZIP reader for archives picked by the user (e.g. the Strava account
 * export). It works over a `Blob`/`File` with `blob.slice()`, so only the
 * central directory and the entries actually read are loaded into memory:
 * archives with media can be several gigabytes.
 *
 * Supports: stored (0) and deflate (8) entries, ZIP64 (sizes/offsets over
 * 4 GB, more than 65535 entries), data descriptors (sizes come from the
 * central directory), UTF-8 and CP437 names, archive comments. Encrypted
 * entries and other methods are rejected with a `ZipError`.
 */
import { decompress } from './gzip';

export type ZipErrorCode = 'not-zip' | 'corrupt' | 'unsupported' | 'encrypted';

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, detail?: string) {
    super(`ZIP: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipEntry {
  /** Full path inside the archive, with `/` separators. */
  name: string;
  /** Compression method (0 stored, 8 deflate). */
  method: number;
  /** General-purpose bit flags. */
  flags: number;
  crc32: number;
  compressedSize: number;
  /** Uncompressed size in bytes. */
  size: number;
  /** Offset of the local file header. */
  offset: number;
  isDirectory: boolean;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** Reads and decompresses one entry (checking its CRC-32). */
  read(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>>;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  if (start < 0 || end > blob.size || start > end) throw new ZipError('corrupt', 'range');
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

async function readRange(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView((await readBytes(blob, start, end)).buffer);
}

/** A little-endian 64-bit value as a Number (exact up to 2^53). */
const u64 = (v: DataView, at: number) => v.getUint32(at, true) + v.getUint32(at + 4, true) * 0x1_0000_0000;

// Code page 437, upper half (names of ZIPs made without the UTF-8 flag).
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const utf8 = new TextDecoder('utf-8');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** Decodes an entry name: UTF-8 when flagged (or when it is valid UTF-8), else CP437. */
export function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return utf8.decode(bytes);
  if (bytes.every((b) => b < 0x80)) return String.fromCharCode(...bytes);
  try {
    // Many tools write UTF-8 without setting the flag.
    return utf8Strict.decode(bytes);
  } catch {
    return Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80])).join('');
  }
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE), as stored in ZIP headers. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Directory {
  count: number;
  size: number;
  offset: number;
}

/** Finds the end of central directory (and the ZIP64 record when present). */
async function findDirectory(blob: Blob): Promise<Directory> {
  if (blob.size < EOCD_SIZE) throw new ZipError('not-zip');
  const tailStart = Math.max(0, blob.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await readRange(blob, tailStart, blob.size);
  let at = -1;
  // Search backwards; the comment length must reach exactly the end of the file
  // (so a signature inside the comment isn't taken for the real one).
  for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD && i + EOCD_SIZE + tail.getUint16(i + 20, true) === tail.byteLength) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    // Tolerate trailing junk: fall back to the last signature found.
    for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
      if (tail.getUint32(i, true) === SIG_EOCD) {
        at = i;
        break;
      }
    }
  }
  if (at < 0) throw new ZipError('not-zip');

  const dir: Directory = {
    count: tail.getUint16(at + 10, true),
    size: tail.getUint32(at + 12, true),
    offset: tail.getUint32(at + 16, true),
  };

  // ZIP64: a locator sits right before the EOCD and points to the ZIP64 record.
  const eocdPos = tailStart + at;
  if (eocdPos >= 20) {
    const loc = await readRange(blob, eocdPos - 20, eocdPos);
    if (loc.getUint32(0, true) === SIG_EOCD64_LOCATOR) {
      const recPos = u64(loc, 8);
      const rec = await readRange(blob, recPos, recPos + 56);
      if (rec.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('corrupt', 'zip64 record');
      dir.count = u64(rec, 32);
      dir.size = u64(rec, 40);
      dir.offset = u64(rec, 48);
    }
  }
  if (dir.offset + dir.size > blob.size) throw new ZipError('corrupt', 'central directory');
  return dir;
}

function parseCentral(v: DataView, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('corrupt', 'central entry');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    let compressedSize = v.getUint32(p + 20, true);
    let size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let offset = v.getUint32(p + 42, true);
    const nameStart = p + 46;
    if (nameStart + nameLen + extraLen + commentLen > v.byteLength) throw new ZipError('corrupt', 'central entry');
    const name = decodeName(
      new Uint8Array(v.buffer, v.byteOffset + nameStart, nameLen),
      (flags & FLAG_UTF8) !== 0,
    );

    // ZIP64 extended information: only the fields saturated in the header, in this order.
    let e = nameStart + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        const end = Math.min(f + len, extraEnd);
        if (size === 0xffffffff && f + 8 <= end) (size = u64(v, f)), (f += 8);
        if (compressedSize === 0xffffffff && f + 8 <= end) (compressedSize = u64(v, f)), (f += 8);
        if (offset === 0xffffffff && f + 8 <= end) offset = u64(v, f);
      }
      e += 4 + len;
    }

    entries.push({
      name: name.replace(/\\/g, '/'),
      method,
      flags,
      crc32: crc,
      compressedSize,
      size,
      offset,
      isDirectory: name.endsWith('/'),
    });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Opens a ZIP archive. Throws `ZipError('not-zip')` when the file isn't one. */
export async function openZip(blob: Blob): Promise<ZipArchive> {
  const dir = await findDirectory(blob);
  const central = await readRange(blob, dir.offset, dir.offset + dir.size);
  const entries = parseCentral(central, dir.count);

  async function read(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
    if (entry.flags & FLAG_ENCRYPTED || entry.method === 99) throw new ZipError('encrypted', entry.name);
    if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported', `method ${entry.method}`);
    const local = await readRange(blob, entry.offset, Math.min(blob.size, entry.offset + 30));
    if (local.byteLength < 30 || local.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('corrupt', 'local header');
    // The local name/extra lengths can differ from the central directory's.
    const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    // Sizes come from the central directory: with a data descriptor the local ones are 0.
    const raw = await readBytes(blob, start, start + entry.compressedSize);
    let data: Uint8Array<ArrayBuffer>;
    if (entry.method === 0) data = raw;
    else {
      try {
        data = await decompress(raw, 'deflate-raw');
      } catch {
        throw new ZipError('corrupt', entry.name);
      }
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc32) throw new ZipError('corrupt', entry.name);
    return data;
  }

  return { entries, read };
}
