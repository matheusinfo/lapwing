/**
 * Minimal FIT (Flexible and Interoperable Data Transfer) encoder for workout
 * files, following the Garmin FIT SDK: a 14-byte header, definition and data
 * messages (little endian) and a CRC-16 at the end. Only what a workout file
 * needs: file_id, workout and workout_step.
 */
import type { SimpleStep, StepKind, WorkoutStep } from './types';

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

/** CRC-16 as defined by the FIT SDK (CRC-16/ARC). */
export function fitCrc(bytes: ArrayLike<number>, start = 0, end = bytes.length, crc = 0): number {
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

export type FitBaseType = 'enum' | 'uint8' | 'uint16' | 'uint32' | 'uint32z' | 'string';

/** Base type id, size in bytes and "invalid" value per the FIT profile. */
export const BASE_TYPES: Record<FitBaseType, { id: number; size: number; invalid: number }> = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
  string: { id: 0x07, size: 1, invalid: 0 },
};

export interface FitFieldDef {
  num: number;
  type: FitBaseType;
  /** Bytes, required for strings (including the terminating zero). */
  size?: number;
}

export interface FitMessageDef {
  global: number;
  fields: FitFieldDef[];
}

/** Value per field; undefined writes the type's invalid value. */
export type FitValues = (number | string | undefined)[];

const encoder = new TextEncoder();

/** UTF-8 bytes of `s`, cut at a character boundary to fit `size` with a zero terminator. */
function fitString(s: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let bytes = encoder.encode(s);
  if (bytes.length > size - 1) {
    let end = size - 1;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // Don't split a multi-byte character.
    bytes = bytes.slice(0, end);
  }
  out.set(bytes);
  return out;
}

/** Writes FIT records into a growing buffer; `finish()` adds header and CRC. */
export class FitWriter {
  private data: number[] = [];

  /** A definition message for local message type `local` (0–15). */
  define(local: number, def: FitMessageDef): void {
    const d = this.data;
    d.push(0x40 | (local & 0x0f), 0, 0, def.global & 0xff, (def.global >> 8) & 0xff, def.fields.length);
    for (const f of def.fields) d.push(f.num, f.size ?? BASE_TYPES[f.type].size, BASE_TYPES[f.type].id);
  }

  /** A data message using the definition last written for `local`. */
  write(local: number, def: FitMessageDef, values: FitValues): void {
    const d = this.data;
    d.push(local & 0x0f);
    def.fields.forEach((f, i) => {
      const v = values[i];
      const base = BASE_TYPES[f.type];
      if (f.type === 'string') {
        d.push(...fitString(typeof v === 'string' ? v : '', f.size ?? 1));
        return;
      }
      let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : base.invalid;
      if (n < 0 || n > 2 ** (8 * base.size) - 1) n = base.invalid;
      for (let b = 0; b < base.size; b++) d.push((n / 2 ** (8 * b)) & 0xff);
    });
  }

  finish(): Uint8Array<ArrayBuffer> {
    const size = this.data.length;
    const out = new Uint8Array(14 + size + 2);
    out[0] = 14; // Header size.
    out[1] = 0x10; // Protocol version 1.0 (widest device support).
    out[2] = 2100 & 0xff; // Profile version 21.00.
    out[3] = 2100 >> 8;
    out[4] = size & 0xff;
    out[5] = (size >> 8) & 0xff;
    out[6] = (size >> 16) & 0xff;
    out[7] = (size >>> 24) & 0xff;
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    const headerCrc = fitCrc(out, 0, 12);
    out[12] = headerCrc & 0xff;
    out[13] = headerCrc >> 8;
    out.set(this.data, 14);
    const crc = fitCrc(out, 0, 14 + size);
    out[14 + size] = crc & 0xff;
    out[15 + size] = crc >> 8;
    return out;
  }
}

// ---- Workout files ----

export const MESG = { fileId: 0, workout: 26, workoutStep: 27 } as const;
export const FILE_TYPE_WORKOUT = 5;
export const SPORT_RUNNING = 1;
export const DURATION = { time: 0, distance: 1, open: 5, repeatUntilStepsCmplt: 6 } as const;
export const TARGET = { speed: 0, heartRate: 1, open: 2 } as const;
export const INTENSITY: Record<StepKind, number> = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4 };

const FILE_ID: FitMessageDef = {
  global: MESG.fileId,
  fields: [
    { num: 0, type: 'enum' }, // type
    { num: 1, type: 'uint16' }, // manufacturer
    { num: 2, type: 'uint16' }, // product
    { num: 3, type: 'uint32z' }, // serial_number
    { num: 4, type: 'uint32' }, // time_created
  ],
};

export interface FitWorkoutInput {
  name: string;
  steps: WorkoutStep[];
  /** Labels for step names (shown on the watch), max 15 bytes. */
  stepName?: (s: SimpleStep) => string;
  /** Creation time, epoch ms. */
  timeCreated: number;
}

/** Number of workout_step messages for `steps` (a repeat adds one step after its children). */
export function fitStepCount(steps: WorkoutStep[]): number {
  return steps.reduce((n, s) => n + (s.type === 'repeat' ? s.steps.length + (s.times > 1 ? 1 : 0) : 1), 0);
}

/** Encodes a running workout as a .fit file. */
export function encodeWorkoutFit(input: FitWorkoutInput): Uint8Array<ArrayBuffer> {
  const w = new FitWriter();
  const created = Math.max(0, Math.floor((input.timeCreated - FIT_EPOCH_MS) / 1000));

  w.define(0, FILE_ID);
  w.write(0, FILE_ID, [FILE_TYPE_WORKOUT, 255 /* development */, 0, (created % 0xfffffffe) + 1, created]);

  const nameSize = Math.min(32, Math.max(2, encoder.encode(input.name).length + 1));
  const WORKOUT: FitMessageDef = {
    global: MESG.workout,
    fields: [
      { num: 4, type: 'enum' }, // sport
      { num: 11, type: 'enum' }, // sub_sport
      { num: 6, type: 'uint16' }, // num_valid_steps
      { num: 8, type: 'string', size: nameSize }, // wkt_name
    ],
  };
  w.define(1, WORKOUT);
  w.write(1, WORKOUT, [SPORT_RUNNING, 0, fitStepCount(input.steps), input.name]);

  const flat = input.steps.flatMap((s) => (s.type === 'repeat' ? s.steps : [s]));
  const noteBytes = Math.max(0, ...flat.map((s) => (s.note ? encoder.encode(s.note).length + 1 : 0)));
  const fields: FitFieldDef[] = [
    { num: 254, type: 'uint16' }, // message_index
    { num: 0, type: 'string', size: 16 }, // wkt_step_name
    { num: 1, type: 'enum' }, // duration_type
    { num: 2, type: 'uint32' }, // duration_value
    { num: 3, type: 'enum' }, // target_type
    { num: 4, type: 'uint32' }, // target_value (repeat_steps for repeats)
    { num: 5, type: 'uint32' }, // custom_target_value_low
    { num: 6, type: 'uint32' }, // custom_target_value_high
    { num: 7, type: 'enum' }, // intensity
  ];
  if (noteBytes) fields.push({ num: 8, type: 'string', size: Math.min(64, noteBytes) }); // notes
  const STEP: FitMessageDef = { global: MESG.workoutStep, fields };
  w.define(2, STEP);

  let index = 0;
  const writeStep = (s: SimpleStep) => {
    const d = s.duration;
    const [durType, durValue] =
      d.type === 'distance' ? [DURATION.distance, d.meters * 100] : d.type === 'time' ? [DURATION.time, d.seconds * 1000] : [DURATION.open, undefined];
    let target: [number, number | undefined, number | undefined, number | undefined] = [TARGET.open, 0, undefined, undefined];
    const tg = s.target;
    if (tg?.type === 'pace') {
      // Speed in mm/s: the slower pace is the low speed.
      target = [TARGET.speed, 0, (1_000_000 / tg.max), (1_000_000 / tg.min)];
    } else if (tg && 'zone' in tg) {
      target = [TARGET.heartRate, tg.zone, undefined, undefined];
    } else if (tg) {
      target = [TARGET.heartRate, 0, tg.min + 100, tg.max + 100]; // Custom bpm are offset by 100.
    }
    const values: FitValues = [index++, input.stepName?.(s) ?? '', durType, durValue, ...target, INTENSITY[s.kind]];
    if (noteBytes) values.push(s.note ?? '');
    w.write(2, STEP, values);
  };

  for (const s of input.steps) {
    if (s.type === 'step') {
      writeStep(s);
      continue;
    }
    const first = index;
    s.steps.forEach(writeStep);
    if (s.times > 1) {
      const values: FitValues = [index++, '', DURATION.repeatUntilStepsCmplt, first, undefined, s.times, undefined, undefined, undefined];
      if (noteBytes) values.push('');
      w.write(2, STEP, values);
    }
  }
  return w.finish();
}
