import { getLang } from './i18n';

export function formatDistance(metres: number): string {
  const km = new Intl.NumberFormat(getLang(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(metres / 1000);
  return `${km} km`;
}

/** Seconds → "h:mm:ss", or "m:ss" under an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Pace text → seconds per km. Accepts "5:30" or a plain number of minutes ("6", "5.5"). */
export function parsePace(text: string): number | null {
  const v = text.trim().replace(',', '.');
  const mmss = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  if (mmss) {
    const secs = Number(mmss[1]) * 60 + Number(mmss[2]);
    return secs > 0 ? secs : null;
  }
  const minutes = Number(v);
  return v !== '' && Number.isFinite(minutes) && minutes > 0 && minutes < 60
    ? Math.round(minutes * 60)
    : null;
}

/** Seconds per km → "5:30 /km" ("—" when unknown). */
export function formatPace(secondsPerKm: number | undefined): string {
  if (secondsPerKm === undefined || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  return `${formatDuration(secondsPerKm)} /km`;
}

/** A number in the current language, e.g. 1234.5 → "1,234.5" / "1.234,5". */
export function formatNumber(value: number, maxFractionDigits = 0, minFractionDigits = 0): string {
  return new Intl.NumberFormat(getLang(), {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

/** A date in the current language. `style` follows Intl.DateTimeFormat dateStyle. */
export function formatDate(ms: number, style: 'full' | 'long' | 'medium' | 'short' = 'medium'): string {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: style }).format(ms);
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}
