/**
 * Structured workouts: helpers to build, estimate, validate, summarise and
 * (de)serialise `WorkoutStep[]`. Units stay internal: metres, seconds and
 * seconds per km.
 *
 * Text format (CSV column "steps"), language-neutral, "." decimals:
 *
 *   wu 15min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min
 *
 * - step:     [kind] duration [@ target] [[note]]
 * - kind:     wu, run, rec, cd, rest (also warmup, aquecimento, tiro, trote,
 *             desaquecimento, pausa…; default run)
 * - duration: 400m, 1.5km, 10min, 90s, 1:30 (m:ss), lap (open)
 * - target:   4:00-4:10 (pace /km), z2 (heart-rate zone), 140-150bpm
 * - repeat:   Nx(step, step, …)
 */
import { formatDuration, formatNumber, formatPace, parsePace } from '../../format';
import { t } from './i18n';
import type { RepeatStep, SimpleStep, StepDuration, StepKind, StepTarget, WorkoutKind, WorkoutStep } from './types';
import { STEP_KINDS } from './types';

/** Easy pace assumed when nothing better is known (6:00 /km). */
export const DEFAULT_EASY_PACE = 360;
/** Pace of a step without a pace target, as a multiple of the easy pace. */
const KIND_PACE_FACTOR: Record<StepKind, number> = { warmup: 1.03, active: 0.88, recovery: 1.12, cooldown: 1.05, rest: 2 };
/** Nominal length of an open (lap button) step, only for drawing. */
export const OPEN_STEP_SECONDS = 300;

export const LIMITS = {
  maxMeters: 100_000,
  maxSeconds: 86_400,
  minPace: 120,
  maxPace: 1200,
  minBpm: 30,
  maxBpm: 250,
  maxTimes: 99,
};

let counter = 0;
/** A short unique id for a step (unique within the app session). */
export const stepId = () =>
  `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- Builders ----

export const distance = (meters: number): StepDuration => ({ type: 'distance', meters });
export const time = (seconds: number): StepDuration => ({ type: 'time', seconds });
export const openDuration = (): StepDuration => ({ type: 'open' });

const round5 = (s: number) => Math.round(s / 5) * 5;

/** A pace range of ±`spread` seconds around `pace` (rounded to 5 s). */
export function paceRange(pace: number, spread = 5): StepTarget {
  const p = round5(pace);
  return { type: 'pace', min: Math.max(LIMITS.minPace, p - spread), max: Math.min(LIMITS.maxPace, p + spread) };
}

export function simpleStep(kind: StepKind, duration: StepDuration, target?: StepTarget, note?: string): SimpleStep {
  const s: SimpleStep = { type: 'step', id: stepId(), kind, duration };
  if (target) s.target = target;
  if (note) s.note = note;
  return s;
}

export function repeatStep(times: number, steps: SimpleStep[]): RepeatStep {
  return { type: 'repeat', id: stepId(), times, steps };
}

// ---- Estimates ----

/** Repeats expanded into the sequence of steps actually run. */
export function flattenSteps(steps: WorkoutStep[]): SimpleStep[] {
  const out: SimpleStep[] = [];
  for (const s of steps) {
    if (s.type === 'repeat') {
      for (let i = 0; i < s.times; i++) out.push(...s.steps);
    } else out.push(s);
  }
  return out;
}

/** Pace (s/km) used to convert time ↔ distance for a step. */
export function stepPace(step: SimpleStep, easyPace = DEFAULT_EASY_PACE): number {
  if (step.target?.type === 'pace') return (step.target.min + step.target.max) / 2;
  return easyPace * KIND_PACE_FACTOR[step.kind];
}

export interface StepEstimate {
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  /** True when some step lasts until the lap button (not counted). */
  hasOpen: boolean;
}

export function estimateStep(step: SimpleStep, easyPace = DEFAULT_EASY_PACE): StepEstimate {
  const pace = stepPace(step, easyPace);
  const d = step.duration;
  if (d.type === 'distance') return { distance: d.meters, duration: (d.meters * pace) / 1000, hasOpen: false };
  if (d.type === 'time') return { distance: step.kind === 'rest' ? 0 : (d.seconds / pace) * 1000, duration: d.seconds, hasOpen: false };
  return { distance: 0, duration: 0, hasOpen: true };
}

/** Estimated total distance and duration (target pace, else a pace derived from `easyPace`). */
export function estimateSteps(steps: WorkoutStep[], easyPace = DEFAULT_EASY_PACE): StepEstimate {
  const total: StepEstimate = { distance: 0, duration: 0, hasOpen: false };
  for (const s of flattenSteps(steps)) {
    const e = estimateStep(s, easyPace);
    total.distance += e.distance;
    total.duration += e.duration;
    total.hasOpen ||= e.hasOpen;
  }
  return total;
}

/** Workout targets derived from the steps: distance to 10 m, duration to the minute. */
export function derivedTargets(steps: WorkoutStep[], easyPace?: number): { distance?: number; duration?: number } {
  const e = estimateSteps(steps, easyPace);
  const out: { distance?: number; duration?: number } = {};
  if (e.distance > 0) out.distance = Math.round(e.distance / 10) * 10;
  if (e.duration > 0) out.duration = Math.max(60, Math.round(e.duration / 60) * 60);
  return out;
}

/** Median target pace of a plan's easy, long and recovery runs, if any have one. */
export function easyPaceOf(workouts: { kind: WorkoutKind; pace?: number }[]): number | undefined {
  const paces = workouts
    .filter((w) => (w.kind === 'easy' || w.kind === 'long' || w.kind === 'recovery') && w.pace)
    .map((w) => w.pace!)
    .sort((a, b) => a - b);
  return paces.length ? paces[Math.floor(paces.length / 2)] : undefined;
}

// ---- Validation ----

export type StepIssueCode = 'empty' | 'duration' | 'pace' | 'hr' | 'repeat';
export interface StepIssue {
  code: StepIssueCode;
  /** 1-based position of the top-level step or block. */
  index: number;
}

const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function simpleIssue(s: SimpleStep): StepIssueCode | null {
  if (!STEP_KINDS.includes(s.kind)) return 'duration';
  const d = s.duration;
  if (d.type === 'distance' ? !numIn(d.meters, 1, LIMITS.maxMeters) : d.type === 'time' ? !numIn(d.seconds, 1, LIMITS.maxSeconds) : d.type !== 'open') {
    return 'duration';
  }
  const tg = s.target;
  if (!tg) return null;
  if (tg.type === 'pace') {
    return numIn(tg.min, LIMITS.minPace, LIMITS.maxPace) && numIn(tg.max, LIMITS.minPace, LIMITS.maxPace) && tg.min <= tg.max ? null : 'pace';
  }
  if (tg.type === 'hr') {
    if ('zone' in tg) return intIn(tg.zone, 1, 5) ? null : 'hr';
    return numIn(tg.min, LIMITS.minBpm, LIMITS.maxBpm) && numIn(tg.max, LIMITS.minBpm, LIMITS.maxBpm) && tg.min <= tg.max ? null : 'hr';
  }
  return 'pace';
}

/** The first problem in the steps, or null when they are valid. */
export function validateSteps(steps: WorkoutStep[]): StepIssue | null {
  if (!steps.length) return { code: 'empty', index: 0 };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'repeat') {
      if (!intIn(s.times, 1, LIMITS.maxTimes) || !s.steps.length || s.steps.some((c) => c.type !== 'step')) {
        return { code: 'repeat', index: i + 1 };
      }
      for (const c of s.steps) {
        const code = simpleIssue(c);
        if (code) return { code, index: i + 1 };
      }
    } else {
      const code = simpleIssue(s);
      if (code) return { code, index: i + 1 };
    }
  }
  return null;
}

/**
 * Reads steps from untrusted data (JSON files, old records). Missing ids are
 * created. Returns undefined when the data isn't a valid list of steps.
 */
export function sanitizeSteps(raw: unknown): WorkoutStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const simple = (o: unknown): SimpleStep | undefined => {
    if (!o || typeof o !== 'object') return undefined;
    const r = o as Record<string, unknown>;
    const kind = r.kind as StepKind;
    if (!STEP_KINDS.includes(kind)) return undefined;
    const dRaw = (r.duration ?? {}) as Record<string, unknown>;
    let duration: StepDuration;
    if (dRaw.type === 'distance') duration = distance(Number(dRaw.meters));
    else if (dRaw.type === 'time') duration = time(Number(dRaw.seconds));
    else if (dRaw.type === 'open') duration = openDuration();
    else return undefined;
    const step: SimpleStep = { type: 'step', id: typeof r.id === 'string' && r.id ? r.id : stepId(), kind, duration };
    const tRaw = r.target as Record<string, unknown> | undefined;
    if (tRaw && typeof tRaw === 'object') {
      if (tRaw.type === 'pace') step.target = { type: 'pace', min: Number(tRaw.min), max: Number(tRaw.max) };
      else if (tRaw.type === 'hr' && tRaw.zone !== undefined) step.target = { type: 'hr', zone: Number(tRaw.zone) };
      else if (tRaw.type === 'hr') step.target = { type: 'hr', min: Number(tRaw.min), max: Number(tRaw.max) };
      else return undefined;
    }
    if (typeof r.note === 'string' && r.note.trim()) step.note = r.note.trim().slice(0, 200);
    return step;
  };
  const out: WorkoutStep[] = [];
  for (const o of raw) {
    const r = o as Record<string, unknown> | null;
    if (r && typeof r === 'object' && r.type === 'repeat') {
      if (!Array.isArray(r.steps)) return undefined;
      const children = r.steps.map(simple);
      if (children.some((c) => !c)) return undefined;
      out.push({ type: 'repeat', id: typeof r.id === 'string' && r.id ? r.id : stepId(), times: Number(r.times), steps: children as SimpleStep[] });
    } else {
      const s = simple(o);
      if (!s) return undefined;
      out.push(s);
    }
  }
  return validateSteps(out) ? undefined : out;
}

/** Copies steps without their ids (for export files). */
export function stripStepIds(steps: WorkoutStep[]): unknown[] {
  const strip = ({ id: _id, ...rest }: SimpleStep) => rest;
  return steps.map((s) => (s.type === 'repeat' ? { type: 'repeat', times: s.times, steps: s.steps.map(strip) } : strip(s)));
}

// ---- Human-readable summary ----

/** "400 m", "1.5 km", "10 min", "1:30", "45 s", "until lap". */
export function durationText(d: StepDuration): string {
  if (d.type === 'distance') return d.meters < 1000 ? `${formatNumber(d.meters)} m` : `${formatNumber(d.meters / 1000, 2)} km`;
  if (d.type === 'time') {
    if (d.seconds < 60) return `${d.seconds} s`;
    return d.seconds % 60 === 0 && d.seconds < 6000 ? `${d.seconds / 60} min` : formatDuration(d.seconds);
  }
  return t('stepOpen');
}

/** "4:00–4:10 /km", "Z2", "140–150 bpm". */
export function targetText(tg: StepTarget): string {
  if (tg.type === 'pace') return tg.min === tg.max ? formatPace(tg.min) : `${formatDuration(tg.min)}–${formatPace(tg.max)}`;
  if ('zone' in tg) return `Z${tg.zone}`;
  return tg.min === tg.max ? `${tg.min} bpm` : `${tg.min}–${tg.max} bpm`;
}

export const stepKindLabel = (k: StepKind) => t(`step_${k}`);

/** "10 min WU", "400 m @ 4:00–4:10 /km", "200 m jog". */
export function stepText(s: SimpleStep): string {
  const parts = [durationText(s.duration)];
  if (s.kind !== 'active') parts.push(t(`stepShort_${s.kind}`));
  if (s.target) parts.push(`@ ${targetText(s.target)}`);
  return parts.join(' ');
}

/** "10 min WU · 8×(400 m @ 4:00–4:10 /km, 200 m jog) · 10 min CD". */
export function stepsSummary(steps: WorkoutStep[]): string {
  return steps
    .map((s) => {
      if (s.type === 'step') return stepText(s);
      const inner = s.steps.map(stepText).join(', ');
      return s.times === 1 ? inner : `${s.times}×(${inner})`;
    })
    .join(' · ');
}

// ---- Templates ----

export type StepTemplateId = 'int8x400' | 'int6x800' | 'int5x1000' | 'tempo3x10' | 'progression' | 'fartlek' | 'longFastFinish';

export const STEP_TEMPLATES: { id: StepTemplateId; kind: WorkoutKind }[] = [
  { id: 'int8x400', kind: 'intervals' },
  { id: 'int6x800', kind: 'intervals' },
  { id: 'int5x1000', kind: 'intervals' },
  { id: 'fartlek', kind: 'intervals' },
  { id: 'tempo3x10', kind: 'tempo' },
  { id: 'progression', kind: 'tempo' },
  { id: 'longFastFinish', kind: 'long' },
];

/** Paces in s/km for templates. Missing ones are derived from `easy`. */
export interface TemplatePaces {
  easy: number;
  tempo?: number;
  interval?: number;
}

/**
 * Builds a template's steps. With `paces`, work steps get pace ranges;
 * without, they have no target (train by feel).
 */
export function buildTemplate(id: StepTemplateId, paces?: TemplatePaces): WorkoutStep[] {
  const easy = paces?.easy;
  const tempo = paces ? paces.tempo ?? paces.easy * 0.88 : undefined;
  const interval = paces ? paces.interval ?? paces.easy * 0.8 : undefined;
  const at = (p: number | undefined, spread = 5) => (p ? paceRange(p, spread) : undefined);
  const wu = () => simpleStep('warmup', time(15 * 60));
  const cd = () => simpleStep('cooldown', time(10 * 60));
  switch (id) {
    case 'int8x400':
      return [wu(), repeatStep(8, [simpleStep('active', distance(400), at(interval)), simpleStep('recovery', distance(200))]), cd()];
    case 'int6x800':
      return [wu(), repeatStep(6, [simpleStep('active', distance(800), at(interval && interval + 5)), simpleStep('recovery', distance(400))]), cd()];
    case 'int5x1000':
      return [wu(), repeatStep(5, [simpleStep('active', distance(1000), at(interval && interval + 10)), simpleStep('recovery', time(120))]), cd()];
    case 'fartlek':
      return [wu(), repeatStep(8, [simpleStep('active', time(60), at(interval, 10)), simpleStep('recovery', time(60))]), cd()];
    case 'tempo3x10':
      return [wu(), repeatStep(3, [simpleStep('active', time(10 * 60), at(tempo)), simpleStep('recovery', time(120))]), cd()];
    case 'progression':
      return [
        simpleStep('warmup', distance(2000)),
        simpleStep('active', distance(3000), at(easy && tempo && (easy + tempo) / 2)),
        simpleStep('active', distance(2000), at(tempo)),
        simpleStep('cooldown', distance(1000)),
      ];
    case 'longFastFinish':
      return [simpleStep('active', distance(12000), at(easy, 10)), simpleStep('active', distance(3000), at(tempo))];
  }
}

// ---- Text format (CSV) ----

const KIND_TOKEN: Record<StepKind, string> = { warmup: 'wu', active: 'run', recovery: 'rec', cooldown: 'cd', rest: 'rest' };
const KIND_ALIASES: Record<string, StepKind> = {
  wu: 'warmup', warmup: 'warmup', 'warm-up': 'warmup', aq: 'warmup', aquec: 'warmup', 'aquec.': 'warmup', aquecimento: 'warmup',
  run: 'active', work: 'active', active: 'active', interval: 'active', tiro: 'active', esforço: 'active', esforco: 'active', forte: 'active',
  rec: 'recovery', recovery: 'recovery', jog: 'recovery', trote: 'recovery', recuperação: 'recovery', recuperacao: 'recovery',
  cd: 'cooldown', cooldown: 'cooldown', 'cool-down': 'cooldown', desaq: 'cooldown', 'desaq.': 'cooldown', desaquecimento: 'cooldown',
  rest: 'rest', pausa: 'rest', descanso: 'rest', parado: 'rest',
};

const num = (n: number) => String(Math.round(n * 1000) / 1000);
const clock = (s: number) => formatDuration(s);

function stepToText(s: SimpleStep): string {
  const d = s.duration;
  let dur: string;
  if (d.type === 'distance') dur = d.meters < 1000 || d.meters % 10 ? `${num(d.meters)}m` : `${num(d.meters / 1000)}km`;
  else if (d.type === 'time') dur = d.seconds < 60 ? `${d.seconds}s` : d.seconds % 60 === 0 ? `${d.seconds / 60}min` : clock(d.seconds);
  else dur = 'lap';
  let out = `${KIND_TOKEN[s.kind]} ${dur}`;
  const tg = s.target;
  if (tg?.type === 'pace') out += ` @${clock(tg.min)}${tg.max !== tg.min ? `-${clock(tg.max)}` : ''}`;
  else if (tg && 'zone' in tg) out += ` @z${tg.zone}`;
  else if (tg) out += ` @${tg.min}${tg.max !== tg.min ? `-${tg.max}` : ''}bpm`;
  if (s.note) out += ` [${s.note.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/[;\n\r]/g, ' ')}]`;
  return out;
}

/** Steps → "wu 15min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min". */
export function stepsToText(steps: WorkoutStep[]): string {
  return steps
    .map((s) => (s.type === 'repeat' ? `${s.times}x(${s.steps.map(stepToText).join(', ')})` : stepToText(s)))
    .join('; ');
}

/** Splits at separators outside () and []. `isSep` sees the text and index. */
function splitTop(text: string, isSep: (s: string, i: number) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    if (depth === 0 && isSep(text, i)) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseStepDuration(v: string): StepDuration | undefined {
  const s = v.trim().toLowerCase().replace(/\s+/g, ' ');
  if (['lap', 'open', 'livre', 'até o lap', 'ate o lap'].includes(s)) return openDuration();
  const m = /^(\d+(?:[.,]\d+)?) ?(km|m|min|mins|s|sec|seg|h)$/.exec(s);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    const unit = m[2];
    if (unit === 'km') return distance(Math.round(n * 1000));
    if (unit === 'm') return distance(Math.round(n));
    if (unit === 'h') return time(Math.round(n * 3600));
    if (unit.startsWith('min')) return time(Math.round(n * 60));
    return time(Math.round(n));
  }
  const c = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (c && +c[3] < 60) return time((c[1] ? +c[1] * 3600 : 0) + +c[2] * 60 + +c[3]);
  return undefined;
}

function parseStepTarget(v: string): StepTarget | undefined | null {
  const s = v.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return undefined;
  const z = /^z(?:one)?([1-5])$/.exec(s);
  if (z) return { type: 'hr', zone: +z[1] };
  const b = /^(\d{2,3})(?:[-–](\d{2,3}))?bpm$/.exec(s);
  if (b) {
    const lo = +b[1], hi = b[2] ? +b[2] : lo;
    return { type: 'hr', min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  const p = /^(\d{1,2}:\d{2})(?:[-–](\d{1,2}:\d{2}))?(?:\/km|min\/km)?$/.exec(s);
  if (p) {
    const a = parsePace(p[1]), c = p[2] ? parsePace(p[2]) : a;
    if (a === null || c === null) return null;
    return { type: 'pace', min: Math.min(a, c), max: Math.max(a, c) };
  }
  return null;
}

function parseSimple(text: string): SimpleStep | undefined {
  let note: string | undefined;
  const body = text.replace(/\[([^\]]*)\]/g, (_m, n: string) => {
    note = n.trim() || undefined;
    return ' ';
  });
  const [left, ...rest] = body.split('@');
  if (rest.length > 1) return undefined;
  const tokens = left.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  let kind: StepKind = 'active';
  const alias = KIND_ALIASES[tokens[0].toLowerCase()];
  if (alias) {
    kind = alias;
    tokens.shift();
  }
  const duration = parseStepDuration(tokens.join(' '));
  if (!duration) return undefined;
  const target = rest.length ? parseStepTarget(rest[0]) : undefined;
  if (target === null) return undefined;
  return simpleStep(kind, duration, target, note);
}

/** Parses the text format. Returns undefined when it isn't valid. */
export function parseStepsText(text: string): WorkoutStep[] | undefined {
  const items = splitTop(text, (s, i) => s[i] === ';' || s[i] === '\n' || s[i] === '\r');
  if (!items.length) return undefined;
  const steps: WorkoutStep[] = [];
  for (const item of items) {
    const r = /^(\d+)\s*[x×]\s*\(([\s\S]*)\)$/i.exec(item);
    if (r) {
      // Commas split steps, except a decimal comma between two digits.
      const parts = splitTop(r[2], (s, i) => s[i] === ',' && !(/\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? '')));
      const children = parts.map(parseSimple);
      if (!children.length || children.some((c) => !c)) return undefined;
      steps.push(repeatStep(+r[1], children as SimpleStep[]));
    } else {
      const s = parseSimple(item);
      if (!s) return undefined;
      steps.push(s);
    }
  }
  return validateSteps(steps) ? undefined : steps;
}
