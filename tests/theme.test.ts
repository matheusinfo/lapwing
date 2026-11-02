// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A controllable `prefers-color-scheme: dark` media query. */
function stubSystem(dark: boolean) {
  const handlers: (() => void)[] = [];
  const mql = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => handlers.push(fn),
  };
  vi.stubGlobal('matchMedia', () => mql);
  window.matchMedia = (() => mql) as never;
  return {
    set(next: boolean) {
      mql.matches = next;
      handlers.forEach((fn) => fn());
    },
  };
}

async function load() {
  vi.resetModules();
  return import('../src/ui/theme');
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.replaceChildren();
});

describe('theme', () => {
  it('follows the system by default, including live changes', async () => {
    const system = stubSystem(true);
    const theme = await load();
    expect(theme.getThemePref()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');

    const seen: string[] = [];
    theme.onThemeChange((t) => seen.push(t));
    system.set(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(seen).toEqual(['light']);
  });

  it('saves an explicit choice, ignores the system for it, and notifies only real changes', async () => {
    const system = stubSystem(false);
    const theme = await load();
    const seen: string[] = [];
    const prefs: string[] = [];
    theme.onThemeChange((t) => seen.push(t));
    theme.onThemePrefChange((p) => prefs.push(p));

    theme.setThemePref('dark');
    expect(localStorage.getItem('lapwing:theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    system.set(true); // already dark, and not following the system
    theme.setThemePref('system'); // system is dark too: same resolved theme
    expect(seen).toEqual(['dark']);
    expect(prefs).toEqual(['dark', 'system']);

    theme.setThemePref('light');
    expect(seen).toEqual(['dark', 'light']);
  });

  it('restores the saved choice on load', async () => {
    stubSystem(true);
    localStorage.setItem('lapwing:theme', 'light');
    const theme = await load();
    expect(theme.getThemePref()).toBe('light');
    expect(theme.getTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('the Appearance card shows the choice and changes the theme', async () => {
    stubSystem(false);
    const theme = await load();
    const { mountAppearanceSection } = await import('../src/screens/settings/appearance-section');
    const el = document.createElement('div');
    document.body.append(el);
    const cleanup = mountAppearanceSection(el);

    const radio = (v: string) => el.querySelector<HTMLInputElement>(`input[value="${v}"]`)!;
    expect(el.querySelectorAll('input[name="ap-theme"]')).toHaveLength(3);
    expect(radio('system').checked).toBe(true);

    radio('dark').checked = true;
    radio('dark').dispatchEvent(new Event('change', { bubbles: true }));
    expect(theme.getThemePref()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(radio('dark').checked).toBe(true);

    // A change made elsewhere (the nav button) updates the card.
    theme.setThemePref('light');
    expect(radio('light').checked).toBe(true);
    cleanup();
  });
});
