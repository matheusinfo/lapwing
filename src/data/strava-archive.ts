/**
 * Import of the Strava account export (Strava → Settings → My Account →
 * "Download or delete your account" → Request archive). Works without a
 * Strava subscription or API app.
 *
 * The ZIP holds `activities.csv` (one row per activity, headers in the
 * account's language) and `activities/` with one file per activity, named by
 * an upload id: `.fit.gz`, `.gpx.gz`, `.tcx.gz` or uncompressed. The CSV row
 * links the Strava activity id, name, type and description to its file
 * (column "Filename"). Everything else in the archive (routes, media,
 * profile…) is ignored. Without a usable CSV every activity file is imported
 * with the name and type found in the file.
 */
import { listActivities } from './db';
import {
  buildActivity,
  failureCode,
  findDuplicate,
  isActivityFileName,
  isImportedType,
  parseActivityBytes,
  saveImported,
  yieldToLoop,
  type ImportErrorCode,
  type ImportOptions,
  type ImportResult,
} from './import';
import { defaultShoeId } from './shoes';
import type { Activity, ActivityType } from './types';
import { openZip, ZipError, type ZipArchive, type ZipEntry } from './zip';

// ---- CSV ----

/**
 * Parses RFC 4180 CSV: quoted fields with commas, newlines and doubled
 * quotes, CRLF/LF/CR line ends, an optional BOM. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** One row of activities.csv (the columns the import uses). */
export interface CsvActivity {
  /** Strava activity id as written in the CSV. */
  id: string;
  /** The id as a number, when numeric. */
  stravaId?: number;
  /** Localized date text, e.g. "Nov 1, 2026, 9:00:15 AM" or "1 de nov. de 2026, 09:00:15". */
  date: string;
  name: string;
  /** Localized activity type, e.g. "Run" or "Corrida". */
  type: string;
  description: string;
  /** Path inside the archive, e.g. "activities/123.fit.gz"; empty for manual activities. */
  fileName: string;
  /** Seconds. */
  elapsedTime?: number;
  /** Seconds. */
  movingTime?: number;
  /** Metres. */
  distance?: number;
}

/** Lowercase, without accents and surrounding spaces. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .toLowerCase()
    .trim();

// Known header labels (normalized). Positions are the fallback; the labels
// also cover exports whose columns moved.
const HEADER_LABELS = {
  id: ['activity id', 'id da atividade', 'id de la actividad', 'id de actividad', "id de l'activite", 'aktivitats-id'],
  date: ['activity date', 'data da atividade', 'fecha de la actividad', 'fecha de actividad', "date de l'activite", 'aktivitatsdatum'],
  name: ['activity name', 'nome da atividade', 'nombre de la actividad', 'nombre de actividad', "nom de l'activite", 'aktivitatsname'],
  type: ['activity type', 'tipo de atividade', 'tipo de actividad', "type d'activite", 'aktivitatsart', 'aktivitatstyp'],
  description: [
    'activity description',
    'descricao da atividade',
    'descripcion de la actividad',
    'descripcion de actividad',
    "description de l'activite",
    'aktivitatsbeschreibung',
  ],
  fileName: ['filename', 'file name', 'nome do arquivo', 'nombre de archivo', 'nombre del archivo', 'nom du fichier', 'nom de fichier', 'dateiname'],
};
/** 0-based positions in Strava's export. */
const POSITIONS = { id: 0, date: 1, name: 2, type: 3, description: 4, fileName: 12, elapsedTime: 15, movingTime: 16, distance: 17 };

const looksLikeActivityPath = (v: string) => isActivityFileName(v.trim());
const num = (s: string | undefined) => {
  const v = s === undefined || s.trim() === '' ? NaN : Number(s);
  return Number.isFinite(v) ? v : undefined;
};

/**
 * Reads activities.csv. Columns are found by their (localized) header label,
 * else by their position in Strava's export; the filename column is checked
 * by its values (`activities/…`). Returns null when the file doesn't look
 * like Strava's activities list.
 */
export function readActivitiesCsv(text: string): CsvActivity[] | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map(norm);
  const body = rows.slice(1);
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const find = (key: keyof typeof HEADER_LABELS) => {
    for (const label of HEADER_LABELS[key]) {
      const i = header.indexOf(label);
      if (i >= 0) return i;
    }
    return POSITIONS[key] < header.length ? POSITIONS[key] : -1;
  };

  const idCol = find('id');
  const ids = body.map((r) => at(r, idCol)).filter(Boolean);
  // Strava ids are numeric; anything else means this isn't the activities list.
  if (!ids.length || ids.filter((v) => /^\d+$/.test(v)).length < ids.length * 0.9) return null;

  // Filename: the labelled/positional column if its values look like paths, else the best column.
  const fileScore = (i: number) => {
    let ok = 0;
    let bad = 0;
    for (const r of body) {
      const v = at(r, i);
      if (v) looksLikeActivityPath(v) ? ok++ : bad++;
    }
    return ok > 0 && ok >= bad * 4 ? ok : 0;
  };
  let fileCol = find('fileName');
  if (fileCol < 0 || !fileScore(fileCol)) {
    fileCol = -1;
    let best = 0;
    for (let i = 0; i < header.length; i++) {
      const s = fileScore(i);
      if (s > best) [best, fileCol] = [s, i];
    }
  }

  const cols = { date: find('date'), name: find('name'), type: find('type'), description: find('description') };
  const posNum = (r: string[], i: number) => (i < header.length ? num(r[i]) : undefined);
  return body
    .filter((r) => at(r, idCol))
    .map((r) => {
      const id = at(r, idCol);
      const row: CsvActivity = {
        id,
        date: at(r, cols.date),
        name: at(r, cols.name),
        type: at(r, cols.type),
        description: at(r, cols.description),
        fileName: fileCol >= 0 ? at(r, fileCol) : '',
      };
      if (/^\d+$/.test(id) && Number.isSafeInteger(Number(id))) row.stravaId = Number(id);
      const elapsed = posNum(r, POSITIONS.elapsedTime);
      const moving = posNum(r, POSITIONS.movingTime);
      const distance = posNum(r, POSITIONS.distance);
      if (elapsed !== undefined) row.elapsedTime = elapsed;
      if (moving !== undefined) row.movingTime = moving;
      if (distance !== undefined) row.distance = distance;
      return row;
    });
}

// ---- Types and dates ----

/**
 * Strava activity type label (any of en, pt-BR, es, fr, de, it, nl) → app
 * type. `other` for sports the app doesn't import; undefined for labels it
 * doesn't know (the type found in the file is used then).
 */
export function mapStravaType(label: string): ActivityType | undefined {
  const t = norm(label);
  if (!t) return undefined;
  if (/trail|corrida (em|de|na) trilha|carrera (de|por|en) montana|course (en|de) sentier/.test(t)) return 'trail-run';
  if (/\brun\b|corrida|carrera|course a pied|\blauf(en)?\b|\bcorsa\b|hardlo/.test(t)) return 'run';
  if (/walk|caminhada|caminata|camminata|marche|spaziergang|\bgehen\b|wandel|hike|trilha|senderismo|excursion|randonnee|wander|escursionismo/.test(t)) {
    return 'walk';
  }
  if (
    /ride|pedal|cicl|bike|velo|radfahr|swim|nata|schwimm|nuoto|zwem|yoga|pilates|weight|peso|muscul|workout|treino|treinamento|entrenamiento|entrainement|training|crossfit|hiit|ellipt|elipt|row|remo|ski|esqui|snowboard|surf|skate|patin|golf|tenis|tennis|padel|squash|badminton|pickleball|soccer|futebol|futbol|climb|escalada|kayak|canoa|canoe|sail|vela|stair|escada|wheelchair|handcycle|cadeira/.test(
      t,
    )
  ) {
    return 'other';
  }
  return undefined;
}

// First 3–4 letters of month names (normalized) in en, pt, es, fr, de, it, nl.
const MONTHS: [string, number][] = [
  ['jan', 0], ['ene', 0], ['gen', 0],
  ['feb', 1], ['fev', 1], ['fevr', 1],
  ['mar', 2], ['maa', 2],
  ['apr', 3], ['abr', 3], ['avr', 3],
  ['may', 4], ['mai', 4], ['mag', 4], ['mei', 4],
  ['jun', 5], ['juin', 5], ['giu', 5],
  ['jul', 6], ['juil', 6], ['lug', 6],
  ['aug', 7], ['ago', 7], ['aou', 7],
  ['sep', 8], ['set', 8],
  ['oct', 9], ['out', 9], ['okt', 9], ['ott', 9],
  ['nov', 10],
  ['dec', 11], ['dez', 11], ['dic', 11],
];

function monthIndex(word: string): number | undefined {
  const w = norm(word);
  if (w.length < 3) return undefined;
  return MONTHS.find(([p]) => p.length === 4 && w.startsWith(p))?.[1] ?? MONTHS.find(([p]) => p.length === 3 && w.startsWith(p))?.[1];
}

/**
 * Parses the CSV activity date (taken as UTC, as Strava writes it) in the
 * export's localized formats: "Nov 1, 2026, 9:00:15 AM",
 * "1 de nov. de 2026, 09:00:15", "1 nov. 2026, 09:00:15", ISO dates.
 */
export function parseStravaDate(text: string): number | undefined {
  const s = text.replace(/[  ]/g, ' ').trim();
  if (!s) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, se] = iso;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se ?? 0));
  }
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?/i.exec(s);
  let rest = s;
  let hour = 0;
  let minute = 0;
  let second = 0;
  if (time) {
    hour = +time[1];
    minute = +time[2];
    second = +(time[3] ?? 0);
    const ampm = time[4]?.toLowerCase();
    if (ampm === 'p' && hour < 12) hour += 12;
    if (ampm === 'a' && hour === 12) hour = 0;
    rest = s.slice(0, time.index) + ' ' + s.slice(time.index + time[0].length);
  }
  const year = /\b(\d{4})\b/.exec(rest);
  if (!year) return undefined;
  rest = rest.replace(year[0], ' ');
  let month: number | undefined;
  for (const word of rest.match(/\p{L}+/gu) ?? []) {
    month = monthIndex(word);
    if (month !== undefined) break;
  }
  const day = /\b(\d{1,2})\b/.exec(rest);
  if (month === undefined || !day) return undefined;
  const ms = Date.UTC(+year[1], month, +day[1], hour, minute, second);
  return Number.isFinite(ms) && hour < 24 && minute < 60 ? ms : undefined;
}

// ---- Import ----

const basename = (p: string) => p.split('/').pop() ?? p;
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

interface WorkItem {
  row?: CsvActivity;
  entry?: ZipEntry;
}

/** Reads activities.csv from the archive (at the top level or in one folder). */
async function readCsv(zip: ZipArchive): Promise<{ rows: CsvActivity[] | null; prefix: string }> {
  const csv = zip.entries
    .filter((e) => !e.isDirectory && basename(e.name).toLowerCase() === 'activities.csv')
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!csv) return { rows: null, prefix: '' };
  const prefix = dirname(csv.name);
  try {
    const text = new TextDecoder('utf-8').decode(await zip.read(csv));
    return { rows: readActivitiesCsv(text), prefix };
  } catch {
    return { rows: null, prefix };
  }
}

/** Pairs CSV rows with archive entries; files without a row are added at the end. */
function planWork(zip: ZipArchive, rows: CsvActivity[] | null, prefix: string): { items: WorkItem[]; strava: boolean } {
  const files = zip.entries.filter((e) => !e.isDirectory && isActivityFileName(e.name));
  const folder = `${prefix}activities/`;
  const inFolder = files.filter((e) => e.name.startsWith(folder));
  // Strava layout: only `activities/`. Otherwise (a ZIP of activity files) everything but routes.
  const candidates = inFolder.length ? inFolder : files.filter((e) => !/(^|\/)routes\//i.test(e.name));
  const byPath = new Map(files.map((e) => [e.name, e]));
  const byBase = new Map(candidates.map((e) => [basename(e.name).toLowerCase(), e]));

  const used = new Set<ZipEntry>();
  const items: WorkItem[] = [];
  for (const row of rows ?? []) {
    let entry: ZipEntry | undefined;
    if (row.fileName) {
      const path = row.fileName.replace(/\\/g, '/').replace(/^\.?\//, '');
      entry = byPath.get(prefix + path) ?? byPath.get(path) ?? byBase.get(basename(path).toLowerCase());
      if (entry && used.has(entry)) entry = undefined;
      if (entry) used.add(entry);
    }
    items.push({ row, entry });
  }
  for (const entry of candidates) if (!used.has(entry)) items.push({ entry });
  return { items, strava: !!rows || inFolder.length > 0 };
}

interface Context {
  zip: ZipArchive;
  existing: Activity[];
  shoeId: string | undefined;
  strava: boolean;
  result: ImportResult;
}

/** Handles one activity. Returns whether it decompressed/parsed a file (worth yielding after). */
async function importItem({ row, entry }: WorkItem, ctx: Context): Promise<boolean> {
  const fileName = entry?.name ?? row?.fileName ?? '';
  const fail = (code: ImportErrorCode, existingId?: string) => {
    const f: ImportResult['failed'][number] = { fileName, code };
    if (row?.name) f.name = row.name;
    if (existingId) f.existingId = existingId;
    ctx.result.failed.push(f);
  };

  if (!entry) {
    // No file: entered by hand on Strava, or listed in the CSV but missing from the archive.
    fail(row?.fileName ? 'read' : 'manual');
    return false;
  }
  const csvType = row ? mapStravaType(row.type) : undefined;
  if (csvType === 'other') {
    fail('ignored-type');
    return false;
  }
  if (row?.stravaId !== undefined) {
    const same = ctx.existing.find((a) => a.stravaId === row.stravaId);
    if (same) {
      fail('duplicate', same.id);
      return false;
    }
  }

  let built;
  try {
    const parsed = await parseActivityBytes(await ctx.zip.read(entry), entry.name);
    built = buildActivity(parsed, entry.name);
  } catch (err) {
    fail(failureCode(err));
    return true;
  }
  const { activity, points } = built;
  activity.type = csvType ?? activity.type;
  if (!isImportedType(activity.type)) {
    fail('ignored-type');
    return true;
  }
  if (row?.name) activity.name = row.name;
  if (!activity.hasStartTime && row) {
    const date = parseStravaDate(row.date);
    if (date !== undefined) {
      activity.startTime = date;
      activity.hasStartTime = true;
    }
  }
  if (ctx.strava) activity.source = 'strava';
  if (row?.stravaId !== undefined) activity.stravaId = row.stravaId;
  if (row?.description) activity.notes = row.description;

  const dup = findDuplicate({ ...activity, distance: activity.summary.distance }, ctx.existing);
  if (dup) {
    fail('duplicate', dup.id);
    return true;
  }
  if (!(await saveImported(activity, points, ctx.shoeId))) {
    fail('save');
    return true;
  }
  ctx.result.imported.push(activity);
  ctx.existing.push(activity);
  return true;
}

/**
 * Imports the activities of a Strava account export archive. Only runs, trail
 * runs and walks (hikes become walks) are imported; other sports count as
 * `ignored-type`, rows without a file as `manual`, activities without GPS as
 * `no-gps`. Activities already in the app (same Strava id, or same start and
 * distance) are skipped.
 *
 * Activities are handled one at a time and saved right away, yielding to the
 * event loop in between, so the page stays responsive, a cancelled import
 * keeps its progress, and running it again skips what is already there.
 */
export async function importStravaArchive(file: Blob, opts: ImportOptions = {}): Promise<ImportResult> {
  const { signal, onProgress } = opts;
  const result: ImportResult = { imported: [], failed: [], cancelled: false };
  const archiveName = typeof (file as File).name === 'string' ? (file as File).name : 'archive.zip';

  onProgress?.({ phase: 'open', done: 0, total: 0 });
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (err) {
    result.failed.push({ fileName: archiveName, code: err instanceof ZipError && err.code === 'not-zip' ? 'invalid' : 'read' });
    return result;
  }
  const { rows, prefix } = await readCsv(zip);
  const { items, strava } = planWork(zip, rows, prefix);

  const [existing, shoeId] = await Promise.all([listActivities(), defaultShoeId()]);
  const ctx: Context = { zip, existing, shoeId, strava, result };
  let lastYield = Date.now();
  let done = 0;
  for (const item of items) {
    onProgress?.({ phase: 'import', done, total: items.length });
    if (signal?.aborted) {
      result.cancelled = true;
      return result;
    }
    const worked = await importItem(item, ctx);
    done++;
    // Always after a parsed file; skipped rows are cheap, so only now and then.
    if (worked || Date.now() - lastYield > 16) {
      await yieldToLoop();
      lastYield = Date.now();
    }
  }
  onProgress?.({ phase: 'import', done, total: items.length });
  return result;
}
