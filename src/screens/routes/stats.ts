import { elevationGainLoss, trackDistance } from '../../geo';
import { formatDistance, formatDuration, parsePace } from '../../format';
import { t } from '../../i18n';
import type { Coord } from '../../types';

const PACE_KEY = 'lapwing:pace';
const DEFAULT_PACE = '6:00';

const $ = (id: string) => document.getElementById(id)!;

export function setupPaceInput(onChange: () => void): void {
  const input = $('pace') as HTMLInputElement;
  try {
    input.value = localStorage.getItem(PACE_KEY) ?? DEFAULT_PACE;
  } catch {
    input.value = DEFAULT_PACE;
  }
  input.addEventListener('input', () => {
    input.classList.toggle('invalid', parsePace(input.value) === null);
    try {
      localStorage.setItem(PACE_KEY, input.value);
    } catch {
      // Not important if this fails.
    }
    onChange();
  });
}

export function renderStats(track: Coord[], busy: boolean, waypointCount: number): void {
  const distance = trackDistance(track);
  $('stat-distance').textContent = formatDistance(distance);

  const ele = elevationGainLoss(track);
  $('stat-elevation').textContent = ele.hasElevation
    ? `↑ ${Math.round(ele.gain)} m  ↓ ${Math.round(ele.loss)} m`
    : '—';

  const pace = parsePace(($('pace') as HTMLInputElement).value);
  $('stat-time').textContent = pace && distance > 0 ? formatDuration((distance / 1000) * pace) : '—';

  $('status').textContent = busy ? t('routing') : '';
  $('hint').textContent = waypointCount === 0 ? t('hintEmpty') : t('hintEditing');
}
