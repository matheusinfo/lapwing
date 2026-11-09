import type { ScreenMount } from '../../app/screen';
import { currentQuery } from '../../app/router';
import { onLangChange, t, translateDom } from '../../i18n';
import { mountAppearanceSection } from './appearance-section';
import { mountBackupSection } from './backup-section';
import { mountStravaSection } from './strava-section';
import { mountSyncSection } from './sync-section';
import { mountZonesSection } from './zones-section';

/**
 * Settings screen (`/settings`). Each section owns its own element and
 * returns its cleanup.
 */
export const mount: ScreenMount = (root) => {
  root.innerHTML = `
    <div class="page set-page">
      <header class="page-header"><h1 data-i18n="navSettings"></h1></header>
      <div class="set-appearance"></div>
      <div class="set-zones"></div>
      <div class="set-sync" hidden></div>
      <div class="set-strava"></div>
      <div class="set-backup"></div>
    </div>`;
  translateDom(root.querySelector('.page-header')!, t);
  const cleanups = [
    onLangChange(() => translateDom(root.querySelector('.page-header')!, t)),
    mountAppearanceSection(root.querySelector<HTMLElement>('.set-appearance')!),
    mountZonesSection(root.querySelector<HTMLElement>('.set-zones')!),
    mountSyncSection(root.querySelector<HTMLElement>('.set-sync')!),
    mountStravaSection(root.querySelector<HTMLElement>('.set-strava')!),
    mountBackupSection(root.querySelector<HTMLElement>('.set-backup')!),
  ];
  // "#/settings?section=zones" (link from a run's report) opens on that card.
  const section = currentQuery().get('section');
  let scrollTimer: number | undefined;
  if (section) {
    const target = root.querySelector<HTMLElement>(`.set-${CSS.escape(section)}`);
    // The card fills in after its settings load.
    scrollTimer = window.setTimeout(() => target?.scrollIntoView({ block: 'start' }), 150);
  }
  return () => {
    window.clearTimeout(scrollTimer);
    cleanups.forEach((fn) => fn());
  };
};
