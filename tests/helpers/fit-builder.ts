/**
 * Tiny FIT writer for decoder tests: header, definition and data records
 * (either byte order, developer fields, compressed timestamp headers) and the
 * CRC. Deliberately independent from the app's workout encoder.
 */
import { fitCrc } from '../../src/screens/training/fit';

export type FitType = 'enum' | 'sint8' | 'uint8' | 'sint16' | 'uint16' | 'sint32' | 'uint32' | 'string' | 'byte';

const TYPES: Record<FitType, { id: number; size: number; invalid: number }> = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  sint8: { id: 0x01, size: 1, invalid: 0x7f },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  sint16: { id: 0x83, size: 2, invalid: 0x7fff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  string: { id: 0x07, size: 1, invalid: 0 },
  byte: { id: 0x0d, size: 1, invalid: 0xff },
};

export interface FieldSpec {
  num: number;
  type: FitType;
  /** Bytes; defaults to the type size. Larger sizes make arrays (or odd sizes to test skipping). */
  size?: number;
}

export interface DefineOptions {
  bigEndian?: boolean;
  /** Developer field definitions: [field number, size, developer data index]. */
  dev?: [number, number, number][];
}

interface LocalDef {
  fields: FieldSpec[];
  little: boolean;
  devSize: number;
}

/** Value per field: a number, a string, undefined (invalid value) or an array for array fields. */
export type FieldValue = number | string | undefined | number[];

export const FIT_EPOCH_S = Date.UTC(1989, 11, 31) / 1000;
/** Epoch ms → FIT timestamp. */
export const fitTime = (ms: number) => Math.round(ms / 1000 - FIT_EPOCH_S);
/** Degrees → semicircles. */
export const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);

export class FitBuilder {
  private bytes: number[] = [];
  private defs = new Map<number, LocalDef>();

  define(local: number, global: number, fields: FieldSpec[], opts: DefineOptions = {}): this {
    const little = !opts.bigEndian;
    const b = this.bytes;
    b.push(0x40 | (opts.dev ? 0x20 : 0) | local, 0, little ? 0 : 1);
    b.push(...(little ? [global & 0xff, global >> 8] : [global >> 8, global & 0xff]));
    b.push(fields.length);
    for (const f of fields) b.push(f.num, f.size ?? TYPES[f.type].size, TYPES[f.type].id);
    let devSize = 0;
    if (opts.dev) {
      b.push(opts.dev.length);
      for (const d of opts.dev) {
        b.push(...d);
        devSize += d[1];
      }
    }
    this.defs.set(local, { fields, little, devSize });
    return this;
  }

  /** A data message; `compressedTime` (0–31) writes a compressed timestamp header (local 0–3). */
  data(local: number, values: FieldValue[], opts: { compressedTime?: number; devBytes?: number[] } = {}): this {
    const def = this.defs.get(local);
    if (!def) throw new Error(`no definition for local ${local}`);
    const b = this.bytes;
    b.push(opts.compressedTime === undefined ? local : 0x80 | (local << 5) | (opts.compressedTime & 0x1f));
    def.fields.forEach((f, i) => {
      const t = TYPES[f.type];
      const size = f.size ?? t.size;
      const v = values[i];
      if (f.type === 'string') {
        const s = new TextEncoder().encode(typeof v === 'string' ? v : '');
        for (let k = 0; k < size; k++) b.push(k < s.length ? s[k] : 0);
        return;
      }
      if (size % t.size) {
        // Malformed size: raw filler bytes.
        for (let k = 0; k < size; k++) b.push(0x11);
        return;
      }
      const list = Array.isArray(v) ? v : [v];
      for (let e = 0; e < size / t.size; e++) {
        const n = list[e] === undefined ? t.invalid : (list[e] as number);
        const u = n < 0 ? n + 2 ** (8 * t.size) : n;
        const le: number[] = [];
        for (let k = 0; k < t.size; k++) le.push(Math.floor(u / 2 ** (8 * k)) & 0xff);
        b.push(...(def.little ? le : le.reverse()));
      }
    });
    const dev = opts.devBytes ?? new Array<number>(def.devSize).fill(0x22);
    if (dev.length !== def.devSize) throw new Error('developer bytes size mismatch');
    b.push(...dev);
    return this;
  }

  /** Raw bytes appended to the record area (to build broken files). */
  raw(...bytes: number[]): this {
    this.bytes.push(...bytes);
    return this;
  }

  build(opts: { headerSize?: 12 | 14; badCrc?: boolean; dataSize?: number } = {}): Uint8Array {
    const headerSize = opts.headerSize ?? 14;
    const size = opts.dataSize ?? this.bytes.length;
    const out = new Uint8Array(headerSize + this.bytes.length + 2);
    out[0] = headerSize;
    out[1] = 0x20;
    out[2] = 2100 & 0xff;
    out[3] = 2100 >> 8;
    new DataView(out.buffer).setUint32(4, size, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8);
    if (headerSize === 14) {
      const hc = fitCrc(out, 0, 12);
      out[12] = hc & 0xff;
      out[13] = hc >> 8;
    }
    out.set(this.bytes, headerSize);
    const end = headerSize + this.bytes.length;
    const crc = fitCrc(out, 0, end) ^ (opts.badCrc ? 0xbeef : 0);
    out[end] = crc & 0xff;
    out[end + 1] = crc >> 8;
    return out;
  }
}
