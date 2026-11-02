import { en, type MessageKey } from './en';
import { ptBR } from './pt-BR';

export type Lang = 'en' | 'pt-BR';
export type { MessageKey };
export type Params = Record<string, string | number>;
export type Translator<K extends string> = (key: K, params?: Params) => string;

const LANG_KEY = 'lapwing:lang';
const listeners = new Set<() => void>();

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'pt-BR') return saved;
  } catch {
    // Storage unavailable: fall back to the browser language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt')
    ? 'pt-BR'
    : 'en';
}

let lang: Lang = detectLang();

export function getLang(): Lang {
  return lang;
}

const fill = (text: string, params: Params) =>
  text.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m));

/**
 * Creates a translator for one screen's own messages, so each screen keeps
 * its dictionaries next to its code:
 *
 *   const t = defineMessages({ en: { title: 'Runs' }, 'pt-BR': { title: 'Corridas' } });
 *   t('title');
 */
export function defineMessages<K extends string>(
  dicts: { en: Record<K, string> } & Record<Lang, Record<K, string>>,
): Translator<K> {
  return (key, params = {}) => fill(dicts[lang][key] ?? dicts.en[key] ?? key, params);
}

/** Translator for the shell and the route editor (messages in en.ts / pt-BR.ts). */
export const t: Translator<MessageKey> = defineMessages({ en, 'pt-BR': ptBR });

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // Not important if this fails.
  }
  document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

/** Runs `fn` after every language change. Returns a function that stops it. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fills static text inside `root` from data attributes, using translator `tr`:
 * `data-i18n` (text), `data-i18n-title` (title + aria-label),
 * `data-i18n-placeholder` (placeholder).
 */
export function translateDom<K extends string>(root: ParentNode, tr: Translator<K>): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = tr(el.dataset.i18n as K);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const text = tr(el.dataset.i18nTitle as K);
    el.title = text;
    el.setAttribute('aria-label', text);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = tr(el.dataset.i18nPlaceholder as K);
  });
}
