import { GpxError } from '../gpx/parse';
import { computeSummary } from './analysis';
import { listActivities, newId, saveActivity } from './db';
import { gunzip, isGzip } from './gzip';
import { parseActivityGpx, type ParsedActivity } from './parse-activity';
import { parseActivityFit } from './parse-fit';
import { parseActivityTcx } from './parse-tcx';
import { defaultShoeId, isRunType } from './shoes';
import type { Activity, ActivityType, TrackPoint } from './types';
import { ZipError } from './zip';

/**
 * Why a file (or a row of a Strava archive) was not imported:
 * - `invalid`: not an activity file (or not a ZIP archive)
 * - `empty`: no track points (kept for compatibility; parsers' `empty` is now reported as `no-gps`)
 * - `no-gps`: the activity has no GPS points (treadmill, indoor, gym)
 * - `duplicate`: already in the app (`existingId` points to it)
 * - `read`: couldn't read or decompress the file (or it is missing from the archive)
 * - `unsupported`: a format or ZIP feature the app doesn't read (encryption, other compression…)
 * - `ignored-type`: another sport (rides, weight training…); only runs and walks are imported
 * - `manual`: an activity entered by hand on Strava, without a file
 * - `save`: couldn't save to the browser's database (e.g. storage full)
 */
export type ImportErrorCode =
  | 'invalid'
  | 'empty'
  | 'duplicate'
  | 'read'
  | 'no-gps'
  | 'unsupported'
  | 'ignored-type'
  | 'manual'
  | 'save';

export interface ImportFailure {
  /** File name, or the path inside the archive. */
  fileName: string;
  code: ImportErrorCode;
  existingId?: string;
  /** Activity name, when known (from the Strava archive's activities.csv). */
  name?: string;
}

export interface ImportResult {
  imported: Activity[];
  failed: ImportFailure[];
  /** The import was stopped by the signal; what was imported before is kept. */
  cancelled: boolean;
}

export interface ImportProgress {
  /** `open` while reading an archive's index, `import` while handling activities. */
  phase: 'open' | 'import';
  done: number;
  total: number;
}

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
}

export type ActivityFormat = 'gpx' | 'fit' | 'tcx';

/** Thrown when a file is not in a format the app reads. */
export class UnsupportedFileError extends Error {
  constructor(fileName: string) {
    super(`Unsupported file: ${fileName}`);
    this.name = 'UnsupportedFileError';
  }
}

const ACTIVITY_EXT = /\.(gpx|fit|tcx)(\.gz)?$/i;

/** Whether a file name looks like an activity file (`.gpx`, `.fit`, `.tcx`, optionally `.gz`). */
export const isActivityFileName = (name: string) => ACTIVITY_EXT.test(name);

/** Format from the file name, ignoring a `.gz` suffix. */
export function formatFromName(name: string): ActivityFormat | undefined {
  const m = /\.(gpx|fit|tcx)(?:\.gz)?$/i.exec(name);
  return m ? (m[1].toLowerCase() as ActivityFormat) : undefined;
}

/** File name without folders and without the activity extension(s), for a default activity name. */
export function displayName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.gz$/i, '').replace(/\.(gpx|fit|tcx)$/i, '') || base;
}

const textDecoder = new TextDecoder('utf-8');

/**
 * Format from the content: the `.FIT` signature at bytes 8–11, or the XML
 * root element (`gpx` or `TrainingCenterDatabase`, any namespace prefix).
 */
export function sniffFormat(bytes: Uint8Array): ActivityFormat | undefined {
  if (bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54) {
    return 'fit';
  }
  const head = textDecoder
    .decode(bytes.subarray(0, 4096))
    .replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>/g, '');
  const root = /<\s*(?:[\w.-]+:)?([\w.-]+)/.exec(head)?.[1].toLowerCase();
  if (root === 'gpx') return 'gpx';
  if (root === 'trainingcenterdatabase') return 'tcx';
  return undefined;
}

/**
 * Parses an activity file of any supported format: GPX, FIT or TCX, each
 * optionally gzipped. The format comes from the content, else from the name.
 * Throws `GpxError` from the parsers, or `UnsupportedFileError`.
 */
export async function parseActivityBytes(bytes: Uint8Array, fileName: string): Promise<ParsedActivity> {
  const data = isGzip(bytes) ? await gunzip(bytes) : bytes;
  const format = sniffFormat(data) ?? formatFromName(fileName);
  if (format === 'fit') return parseActivityFit(data);
  if (!format) throw new UnsupportedFileError(fileName);
  // Some exports (Strava's TCX) put spaces before the XML declaration, which XML parsers reject.
  const text = textDecoder.decode(data).trimStart();
  return format === 'tcx' ? parseActivityTcx(text) : parseActivityGpx(text);
}

/** The import outcome code for an error thrown while reading or parsing a file. */
export function failureCode(err: unknown): ImportErrorCode {
  if (err instanceof GpxError) return err.code === 'empty' ? 'no-gps' : 'invalid';
  if (err instanceof UnsupportedFileError) return 'unsupported';
  if (err instanceof ZipError) return err.code === 'encrypted' || err.code === 'unsupported' ? 'unsupported' : 'read';
  return 'read';
}

/** Activity types the app imports. */
export const isImportedType = (type: ActivityType) => type === 'run' || type === 'trail-run' || type === 'walk';

/** Builds an Activity (not saved yet) from a parsed file. */
export function buildActivity(parsed: ParsedActivity, fileName: string, now = Date.now()) {
  const summary = computeSummary(parsed.points);
  const firstTime = parsed.points.find((p) => p.time !== undefined)?.time;
  const activity: Activity = {
    id: newId(),
    name: parsed.name || displayName(fileName),
    type: parsed.type,
    startTime: firstTime ?? now,
    hasStartTime: firstTime !== undefined,
    fileName,
    importedAt: now,
    summary,
  };
  return { activity, points: parsed.points };
}

/** Builds an Activity (not saved yet) from GPX text. */
export function activityFromGpx(text: string, fileName: string, now = Date.now()) {
  return buildActivity(parseActivityGpx(text), fileName, now);
}

/**
 * An existing activity that is the same one: the same Strava id, or a start
 * within 60 s and a distance within 50 m (the rule of the Strava sync, so a
 * run synced from the API and the same run from a file match).
 */
export function findDuplicate(
  candidate: Pick<Activity, 'startTime' | 'hasStartTime' | 'stravaId'> & { distance: number },
  existing: Activity[],
): Activity | undefined {
  if (candidate.stravaId !== undefined) {
    const same = existing.find((a) => a.stravaId === candidate.stravaId);
    if (same) return same;
  }
  if (!candidate.hasStartTime) return undefined;
  return existing.find(
    (a) =>
      a.hasStartTime &&
      Math.abs(a.startTime - candidate.startTime) <= 60_000 &&
      Math.abs(a.summary.distance - candidate.distance) < 50,
  );
}

/** Gives the browser a chance to paint and handle input between activities. */
export const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Saves a new activity with the default shoe for runs. Returns false when the database refused it. */
export async function saveImported(activity: Activity, points: TrackPoint[], shoeId: string | undefined): Promise<boolean> {
  if (shoeId && isRunType(activity.type)) activity.shoeId = shoeId;
  try {
    await saveActivity(activity, points);
    return true;
  } catch {
    return false;
  }
}

async function headBytes(file: Blob, n: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

const isZipName = (name: string) => /\.zip$/i.test(name);
const isZipMagic = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
/** Content that may be an activity: gzip, FIT, or text starting with `<` (after a BOM/whitespace). */
function mayBeActivity(b: Uint8Array): boolean {
  if (isGzip(b) || sniffFormat(b) === 'fit') return true;
  const text = textDecoder.decode(b).trimStart();
  return text.startsWith('<');
}

/**
 * Imports activity files: `.gpx`, `.fit`, `.tcx` (each optionally `.gz`) and
 * `.zip` archives (the Strava account export, see `importStravaArchive`).
 * Files are handled one by one and each new activity is saved right away, so
 * a cancelled import keeps what it saved. A file is skipped as a duplicate
 * when the same activity already exists (`findDuplicate`). New runs get the
 * default shoe.
 */
export async function importActivityFiles(files: File[], opts: ImportOptions = {}): Promise<ImportResult> {
  const { signal, onProgress } = opts;
  const result: ImportResult = { imported: [], failed: [], cancelled: false };
  const plain: File[] = [];
  const archives: File[] = [];
  for (const file of files) {
    if (isZipName(file.name)) archives.push(file);
    else if (isActivityFileName(file.name)) plain.push(file);
    else {
      // Unknown extension: look at the first bytes only (it may be a large unrelated file).
      try {
        const head = await headBytes(file, 64);
        if (isZipMagic(head)) archives.push(file);
        else if (mayBeActivity(head)) plain.push(file);
        else result.failed.push({ fileName: file.name, code: 'unsupported' });
      } catch {
        result.failed.push({ fileName: file.name, code: 'read' });
      }
    }
  }

  if (plain.length) {
    const [existing, shoeId] = await Promise.all([listActivities(), defaultShoeId()]);
    let done = 0;
    for (const file of plain) {
      if (plain.length > 1) onProgress?.({ phase: 'import', done, total: plain.length });
      if (done > 0) await yieldToLoop();
      if (signal?.aborted) {
        result.cancelled = true;
        return result;
      }
      done++;
      let built;
      try {
        const parsed = await parseActivityBytes(new Uint8Array(await file.arrayBuffer()), file.name);
        built = buildActivity(parsed, file.name);
      } catch (err) {
        result.failed.push({ fileName: file.name, code: failureCode(err) });
        continue;
      }
      const { activity, points } = built;
      const dup = findDuplicate({ ...activity, distance: activity.summary.distance }, existing);
      if (dup) {
        result.failed.push({ fileName: file.name, code: 'duplicate', existingId: dup.id });
        continue;
      }
      if (!(await saveImported(activity, points, shoeId))) {
        result.failed.push({ fileName: file.name, code: 'save' });
        continue;
      }
      result.imported.push(activity);
      existing.push(activity);
    }
    if (plain.length > 1) onProgress?.({ phase: 'import', done, total: plain.length });
  }

  if (archives.length) {
    // Loaded on demand: only needed for archives.
    const { importStravaArchive } = await import('./strava-archive');
    for (const file of archives) {
      if (signal?.aborted) {
        result.cancelled = true;
        break;
      }
      const r = await importStravaArchive(file, { signal, onProgress });
      result.imported.push(...r.imported);
      result.failed.push(...r.failed);
      if (r.cancelled) {
        result.cancelled = true;
        break;
      }
    }
  }
  return result;
}

/** Imports GPX files. Kept for callers of the GPX-only import; any supported format works. */
export const importGpxFiles = (files: File[], opts?: ImportOptions) => importActivityFiles(files, opts);
