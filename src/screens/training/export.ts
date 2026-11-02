/**
 * Plan / workout export for calendars and watch platforms:
 *  - iCalendar (.ics): one all-day event per workout (RFC 5545).
 *  - Garmin TCX workouts (.tcx): TrainingCenterDatabase v2 <Workouts>.
 *  - FIT workout (.fit): a single workout for the watch (see fit.ts).
 * CSV and the app's JSON live in csv.ts.
 */
import { encodeWorkoutFit } from './fit';
import { addDays } from './dates';
import { t } from './i18n';
import { paceRange, simpleStep, stepKindLabel, stepsSummary } from './structure';
import type { PlannedWorkout, SimpleStep, TrainingPlan, WorkoutKind, WorkoutStep } from './types';
import { kindLabel, targetText, workoutTitle } from './view';

/** Kinds sent to watches (TCX/FIT): runs only. */
export const RUNNING_KINDS: WorkoutKind[] = ['easy', 'long', 'tempo', 'intervals', 'recovery', 'race'];
export const isRunning = (w: Pick<PlannedWorkout, 'kind'>) => RUNNING_KINDS.includes(w.kind);

type ExportWorkout = Pick<PlannedWorkout, 'id' | 'date' | 'kind' | 'title' | 'distance' | 'duration' | 'pace' | 'description' | 'steps'>;

// ---- Files ----

/** "Meu Plano 10K!" → "meu-plano-10k". */
export const fileSlug = (s: string, fallback = 'plan') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;

/** Saves data as a file through a temporary <a download>. */
export function downloadFile(data: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportFilter {
  includeRest?: boolean;
  /** Only workouts on or after this date (YYYY-MM-DD). */
  from?: string;
  /** Only running workouts (watch formats). */
  runningOnly?: boolean;
}

export function selectWorkouts<T extends ExportWorkout>(workouts: T[], f: ExportFilter = {}): T[] {
  return workouts
    .filter((w) => (f.includeRest || w.kind !== 'rest') && (!f.from || w.date >= f.from) && (!f.runningOnly || isRunning(w)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The steps a watch should run: the workout's own structure, or one step from
 * its distance / duration and a ±10 s pace range around its target pace.
 */
export function effectiveSteps(w: Pick<PlannedWorkout, 'distance' | 'duration' | 'pace' | 'steps'>): WorkoutStep[] {
  if (w.steps?.length) return w.steps;
  const duration = w.distance
    ? ({ type: 'distance', meters: Math.round(w.distance) } as const)
    : w.duration
      ? ({ type: 'time', seconds: Math.round(w.duration) } as const)
      : ({ type: 'open' } as const);
  return [simpleStep('active', duration, w.pace ? paceRange(w.pace, 10) : undefined)];
}

/** Description text: targets, structure and the workout's own description. */
export function workoutDetails(w: ExportWorkout): string {
  const lines: string[] = [];
  const target = targetText(w);
  if (target) lines.push(t('icsTarget', { value: target }));
  if (w.steps?.length) lines.push(t('icsSteps', { value: stepsSummary(w.steps) }));
  if (w.description) lines.push(w.description);
  return lines.join('\n');
}

// ---- iCalendar ----

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export const icsEscape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

const utf8 = new TextEncoder();

/** Folds a content line at 75 octets (continuations start with a space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = utf8.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // The leading space counts.
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const icsDate = (d: string) => d.replace(/-/g, '');
const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function exportIcs(
  calendarName: string,
  workouts: ExportWorkout[],
  opts: { now?: number } = {},
): string {
  const stamp = icsStamp(opts.now ?? Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lapwing//Training plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];
  for (const w of workouts) {
    const summary = w.kind === 'rest' && !w.title ? t('icsRestDay') : workoutTitle(w);
    const details = workoutDetails(w);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${w.id.replace(/[^\w.-]/g, '')}@lapwing`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(w.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(w.date, 1))}`,
      `SUMMARY:${icsEscape(summary)}`,
      ...(details ? [`DESCRIPTION:${icsEscape(details)}`] : []),
      `CATEGORIES:${icsEscape(kindLabel(w.kind))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export const exportPlanIcs = (plan: Pick<TrainingPlan, 'name'>, workouts: ExportWorkout[], opts: { now?: number } = {}) =>
  exportIcs(plan.name, workouts, opts);

// ---- Garmin TCX workouts ----

const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
    // Characters XML 1.0 doesn't allow.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** RestrictedToken_t: collapsed whitespace, 1–15 characters. */
export function tcxName(s: string, max = 15): string {
  const chars = [...s.replace(/\s+/g, ' ').trim()];
  return chars.slice(0, max).join('').trim() || 'Run';
}

const ushort = (n: number) => Math.max(1, Math.min(65535, Math.round(n)));
const speed = (pace: number) => (1000 / pace).toFixed(3);

function tcxStep(s: SimpleStep, id: number, tag: 'Step' | 'Child', pad: string): string {
  const d = s.duration;
  const duration =
    d.type === 'distance'
      ? `<Duration xsi:type="Distance_t"><Meters>${ushort(d.meters)}</Meters></Duration>`
      : d.type === 'time'
        ? `<Duration xsi:type="Time_t"><Seconds>${ushort(d.seconds)}</Seconds></Duration>`
        : '<Duration xsi:type="UserInitiated_t"/>';
  const tg = s.target;
  let target = '<Target xsi:type="None_t"/>';
  if (tg?.type === 'pace') {
    target = `<Target xsi:type="Speed_t"><SpeedZone xsi:type="CustomSpeedZone_t"><ViewAs>Pace</ViewAs><LowInMetersPerSecond>${speed(tg.max)}</LowInMetersPerSecond><HighInMetersPerSecond>${speed(tg.min)}</HighInMetersPerSecond></SpeedZone></Target>`;
  } else if (tg && 'zone' in tg) {
    target = `<Target xsi:type="HeartRate_t"><HeartRateZone xsi:type="PredefinedHeartRateZone_t"><Number>${tg.zone}</Number></HeartRateZone></Target>`;
  } else if (tg) {
    target = `<Target xsi:type="HeartRate_t"><HeartRateZone xsi:type="CustomHeartRateZone_t"><Low xsi:type="HeartRateInBeatsPerMinute_t"><Value>${tg.min}</Value></Low><High xsi:type="HeartRateInBeatsPerMinute_t"><Value>${tg.max}</Value></High></HeartRateZone></Target>`;
  }
  const intensity = s.kind === 'rest' || s.kind === 'recovery' ? 'Resting' : 'Active';
  return [
    `${pad}<${tag} xsi:type="Step_t">`,
    `${pad}  <StepId>${id}</StepId>`,
    `${pad}  <Name>${xml(tcxName(stepKindLabel(s.kind)))}</Name>`,
    `${pad}  ${duration}`,
    `${pad}  <Intensity>${intensity}</Intensity>`,
    `${pad}  ${target}`,
    `${pad}</${tag}>`,
  ].join('\n');
}

function tcxSteps(steps: WorkoutStep[]): string[] {
  let id = 0;
  const out: string[] = [];
  for (const s of steps) {
    if (s.type === 'step') out.push(tcxStep(s, ++id, 'Step', '      '));
    else if (s.times < 2) s.steps.forEach((c) => out.push(tcxStep(c, ++id, 'Step', '      ')));
    else {
      const repeatId = ++id;
      const children = s.steps.map((c) => tcxStep(c, ++id, 'Child', '        '));
      out.push(
        [
          '      <Step xsi:type="Repeat_t">',
          `        <StepId>${repeatId}</StepId>`,
          `        <Repetitions>${Math.min(99, s.times)}</Repetitions>`,
          ...children,
          '      </Step>',
        ].join('\n'),
      );
    }
  }
  return out;
}

/**
 * TCX workouts file. With `schedule`, each workout gets <ScheduledOn> with its
 * date. Names are unique and at most 15 characters, as the schema requires.
 */
export function exportTcx(workouts: ExportWorkout[], opts: { schedule?: boolean } = {}): string {
  const used = new Set<string>();
  const items = workouts.filter(isRunning).map((w) => {
    const base = opts.schedule ? `${w.date.slice(5)} ${workoutTitle(w)}` : workoutTitle(w);
    let name = tcxName(base);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${tcxName(base, 15 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    const notes = workoutDetails(w);
    return [
      '    <Workout Sport="Running">',
      `      <Name>${xml(name)}</Name>`,
      ...tcxSteps(effectiveSteps(w)),
      ...(opts.schedule ? [`      <ScheduledOn>${w.date}</ScheduledOn>`] : []),
      ...(notes ? [`      <Notes>${xml(notes)}</Notes>`] : []),
      '    </Workout>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">',
    '  <Workouts>',
    ...items,
    '  </Workouts>',
    '</TrainingCenterDatabase>',
    '',
  ].join('\n');
}

// ---- FIT ----

/** A single workout as a .fit workout file. */
export function exportWorkoutFit(w: ExportWorkout, opts: { now?: number } = {}): Uint8Array<ArrayBuffer> {
  return encodeWorkoutFit({
    name: workoutTitle(w),
    steps: effectiveSteps(w),
    stepName: (s) => stepKindLabel(s.kind),
    timeCreated: opts.now ?? Date.now(),
  });
}
