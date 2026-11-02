/**
 * Light/dark theme. The user picks `system` (follow the OS), `light` or
 * `dark`; the resolved theme is written to `<html data-theme="light|dark">`,
 * which selects the colour tokens in src/style.css. index.html applies the
 * saved choice before the first paint (keep its inline script in sync with
 * THEME_KEY and the rules here).
 *
 * Charts and maps read colours when they are created, so main.ts remounts the
 * current screen after a theme change.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_PREFS: ThemePref[] = ['system', 'light', 'dark'];
const THEME_KEY = 'lapwing:theme';

const media =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
const listeners = new Set<(theme: Theme) => void>();

function readPref(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Storage unavailable: follow the system.
  }
  return 'system';
}

let pref: ThemePref = readPref();

export const getThemePref = (): ThemePref => pref;

/** The theme in effect: the user's choice, or the system's for `system`. */
export function getTheme(): Theme {
  if (pref !== 'system') return pref;
  return media?.matches ? 'dark' : 'light';
}

let applied: Theme | null = null;

function apply(): void {
  const theme = getTheme();
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
    // Browser UI colour (address bar on phones) follows the page background.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cssVar('--surface', '#ffffff'));
  }
  if (theme === applied) return;
  const first = applied === null;
  applied = theme;
  if (!first) listeners.forEach((fn) => fn(theme));
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not important if this fails.
  }
  prefListeners.forEach((fn) => fn(next));
  apply();
}

/** Runs `fn` when the resolved theme changes (user choice or OS switch). Returns a function that stops it. */
export function onThemeChange(fn: (theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const prefListeners = new Set<(pref: ThemePref) => void>();

/** Runs `fn` when the user's choice changes (even if the resolved theme stays the same). */
export function onThemePrefChange(fn: (pref: ThemePref) => void): () => void {
  prefListeners.add(fn);
  return () => prefListeners.delete(fn);
}

/** Current value of a CSS custom property on <html>, e.g. `cssVar('--surface', '#fff')`. */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

media?.addEventListener('change', () => {
  if (pref === 'system') apply();
});
apply();
