/**
 * Plan import/export. CSV columns (header required, any order, English or
 * Portuguese names; comma, semicolon or tab separated):
 *
 *   date,kind,title,distance_km,duration,pace,description
 *   2026-11-03,easy,Easy run,6,,6:15,Conversational pace
 *
 * - date: YYYY-MM-DD or DD/MM/YYYY
 * - kind: easy, long, tempo, intervals, recovery, race, rest, cross
 *         (also leve, longão, intervalado, regenerativo, prova, descanso…)
 * - distance_km: number, "," or "." as decimal separator
 * - duration: h:mm:ss, mm:ss or minutes
 * - pace: m:ss per km
 * - steps (optional column): structured workout in the text format of
 *   structure.ts, e.g. "wu 15min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min"
 * - status (optional column): done / skipped (also feito, pulado…); empty
 *   leaves the workout to automatic matching with imported runs
 *
 * JSON: { "name", "goal", "raceDate", "workouts": [ { date, kind, title,
 * distanceKm, duration, pace, description, steps, status } ] } or just the
 * workouts array. `steps` is an array of WorkoutStep objects or the text format.
 */
import { parsePace } from '../../format';
import { addDays, isDateStr, parseDateInput, weekStart } from './dates';
import { parseStepsText, sanitizeSteps, stepsToText, stripStepIds } from './structure';
import { PLAN_GOALS, WORKOUT_KINDS, type PlanGoal, type PlannedWorkout, type TrainingPlan, type WorkoutDraft, type WorkoutKind } from './types';

export type ImportErrorCode = 'empty' | 'columns' | 'json' | 'date' | 'kind' | 'distance' | 'duration' | 'pace' | 'steps' | 'status';

export interface ImportError {
  /** 1-based line (CSV) or item number (JSON); 0 for whole-file errors. */
  line: number;
  code: ImportErrorCode;
  value?: string;
}

export interface PlanImport {
  name?: string;
  goal?: PlanGoal;
  raceDate?: string;
  workouts: WorkoutDraft[];
  errors: ImportError[];
}

const KIND_ALIASES: Record<string, WorkoutKind> = {
  easy: 'easy', leve: 'easy', 'corrida leve': 'easy', rodagem: 'easy', base: 'easy',
  long: 'long', 'long run': 'long', longo: 'long', longao: 'long', longão: 'long',
  tempo: 'tempo', 'tempo run': 'tempo', limiar: 'tempo', ritmo: 'tempo', threshold: 'tempo',
  intervals: 'intervals', interval: 'intervals', intervalado: 'intervals', tiros: 'intervals', tiro: 'intervals', fartlek: 'intervals',
  recovery: 'recovery', regenerativo: 'recovery', recuperacao: 'recovery', recuperação: 'recovery',
  race: 'race', prova: 'race', corrida: 'race', competicao: 'race', competição: 'race',
  rest: 'rest', descanso: 'rest', off: 'rest', folga: 'rest',
  cross: 'cross', strength: 'cross', fortalecimento: 'cross', musculacao: 'cross', musculação: 'cross', academia: 'cross', 'cross-training': 'cross',
};

const COLUMN_ALIASES: Record<string, keyof RawRow> = {
  date: 'date', data: 'date', dia: 'date',
  kind: 'kind', type: 'kind', tipo: 'kind',
  title: 'title', titulo: 'title', título: 'title', name: 'title', nome: 'title', treino: 'title', workout: 'title',
  distance_km: 'distance', distance: 'distance', km: 'distance', distancia: 'distance', distância: 'distance', distancia_km: 'distance', distância_km: 'distance',
  duration: 'duration', duracao: 'duration', duração: 'duration', tempo: 'duration', time: 'duration',
  pace: 'pace', ritmo: 'pace',
  description: 'description', descricao: 'description', descrição: 'description', notes: 'description', notas: 'description', obs: 'description',
  steps: 'steps', structure: 'steps', estrutura: 'steps', etapas: 'steps', passos: 'steps',
  status: 'status', situacao: 'status', situação: 'status', estado: 'status',
};

const STATUS_ALIASES: Record<string, NonNullable<WorkoutDraft['status']>> = {
  done: 'done', completed: 'done', yes: 'done', feito: 'done', feita: 'done', concluido: 'done', concluído: 'done', realizado: 'done', sim: 'done', ok: 'done', x: 'done', '✓': 'done',
  skipped: 'skipped', skip: 'skipped', missed: 'skipped', pulado: 'skipped', pulada: 'skipped', 'nao feito': 'skipped', 'não feito': 'skipped', perdido: 'skipped', no: 'skipped', nao: 'skipped', não: 'skipped',
};

interface RawRow {
  date?: string;
  kind?: string;
  title?: string;
  distance?: string;
  duration?: string;
  pace?: string;
  description?: string;
  steps?: string;
  status?: string;
}

export function parseKind(s: string): WorkoutKind | undefined {
  const v = s.trim().toLowerCase();
  return (WORKOUT_KINDS as string[]).includes(v) ? (v as WorkoutKind) : KIND_ALIASES[v];
}

/** "1:05:00" → 3900, "45:00" → 2700, "45" → 2700 (minutes). */
export function parseDuration(s: string): number | undefined {
  const v = s.trim().replace(',', '.');
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const min = Number(v);
    return min > 0 ? Math.round(min * 60) : undefined;
  }
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || +m[3] > 59 || (m[1] !== undefined && +m[2] > 59)) return undefined;
  const secs = (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
  return secs > 0 ? secs : undefined;
}

/** Validates one row; pushes errors and returns the workout if it is valid. */
function rowToDraft(raw: RawRow, line: number, errors: ImportError[]): WorkoutDraft | undefined {
  const values = Object.values(raw).map((v) => (v ?? '').trim());
  if (values.every((v) => v === '')) return undefined;
  let ok = true;
  const fail = (code: ImportErrorCode, value = '') => {
    errors.push({ line, code, value });
    ok = false;
  };

  const date = parseDateInput(raw.date ?? '');
  if (!date) fail('date', raw.date);
  const kind = parseKind(raw.kind ?? '');
  if (!kind) fail('kind', raw.kind);

  let distance: number | undefined;
  const dRaw = (raw.distance ?? '').trim();
  if (dRaw) {
    const km = Number(dRaw.replace(',', '.'));
    if (!Number.isFinite(km) || km < 0 || km > 500) fail('distance', dRaw);
    else if (km > 0) distance = Math.round(km * 1000);
  }
  let duration: number | undefined;
  const tRaw = (raw.duration ?? '').trim();
  if (tRaw) {
    duration = parseDuration(tRaw);
    if (duration === undefined) fail('duration', tRaw);
  }
  let pace: number | undefined;
  const pRaw = (raw.pace ?? '').trim().replace(/\s*(\/km|min\/km)$/i, '');
  if (pRaw) {
    pace = parsePace(pRaw) ?? undefined;
    if (pace === undefined) fail('pace', pRaw);
  }
  let steps: WorkoutDraft['steps'];
  const sRaw = (raw.steps ?? '').trim();
  if (sRaw) {
    steps = parseStepsText(sRaw);
    if (!steps) fail('steps', sRaw.length > 60 ? `${sRaw.slice(0, 60)}…` : sRaw);
  }
  let status: WorkoutDraft['status'];
  const stRaw = (raw.status ?? '').trim();
  if (stRaw) {
    status = STATUS_ALIASES[stRaw.toLowerCase().replace(/\s+/g, ' ')];
    if (!status) fail('status', stRaw);
  }
  if (!ok || !date || !kind) return undefined;

  const draft: WorkoutDraft = { date, kind, title: (raw.title ?? '').trim() };
  if (distance) draft.distance = distance;
  if (duration) draft.duration = duration;
  if (pace) draft.pace = pace;
  const description = (raw.description ?? '').trim();
  if (description) draft.description = description;
  if (steps) draft.steps = steps;
  if (status) draft.status = status;
  return draft;
}

/** Splits CSV text into rows of fields, handling quotes and "" escapes. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/^﻿/, '').replace(/\s+/g, '_');

export function parsePlanCsv(text: string): PlanImport {
  const errors: ImportError[] = [];
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  if (!clean.trim()) return { workouts: [], errors: [{ line: 0, code: 'empty' }] };
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];

  const rows = splitCsv(clean, delimiter);
  const header = rows[0].map((h) => COLUMN_ALIASES[normalizeHeader(h)] ?? COLUMN_ALIASES[normalizeHeader(h).replace(/_/g, ' ')]);
  if (!header.includes('date') || !header.includes('kind')) {
    return { workouts: [], errors: [{ line: 1, code: 'columns' }] };
  }

  const workouts: WorkoutDraft[] = [];
  rows.slice(1).forEach((fields, i) => {
    const raw: RawRow = {};
    header.forEach((key, col) => {
      if (key) raw[key] = fields[col];
    });
    const draft = rowToDraft(raw, i + 2, errors);
    if (draft) workouts.push(draft);
  });
  if (!workouts.length && !errors.length) errors.push({ line: 0, code: 'empty' });
  return { workouts, errors };
}

export function parsePlanJson(text: string): PlanImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { workouts: [], errors: [{ line: 0, code: 'json' }] };
  }
  const obj = (Array.isArray(data) ? { workouts: data } : data) as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.workouts)) {
    return { workouts: [], errors: [{ line: 0, code: 'json' }] };
  }
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const errors: ImportError[] = [];
  const workouts: WorkoutDraft[] = [];
  (obj.workouts as Record<string, unknown>[]).forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push({ line: i + 1, code: 'date' });
      return;
    }
    const raw: RawRow = {
      date: str(item.date),
      kind: str(item.kind ?? item.type),
      title: str(item.title ?? item.name),
      distance: str(item.distanceKm ?? item.distance_km ?? item.km),
      duration: str(item.duration),
      pace: str(item.pace),
      description: str(item.description),
      steps: typeof item.steps === 'string' ? item.steps : '',
      status: str(item.status),
    };
    let steps: WorkoutDraft['steps'];
    if (Array.isArray(item.steps) && item.steps.length) {
      steps = sanitizeSteps(item.steps);
      if (!steps) {
        errors.push({ line: i + 1, code: 'steps', value: '[…]' });
        return;
      }
    }
    const draft = rowToDraft(raw, i + 1, errors);
    if (draft && steps) draft.steps = steps;
    if (draft) workouts.push(draft);
  });
  if (!workouts.length && !errors.length) errors.push({ line: 0, code: 'empty' });

  const goal = PLAN_GOALS.find((g) => g === str(obj.goal).toLowerCase());
  const raceDate = isDateStr(str(obj.raceDate)) ? str(obj.raceDate) : undefined;
  return { name: str(obj.name).trim() || undefined, goal, raceDate, workouts, errors };
}

/** Picks the parser from the file name or content. */
export function parsePlanFile(text: string, fileName = ''): PlanImport {
  const t = text.trim();
  return fileName.toLowerCase().endsWith('.json') || t.startsWith('{') || t.startsWith('[')
    ? parsePlanJson(text)
    : parsePlanCsv(text);
}

// ---- Export ----

const CSV_HEADER = 'date,kind,title,distance_km,duration,pace,description';

const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const mmss = (s: number) => {
  const r = Math.round(s);
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const sec = String(r % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * CSV export. The "steps" and "status" columns are only added when some
 * workout is structured or manually marked.
 */
export function exportPlanCsv(workouts: Pick<PlannedWorkout, keyof WorkoutDraft>[]): string {
  const withSteps = workouts.some((w) => w.steps?.length);
  const withStatus = workouts.some((w) => w.status);
  const lines = [...workouts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => {
      const fields = [
        w.date,
        w.kind,
        w.title,
        w.distance ? String(Math.round(w.distance / 10) / 100) : '',
        w.duration ? mmss(w.duration) : '',
        w.pace ? mmss(w.pace) : '',
        w.description ?? '',
      ];
      if (withSteps) fields.push(w.steps?.length ? stepsToText(w.steps) : '');
      if (withStatus) fields.push(w.status ?? '');
      return fields.map(csvField).join(',');
    });
  const header = [CSV_HEADER, ...(withSteps ? ['steps'] : []), ...(withStatus ? ['status'] : [])].join(',');
  return [header, ...lines].join('\n') + '\n';
}

/** The app's own JSON format (read back by parsePlanJson). */
export function exportPlanJson(plan: Pick<TrainingPlan, 'name' | 'goal' | 'raceDate'>, workouts: Pick<PlannedWorkout, keyof WorkoutDraft>[]): string {
  const items = [...workouts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({
      date: w.date,
      kind: w.kind,
      title: w.title,
      ...(w.distance ? { distanceKm: Math.round(w.distance) / 1000 } : {}),
      ...(w.duration ? { duration: mmss(w.duration) } : {}),
      ...(w.pace ? { pace: mmss(w.pace) } : {}),
      ...(w.description ? { description: w.description } : {}),
      ...(w.steps?.length ? { steps: stripStepIds(w.steps) } : {}),
      ...(w.status ? { status: w.status } : {}),
    }));
  return JSON.stringify({ format: 'lapwing-plan', version: 1, name: plan.name, goal: plan.goal, ...(plan.raceDate ? { raceDate: plan.raceDate } : {}), workouts: items }, null, 2) + '\n';
}

/** Example rows for the downloadable templates, starting next Monday. */
function templateRows(today: string): WorkoutDraft[] {
  const mon = addDays(weekStart(today), 7);
  return [
    {
      date: addDays(mon, 1),
      kind: 'intervals',
      title: '6x800 m',
      distance: 10300,
      description: 'Warm up 2 km, 6x800 m @ 4:30, 400 m jog, cool down 1.5 km',
      steps: parseStepsText('wu 2km; 6x(run 800m @4:25-4:35, rec 400m); cd 1.5km'),
    },
    { date: addDays(mon, 3), kind: 'easy', title: 'Easy run', distance: 6000, pace: 375, description: 'Conversational pace' },
    { date: addDays(mon, 4), kind: 'cross', title: 'Strength', duration: 2700 },
    { date: addDays(mon, 5), kind: 'rest', title: 'Rest' },
    { date: addDays(mon, 6), kind: 'long', title: 'Long run', distance: 12000, pace: 390 },
  ];
}

export function csvTemplate(today: string): string {
  return exportPlanCsv(templateRows(today));
}

export function jsonTemplate(today: string): string {
  const workouts = templateRows(today).map((w) => ({
    date: w.date,
    kind: w.kind,
    title: w.title,
    ...(w.distance ? { distanceKm: w.distance / 1000 } : {}),
    ...(w.duration ? { duration: mmss(w.duration) } : {}),
    ...(w.pace ? { pace: mmss(w.pace) } : {}),
    ...(w.description ? { description: w.description } : {}),
    ...(w.steps ? { steps: stepsToText(w.steps) } : {}),
  }));
  return JSON.stringify({ name: 'My 10K plan', goal: '10k', raceDate: addDays(weekStart(today), 8 * 7 + 6), workouts }, null, 2) + '\n';
}
