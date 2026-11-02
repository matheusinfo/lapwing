import type { ScreenMount } from '../../app/screen';
import { onLangChange, t, translateDom } from '../../i18n';
import { mountAppearanceSection } from './appearance-section';
import { mountBackupSection } from './backup-section';
import { mountStravaSection } from './strava-section';

/**
 * Settings screen (`/settings`). Each section owns its own element and
 * returns its cleanup.
 */
export const mount: ScreenMount = (root) => {
  root.innerHTML = `
    <div class="page set-page">
      <header class="page-header"><h1 data-i18n="navSettings"></h1></header>
      <div class="set-appearance"></div>
      <div class="set-strava"></div>
      <div class="set-backup"></div>
    </div>`;
  translateDom(root.querySelector('.page-header')!, t);
  const cleanups = [
    onLangChange(() => translateDom(root.querySelector('.page-header')!, t)),
    mountAppearanceSection(root.querySelector<HTMLElement>('.set-appearance')!),
    mountStravaSection(root.querySelector<HTMLElement>('.set-strava')!),
    mountBackupSection(root.querySelector<HTMLElement>('.set-backup')!),
  ];
  return () => cleanups.forEach((fn) => fn());
};
