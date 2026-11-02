/**
 * Calendar dates as "YYYY-MM-DD" strings in the user's local time zone.
 * Arithmetic is done on UTC midnights so daylight-saving changes never shift
 * a day. Weeks start on Monday.
 */

const MS_DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local calendar date of a timestamp (optionally in a given IANA time zone). */
export function localDateOf(ms: number, timeZone?: string): string {
  const key = timeZone ?? '';
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(key, f);
  }
  const parts = f.formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const todayDate = (timeZone?: string) => localDateOf(Date.now(), timeZone);

const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * MS_DAY);

/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / MS_DAY);

/** 0 = Monday … 6 = Sunday. */
export const weekday = (d: string) => (new Date(toUtc(d)).getUTCDay() + 6) % 7;

/** Monday of the week containing `d`. */
export const weekStart = (d: string) => addDays(d, -weekday(d));

/** A timestamp at local noon of that date, for formatting with Intl. */
export function dateToMs(d: string): number {
  return new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).getTime();
}

/** Parses "YYYY-MM-DD" or "DD/MM/YYYY"; returns undefined if invalid. */
export function parseDateInput(s: string): string | undefined {
  const v = s.trim();
  if (isDateStr(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (!m) return undefined;
  const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDateStr(d) ? d : undefined;
}
