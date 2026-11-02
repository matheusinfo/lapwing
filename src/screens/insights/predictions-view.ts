/** Race predictions section of the Insights screen. */
import type { Activity } from '../../data/types';
import { formatDuration, formatNumber, formatPace } from '../../format';
import type { Efforts } from '../history/aggregate';
import { t, type InsightsKey } from './i18n';
import {
  bestVdot,
  collectEfforts,
  predictRaces,
  predictionRuns,
  vdotRaceTime,
  type Effort,
  type PredictionCaveat,
  type RaceDistance,
} from './predictions';
import { esc, runLinkWithDate, shortDistance } from './view';

const RACE_LABEL: Record<RaceDistance, InsightsKey> = {
  5000: 'race5k',
  10000: 'race10k',
  21097.5: 'raceHalf',
  42195: 'raceMarathon',
};
const CAVEAT_TEXT: Record<PredictionCaveat, InsightsKey> = {
  noLongRun: 'caveatNoLongRun',
  shortOnly: 'caveatShortOnly',
  farExtrapolation: 'caveatFar',
};

function sourceHtml(e: Effort): string {
  const label = e.wholeRun
    ? t('sourceWhole', { distance: shortDistance(e.distance) })
    : t('sourceSegment', { distance: shortDistance(e.distance) });
  return `<span class="ins-source"><span>${label} ${runLinkWithDate(e.activity)}</span>
    <span class="muted">${formatDuration(e.time)} · ${formatPace(e.time / (e.distance / 1000))}</span></span>`;
}

export interface PredictionsInput {
  /** All activities (any type). */
  activities: Activity[];
  efforts: Map<string, Efforts>;
  /** Start of the window (ms), or -Infinity for all time. */
  since: number;
  allTime: boolean;
  /** Best efforts are still being computed. */
  calculating: boolean;
}

/** The runs whose tracks the predictions need (for `loadEfforts`). */
export const runsForPredictions = (activities: Activity[], since: number) => predictionRuns(activities, since);

export function renderPredictions(el: Element, input: PredictionsInput): void {
  const runs = predictionRuns(input.activities, input.since);
  const efforts = collectEfforts(runs, input.efforts);
  const predictions = predictRaces(efforts, runs);

  if (!predictions.length) {
    const anyTimed = predictionRuns(input.activities).length > 0;
    el.innerHTML = anyTimed && !input.allTime
      ? `<p class="muted">${t('predEmpty')}</p>
         <button type="button" class="btn small" data-pred-window="all">${t('predTryAll')}</button>`
      : `<p class="muted">${t('predEmptyAll')}</p>`;
    return;
  }

  const vdot = bestVdot(efforts);
  const caveats = new Set<PredictionCaveat>();
  const rows = predictions
    .map((p) => {
      p.caveats.forEach((c) => caveats.add(c));
      const marks = p.caveats.length
        ? ` <span class="badge warn ins-caveat-mark" title="${esc(p.caveats.map((c) => t(CAVEAT_TEXT[c])).join(' '))}">!</span>`
        : '';
      const vdotTime = vdot ? formatDuration(vdotRaceTime(vdot.value, p.distance)) : '—';
      return `<tr>
        <th scope="row">${t(RACE_LABEL[p.distance])}${marks}</th>
        <td class="num ins-pred-time" data-label="${t('colPredicted')}">${formatDuration(p.time)}</td>
        <td class="num" data-label="${t('colPace')}">${formatPace(p.pace)}</td>
        <td class="num" data-label="${t('colVdot')}">${vdotTime}</td>
        <td class="ins-col-source" data-label="${t('colSource')}">${sourceHtml(p.source)}</td>
      </tr>`;
    })
    .join('');

  const paceRow = (label: InsightsKey, value: string) =>
    `<div class="stat"><dt>${t(label)}</dt><dd>${value}</dd></div>`;
  const vdotHtml = vdot
    ? `<div class="ins-vdot">
        <h3>${t('vdotTitle', { value: formatNumber(vdot.value, 1) })}</h3>
        <p class="muted ins-small">${t('vdotFrom', {
          distance: shortDistance(vdot.source.distance),
          time: formatDuration(vdot.source.time),
          run: runLinkWithDate(vdot.source.activity),
        })} · ${t('vdotHint')}</p>
        <dl class="stat-grid ins-paces">
          ${paceRow('paceEasy', `${formatDuration(vdot.paces.easy[0])}–${formatPace(vdot.paces.easy[1])}`)}
          ${paceRow('paceMarathon', formatPace(vdot.paces.marathon))}
          ${paceRow('paceThreshold', formatPace(vdot.paces.threshold))}
          ${paceRow('paceInterval', formatPace(vdot.paces.interval))}
          ${paceRow('paceRepetition', formatPace(vdot.paces.repetition))}
        </dl>
      </div>`
    : '';

  el.innerHTML = `
    ${input.calculating ? `<p class="ins-calculating" role="status"><span class="ins-spinner" aria-hidden="true"></span>${t('predCalculating')}</p>` : ''}
    <div class="table-wrap">
      <table class="table ins-pred-table">
        <thead><tr>
          <th>${t('colRace')}</th><th class="num">${t('colPredicted')}</th><th class="num">${t('colPace')}</th>
          <th class="num">${t('colVdot')}</th><th>${t('colSource')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${caveats.size ? `<ul class="ins-caveats">${[...caveats].map((c) => `<li>${t(CAVEAT_TEXT[c])}</li>`).join('')}</ul>` : ''}
    ${vdotHtml}
    <p class="muted ins-small">${t('predNote')}</p>`;
}
