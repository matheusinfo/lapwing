/**
 * Plain-text formatting for what the coach reads (the snapshot and tool
 * results). Language-neutral on purpose: dot decimals, ISO dates, km and
 * min/km, so the model always gets the same shapes whatever the app language.
 */
import type { Activity } from '../../data/types';
import { formatDuration } from '../../format';
import { localDateOf, weekday } from '../training/dates';
import { stepsToText } from '../training/structure';
import type { PlannedWorkout, WorkoutStatus } from '../training/types';

export const km = (m: number, digits = 2) => `${(m / 1000).toFixed(digits)} km`;
export const dur = (s: number) => formatDuration(s);
export const pace = (sPerKm: number | undefined) =>
  sPerKm !== undefined && Number.isFinite(sPerKm) && sPerKm > 0 ? `${formatDuration(sPerKm)}/km` : '—';
export const round = (n: number | undefined, digits = 0) => (n === undefined ? '—' : n.toFixed(digits));

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "2026-11-14 Sat 07:12" in local time. */
export function when(ms: number): string {
  const d = new Date(ms);
  return `${localDateOf(ms)} ${WEEKDAYS[(d.getDay() + 6) % 7]} ${time.format(d)}`;
}

/** Collapses whitespace and cuts long user text (names, notes). */
export function clip(text: string | undefined, max = 160): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Markdown table cell: no pipes or line breaks. */
export const cell = (text: string) => text.replace(/\|/g, '/').replace(/\s+/g, ' ');

export function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

export const ACTIVITY_HEADER = ['id', 'when', 'name', 'type', 'distance', 'moving time', 'pace', 'climb', 'avg/max HR', 'cadence', 'RPE'];

export function activityRow(a: Activity): string[] {
  const s = a.summary;
  return [
    a.id,
    when(a.startTime),
    clip(a.name, 60),
    a.type,
    km(s.distance),
    s.has.time ? dur(s.movingTime) : '—',
    pace(s.avgPace),
    `+${Math.round(s.elevationGain)} m`,
    s.avgHr ? `${Math.round(s.avgHr)}/${Math.round(s.maxHr ?? s.avgHr)}` : '—',
    s.avgCadence ? `${Math.round(s.avgCadence)} spm` : '—',
    a.rpe ? String(a.rpe) : '—',
  ];
}

/** One line per workout: "2026-11-16 Mon · tempo · Limiar · 8.00 km @ 4:50/km · wu 2km; … · upcoming". */
export function workoutLine(w: PlannedWorkout, status?: WorkoutStatus, run?: Activity): string {
  const parts = [`${w.date} ${WEEKDAYS[weekday(w.date)]}`, w.kind];
  if (w.title) parts.push(clip(w.title, 60));
  const target = [w.distance ? km(w.distance) : '', w.duration ? dur(w.duration) : '', w.pace ? `@ ${pace(w.pace)}` : '']
    .filter(Boolean)
    .join(' ');
  if (target) parts.push(target);
  if (w.steps?.length) parts.push(`steps: ${stepsToText(w.steps)}`);
  if (w.description) parts.push(`notes: ${clip(w.description, 200)}`);
  if (status) parts.push(status);
  if (run) parts.push(`run ${run.id} (${km(run.summary.distance)} in ${dur(run.summary.movingTime)}, ${pace(run.summary.avgPace)})`);
  return parts.join(' · ');
}
