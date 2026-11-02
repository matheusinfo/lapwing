import './appearance.css';
import { onLangChange, t } from '../../i18n';
import { getThemePref, onThemePrefChange, setThemePref, THEME_PREFS, type ThemePref } from '../../ui/theme';

const LABELS = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' } as const;

/** "Appearance" card: choose System, Light or Dark theme. Fills `el` and returns its cleanup. */
export function mountAppearanceSection(el: HTMLElement): () => void {
  function render(): void {
    const current = getThemePref();
    el.innerHTML = `
      <section class="card ap-card">
        <h2 class="card-title" id="ap-title">${t('appearanceTitle')}</h2>
        <div class="ap-options" role="radiogroup" aria-labelledby="ap-title">
          ${THEME_PREFS.map(
            (p: ThemePref) => `
            <label class="ap-option">
              <input type="radio" name="ap-theme" value="${p}" ${p === current ? 'checked' : ''} />
              <span class="ap-preview ap-preview-${p}" aria-hidden="true"><span></span><span></span></span>
              <span class="ap-name">${t(LABELS[p])}</span>
            </label>`,
          ).join('')}
        </div>
        <p class="muted ap-hint">${t('appearanceHint')}</p>
      </section>`;
  }

  const onChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.name === 'ap-theme') setThemePref(input.value as ThemePref);
  };
  el.addEventListener('change', onChange);
  render();
  const offPref = onThemePrefChange(render);
  const offLang = onLangChange(render);
  return () => {
    el.removeEventListener('change', onChange);
    offPref();
    offLang();
  };
}
