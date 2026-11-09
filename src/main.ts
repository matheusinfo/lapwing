import './style.css';
// Must run before any module reads a stored setting (e.g. the language).
import './app/legacy-storage';
import { currentPath, DEFAULT_PATH, matchRoute, navigate, NAV_ITEMS, type RouteDef } from './app/router';
import { getLang, onLangChange, setLang, t, translateDom, type Lang } from './i18n';
import { dismissConfirms } from './ui/confirm';
import { getThemePref, onThemeChange, onThemePrefChange, setThemePref, THEME_PREFS, type ThemePref } from './ui/theme';

const nav = document.getElementById('app-nav')!;
const main = document.getElementById('app-main')!;

function renderNav(): void {
  nav.querySelector('.nav-items')!.innerHTML = NAV_ITEMS.map(
    (item) => `
      <a class="nav-item" href="#${item.path}" data-nav="${item.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>
        <span data-i18n="${item.label}"></span>
      </a>`,
  ).join('');
  translateDom(nav, t);
}

const langSelect = document.getElementById('lang') as HTMLSelectElement;
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value as Lang));
document.documentElement.lang = getLang();
onLangChange(() => translateDom(nav, t));

// ---- Theme button: cycles System → Light → Dark ----

const THEME_ICONS: Record<ThemePref, string> = {
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};
const THEME_LABELS = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' } as const;
const themeButton = document.getElementById('theme-toggle') as HTMLButtonElement;

function renderThemeButton(): void {
  const pref = getThemePref();
  const label = t('themeToggle', { name: t(THEME_LABELS[pref]) });
  themeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${THEME_ICONS[pref]}</svg>`;
  themeButton.title = label;
  themeButton.setAttribute('aria-label', label);
}
themeButton.addEventListener('click', () => {
  const next = THEME_PREFS[(THEME_PREFS.indexOf(getThemePref()) + 1) % THEME_PREFS.length];
  setThemePref(next);
});
renderThemeButton();
onThemePrefChange(renderThemeButton);
onLangChange(renderThemeButton);

let unmount: (() => void) | void = undefined;
let currentRoute: RouteDef | null = null;
let currentParamsKey = '';
let loadId = 0;

async function show(): Promise<void> {
  const match = matchRoute(currentPath());
  if (!match) {
    navigate(DEFAULT_PATH);
    return;
  }
  const paramsKey = JSON.stringify(match.params);
  // Changing only the query string (e.g. a filter) doesn't remount the screen.
  if (match.route === currentRoute && paramsKey === currentParamsKey) return;
  currentRoute = match.route;
  currentParamsKey = paramsKey;

  nav.querySelectorAll<HTMLElement>('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.nav === match.route.nav),
  );

  const id = ++loadId;
  dismissConfirms(); // A confirmation belongs to the screen being left.
  if (typeof unmount === 'function') unmount();
  unmount = undefined;
  main.replaceChildren();
  const root = document.createElement('div');
  root.className = 'screen';
  root.innerHTML = `<p class="screen-message">${t('loadingScreen')}</p>`;
  main.append(root);

  try {
    const mod = await match.route.load();
    if (id !== loadId) return; // The user navigated away meanwhile.
    root.replaceChildren();
    unmount = mod.mount(root, match.params);
  } catch (err) {
    console.error(err);
    if (id === loadId) root.innerHTML = `<p class="screen-message">${t('screenError')}</p>`;
  }
}

renderNav();
window.addEventListener('hashchange', () => void show());
// Charts and maps take their colours when created: rebuild the screen.
onThemeChange(() => {
  currentRoute = null;
  void show();
});
// Returning from Strava's sign-in (?state=…&code=…): finish it before the first render.
const stravaReturn = new URLSearchParams(location.search).has('state')
  ? import('./data/strava').then((m) => m.captureStravaRedirect(), () => false)
  : Promise.resolve(false);
void stravaReturn.then(() => show());

// Sync with this site's Lapwing server, if it has one (otherwise data stays only in this browser).
void import('./data/sync').then((m) => m.startSync()).catch((err) => console.warn('Sync unavailable:', err));
