import { navigate } from '../../app/router';
import { deleteActivity, getActivity, getSettings, getTrack, saveActivity } from '../../data/db';
import { hrZoneRanges, hrZoneSeconds, trimp } from '../../data/metrics';
import { paceStarts, paceZoneSeconds } from '../../data/zones';
import type { Activity, AthleteSettings, TrackPoint } from '../../data/types';
import { formatDateTime, formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import { onLangChange, t as tg } from '../../i18n';
import { chartColors, type Chart } from '../../ui/chart-theme';
import { showToast } from '../../ui/toast';
import {
  aerobicDecoupling,
  bestEfforts,
  buildStreams,
  chartStep,
  detectFastBlocks,
  kmSplits,
  sampleByDistance,
  type Block,
  type Sample,
  type Split,
  type Streams,
} from './calc';
import { createStreamCharts, createZonesChart, type StreamDef } from './charts';
import { esc } from './dom';
import { downloadActivityGpx } from './export-gpx';
import { tr, type ActKey } from './i18n';
import { createReportMap, type ColorMode, type LegendInfo } from './report-map';
import { confirmDialog } from '../../ui/confirm';

const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  compare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v18"/><path d="M16 3v18"/><path d="m4 7 4-4 4 4"/><path d="m12 17 4 4 4-4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>',
};

const TYPE_KEYS: Record<Activity['type'], ActKey> = {
  run: 'typeRun',
  'trail-run': 'typeTrail',
  walk: 'typeWalk',
  other: 'typeOther',
};

const RPE_OPTIONS: [number, ActKey | null][] = [
  [1, 'rpe1'], [2, null], [3, 'rpe3'], [4, null], [5, 'rpe5'],
  [6, null], [7, 'rpe7'], [8, null], [9, 'rpe9'], [10, 'rpe10'],
];

interface Report {
  activity: Activity;
  points: TrackPoint[];
  settings: AthleteSettings;
  streams: Streams;
  samples: Sample[];
  splits: Split[];
  blocks: Block[];
  efforts: ReturnType<typeof bestEfforts>;
  decoupling?: number;
  load?: number;
  zones?: number[];
  /** Seconds per pace zone, when pace zones are set and the run has time. */
  paceZones?: number[];
}

const bpm = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v)} bpm`);
const spm = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v)} spm`);
const meters = (v: number | undefined) => (v === undefined ? '—' : `${formatNumber(Math.round(v))} m`);
const signedMeters = (v: number | undefined) =>
  v === undefined ? '—' : `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${formatNumber(Math.abs(Math.round(v)))} m`;

function tile(label: string, value: string, opts: { sub?: string; main?: boolean } = {}): string {
  return `<div class="stat${opts.main ? ' main' : ''}"><dt>${label}</dt><dd>${value}${
    opts.sub ? ` <small>${opts.sub}</small>` : ''
  }</dd></div>`;
}

function computeReport(activity: Activity, points: TrackPoint[], settings: AthleteSettings): Report {
  const streams = buildStreams(points);
  const has = activity.summary.has;
  return {
    activity,
    points,
    settings,
    streams,
    samples: sampleByDistance(streams, chartStep(streams.total), 200),
    splits: kmSplits(streams),
    blocks: detectFastBlocks(streams),
    efforts: bestEfforts(streams),
    decoupling: has.hr ? aerobicDecoupling(streams) : undefined,
    load: has.hr ? trimp(points, settings) : undefined,
    zones: has.hr ? hrZoneSeconds(points, settings) : undefined,
    paceZones: (() => {
      const starts = paceStarts(settings);
      return starts && streams.hasTime ? paceZoneSeconds(streams.dist, streams.moving, starts) : undefined;
    })(),
  };
}

/** The "/activity/:id" page: everything we can tell about one run. */
export function mountReportPage(root: HTMLElement, id: string): () => void {
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let report: Report | null = null;
  let notFound = false;
  let colorMode: ColorMode = 'pace';
  /** Charts and map of the current render, destroyed before each re-render. */
  let teardown: (() => void)[] = [];

  root.innerHTML = '<div class="page act-page"></div>';
  const page = root.querySelector<HTMLElement>('.page')!;

  const clearRender = () => {
    teardown.forEach((fn) => fn());
    teardown = [];
  };

  function renderNotFound() {
    page.innerHTML = `
      <a class="act-back" href="#/activity">${ICONS.back}${tr('back')}</a>
      <div class="card empty-state"><h2>${tr('notFoundTitle')}</h2><p>${tr('notFoundText')}</p></div>`;
  }

  function statsHtml(r: Report): string {
    const s = r.activity.summary;
    const tiles = [tile(tr('distance'), formatDistance(s.distance), { main: true })];
    if (s.has.time) {
      tiles.push(tile(tr('movingTime'), formatDuration(s.movingTime)));
      const stopped = s.elapsedTime - s.movingTime;
      tiles.push(
        tile(tr('elapsedTime'), formatDuration(s.elapsedTime), {
          sub: stopped >= 5 ? tr('stopped', { time: formatDuration(stopped) }) : undefined,
        }),
      );
      tiles.push(tile(tr('avgPace'), formatPace(s.avgPace), { main: true }));
      if (s.bestPace) tiles.push(tile(tr('bestKm'), formatPace(s.bestPace)));
    }
    if (s.has.ele) {
      tiles.push(tile(tr('elevGain'), meters(s.elevationGain)));
      tiles.push(tile(tr('elevLoss'), meters(s.elevationLoss)));
      tiles.push(tile(tr('minMaxEle'), `${meters(s.minEle)} / ${meters(s.maxEle)}`));
    }
    if (s.has.hr) {
      tiles.push(tile(tr('avgHr'), bpm(s.avgHr)));
      tiles.push(tile(tr('maxHr'), bpm(s.maxHr)));
    }
    if (s.has.cad) {
      tiles.push(tile(tr('avgCad'), spm(s.avgCadence)));
      tiles.push(tile(tr('maxCad'), spm(s.maxCadence)));
    }
    if (s.has.temp && s.avgTemp !== undefined) tiles.push(tile(tr('temperature'), `${formatNumber(s.avgTemp, 1)} °C`));
    if (s.has.power) {
      tiles.push(tile(tr('avgPower'), `${Math.round(s.avgPower ?? 0)} W`));
      tiles.push(tile(tr('maxPower'), `${Math.round(s.maxPower ?? 0)} W`));
    }
    return `<dl class="stat-grid act-stats">${tiles.join('')}</dl>`;
  }

  function effortsHtml(r: Report): string {
    if (!r.efforts.length) return `<p class="muted">${tr('noEfforts')}</p>`;
    return `<table class="table act-efforts"><tbody>${r.efforts
      .map(
        (e) => `<tr><th scope="row">${tr(e.key)}</th>
          <td class="num">${formatDuration(e.time)}</td>
          <td class="num muted">${formatPace(e.time / (e.meters / 1000))}</td></tr>`,
      )
      .join('')}</tbody></table>`;
  }

  function loadHtml(r: Report): string {
    let trimpBlock = `<p class="muted">${tr('notAvailable')}</p>`;
    if (r.load !== undefined) {
      const [key, cls]: [ActKey, string] =
        r.load < 50 ? ['trimpEasy', 'good'] : r.load < 100 ? ['trimpModerate', ''] : r.load < 200 ? ['trimpHard', 'warn'] : ['trimpVeryHard', 'bad'];
      trimpBlock = `<p class="act-metric"><strong>${Math.round(r.load)}</strong> <span class="badge ${cls}">${tr(key)}</span></p>`;
    }
    let decBlock = `<p class="muted">${tr('notAvailable')}</p>`;
    if (r.decoupling !== undefined) {
      const d = r.decoupling;
      const [key, cls]: [ActKey, string] = d < 5 ? ['decouplingGood', 'good'] : d < 10 ? ['decouplingOk', 'warn'] : ['decouplingHigh', 'bad'];
      decBlock = `<p class="act-metric"><strong>${formatNumber(d, 1, 1)}%</strong> <span class="badge ${cls}">${tr(key)}</span></p>`;
    }
    return `
      <div class="act-load-item">
        <h3>${tr('trimpLabel')}</h3>${trimpBlock}<p class="act-hint">${tr('trimpHint')}</p>
      </div>
      <div class="act-load-item">
        <h3>${tr('decouplingLabel')}</h3>${decBlock}<p class="act-hint">${tr('decouplingHint')}</p>
      </div>`;
  }

  function splitsHtml(r: Report): string {
    const full = r.splits.filter((s) => !s.partial && s.pace !== undefined);
    const fastest = full.length > 1 ? full.reduce((a, b) => (b.pace! < a.pace! ? b : a)) : undefined;
    const slowest = full.length > 1 ? full.reduce((a, b) => (b.pace! > a.pace! ? b : a)) : undefined;
    const has = r.activity.summary.has;
    const head = [
      `<th>${tr('colKm')}</th>`,
      has.time ? `<th class="num">${tr('colPace')}</th><th class="num act-hide-phone">${tr('colTime')}</th>` : '',
      has.hr ? `<th class="num">${tr('colHr')}</th>` : '',
      has.ele ? `<th class="num">${tr('colElev')}</th>` : '',
      has.cad ? `<th class="num act-hide-phone">${tr('colCad')}</th>` : '',
    ].join('');
    const rows = r.splits
      .map((s) => {
        const badge =
          s === fastest ? ` <span class="badge good">${tr('fastest')}</span>` : s === slowest ? ` <span class="badge warn">${tr('slowest')}</span>` : '';
        const label = s.partial ? `${s.km - 1}–${formatNumber((s.km - 1) + s.distance / 1000, 2)}` : String(s.km);
        return `<tr${s.partial ? ' class="act-partial"' : ''}>
          <td>${label}${badge}</td>
          ${has.time ? `<td class="num">${formatPace(s.pace)}</td><td class="num act-hide-phone">${s.time !== undefined ? formatDuration(s.time) : '—'}</td>` : ''}
          ${has.hr ? `<td class="num">${s.avgHr !== undefined ? Math.round(s.avgHr) : '—'}</td>` : ''}
          ${has.ele ? `<td class="num">${signedMeters(s.eleChange)}</td>` : ''}
          ${has.cad ? `<td class="num act-hide-phone">${s.avgCad !== undefined ? Math.round(s.avgCad) : '—'}</td>` : ''}
        </tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table class="table act-splits"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const zoneName = (i: number) => `${tr('zoneLabel', { n: i + 1 })} ${tr(`zoneNames${i + 1}` as ActKey)}`;

  function hrRangeText(settings: AthleteSettings, i: number): string {
    const [lo, hi] = hrZoneRanges(settings)[i];
    if (i === 0) return `≤ ${hi} bpm`;
    if (i === 4) return `≥ ${lo} bpm`;
    return `${lo}–${hi} bpm`;
  }

  function paceRangeText(settings: AthleteSettings, i: number): string {
    const b = paceStarts(settings)!;
    const p = (v: number) => formatDuration(v);
    if (i === 0) return `> ${p(b[0])} /km`;
    if (i === 4) return `< ${p(b[3])} /km`;
    return `${p(b[i - 1])}–${p(b[i])} /km`;
  }

  function zoneList(seconds: number[], range: (i: number) => string, kind: 'hr' | 'pace'): string {
    const total = seconds.reduce((a, b) => a + b, 0) || 1;
    const items = seconds
      .map(
        (sec, i) => `<li><span class="act-swatch" style="background:${chartColors.zones[i]}"></span>
          <span>${zoneName(i)} <span class="muted">${range(i)}</span></span>
          <span class="act-zone-val">${formatDuration(sec)} · ${Math.round((sec / total) * 100)}%</span></li>`,
      )
      .join('');
    return `<div class="act-zones-chart" data-zones="${kind}"><canvas></canvas></div><ul class="act-zone-list">${items}</ul>`;
  }

  function zonesHtml(r: Report): string {
    const hr = r.zones
      ? zoneList(r.zones, (i) => hrRangeText(r.settings, i), 'hr')
      : `<p class="muted">${tr('noHr')}</p>`;
    const pace = r.paceZones
      ? zoneList(r.paceZones, (i) => paceRangeText(r.settings, i), 'pace')
      : `<p class="muted">${r.activity.summary.has.time ? tr('noPaceZones') : tr('noPaceTime')}</p>`;
    return `
      <h3 class="act-zones-sub">${tr('hrZonesSub')}</h3>${hr}
      <h3 class="act-zones-sub">${tr('paceZonesSub')}</h3>${pace}
      <p class="act-hint"><a href="#/settings?section=zones">${tr('editZones')}</a></p>`;
  }

  function blocksHtml(r: Report): string {
    const rows = r.blocks
      .map(
        (b, i) => `<tr><td>${i + 1}</td>
          <td class="num act-hide-phone">${formatNumber(b.start / 1000, 2)} km</td>
          <td class="num">${formatNumber(Math.round(b.distance))} m</td>
          <td class="num">${formatDuration(b.time)}</td>
          <td class="num">${formatPace(b.pace)}</td>
          ${r.activity.summary.has.hr ? `<td class="num">${b.avgHr !== undefined ? Math.round(b.avgHr) : '—'}</td>` : ''}</tr>`,
      )
      .join('');
    return `
      <p class="act-hint">${tr('intervalsHint')}</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${tr('colRep')}</th><th class="num act-hide-phone">Km</th><th class="num">${tr('colDistance')}</th>
          <th class="num">${tr('colTime')}</th><th class="num">${tr('colPace')}</th>
          ${r.activity.summary.has.hr ? `<th class="num">${tr('colHr')}</th>` : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function notesHtml(a: Activity): string {
    const options = [`<option value="">${tr('rpeNone')}</option>`]
      .concat(RPE_OPTIONS.map(([v, key]) => `<option value="${v}"${a.rpe === v ? ' selected' : ''}>${key ? tr(key) : v}</option>`))
      .join('');
    return `
      <div class="act-notes-row">
        <label class="field act-rpe"><span>${tr('rpe')}</span><select name="rpe">${options}</select></label>
      </div>
      <label class="field"><span>${tr('notes')}</span>
        <textarea name="notes" rows="3" placeholder="${esc(tr('notesPlaceholder'))}">${esc(a.notes ?? '')}</textarea></label>`;
  }

  function legendHtml(info: LegendInfo | null, mode: ColorMode): string {
    if (!info) return '';
    const fmt = (v: number) => (mode === 'pace' ? formatPace(v) : bpm(v));
    const [lowWord, highWord] = mode === 'pace' ? [tr('slower'), tr('faster')] : [tr('lower'), tr('higher')];
    return `<span class="act-legend-end">${lowWord}<br /><b>${fmt(info.from)}</b></span>
      <span class="act-legend-ramp">${info.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="act-legend-end">${highWord}<br /><b>${fmt(info.to)}</b></span>`;
  }

  function streamDefs(r: Report): StreamDef[] {
    const has = r.activity.summary.has;
    const defs: StreamDef[] = [];
    if (has.time)
      defs.push({ key: 'pace', title: tr('pace'), color: chartColors.pace, reverse: true, clipOutliers: true, format: formatPace, tick: (v) => formatDuration(v) });
    if (has.hr) defs.push({ key: 'hr', title: tr('heartRate'), color: chartColors.hr, format: bpm, tick: (v) => `${Math.round(v)}` });
    if (has.ele)
      defs.push({ key: 'ele', title: tr('elevation'), color: chartColors.ele, fill: true, format: meters, tick: (v) => `${Math.round(v)} m` });
    if (has.cad) defs.push({ key: 'cad', title: tr('cadence'), color: chartColors.cad, format: spm, tick: (v) => `${Math.round(v)}` });
    if (has.power)
      defs.push({ key: 'power', title: tr('power'), color: chartColors.power, format: (v) => `${Math.round(v)} W`, tick: (v) => `${Math.round(v)}` });
    return defs;
  }

  async function save(patch: Partial<Activity>) {
    if (!report) return;
    report.activity = { ...report.activity, ...patch };
    await saveActivity(report.activity);
    showToast(tr('saved'));
  }

  function render() {
    clearRender();
    const r = report;
    if (!r) return;
    const a = r.activity;
    const s = a.summary;
    const typeLabel = tr(TYPE_KEYS[a.type]);

    page.innerHTML = `
      <a class="act-back" href="#/activity">${ICONS.back}${tr('back')}</a>
      <header class="act-header">
        <div class="act-title">
          <input class="act-name" type="text" maxlength="120" aria-label="${esc(tr('nameLabel'))}" value="${esc(a.name)}" />
          <p class="muted act-meta">
            <span class="badge">${typeLabel}</span>
            ${a.hasStartTime ? `<span>${formatDateTime(a.startTime)}</span>` : ''}
            <span class="act-file-name">${esc(a.fileName)}</span>
          </p>
        </div>
        <div class="act-actions">
          <a class="btn act-compare" href="#/compare/${encodeURIComponent(a.id)}">${ICONS.compare}<span>${tr('compare')}</span></a>
          <button class="btn act-export" type="button">${ICONS.download}<span>${tr('exportGpx')}</span></button>
          <button class="btn danger act-delete" type="button">${ICONS.trash}<span>${tr('delete')}</span></button>
        </div>
      </header>
      ${s.has.time ? '' : `<p class="card act-notice">${tr('noTime')}</p>`}
      <section class="card">${statsHtml(r)}</section>

      <div class="act-grid">
        <section class="card act-map-card">
          <div class="act-card-head">
            <h2 class="card-title">${tr('mapTitle')}</h2>
            ${
              s.has.time || s.has.hr
                ? `<div class="act-toggle" role="group" aria-label="${esc(tr('colorBy'))}">
                    ${s.has.time ? `<button type="button" data-mode="pace">${tr('byPace')}</button>` : ''}
                    ${s.has.hr ? `<button type="button" data-mode="hr">${tr('byHr')}</button>` : ''}
                  </div>`
                : ''
            }
          </div>
          <div class="act-map"></div>
          <div class="act-legend"></div>
        </section>
        <div class="act-side">
          <section class="card"><h2 class="card-title">${tr('effortsTitle')}</h2>${effortsHtml(r)}</section>
          <section class="card"><h2 class="card-title">${tr('loadTitle')}</h2>${loadHtml(r)}</section>
        </div>
      </div>

      <section class="card act-charts-card">
        <h2 class="card-title">${tr('chartsTitle')}</h2>
        <p class="act-hint">${tr('chartsHint')}</p>
        <div class="act-charts"></div>
      </section>

      ${r.blocks.length ? `<section class="card"><h2 class="card-title">${tr('intervalsTitle')}</h2>${blocksHtml(r)}</section>` : ''}

      <div class="act-grid act-grid-even">
        <section class="card"><h2 class="card-title">${tr('splitsTitle')}</h2>${splitsHtml(r)}</section>
        <section class="card act-zones"><h2 class="card-title">${tr('zonesTitle')}</h2>${zonesHtml(r)}</section>
      </div>

      <section class="card act-notes"><h2 class="card-title">${tr('notesTitle')}</h2>${notesHtml(a)}</section>`;

    const $ = <T extends HTMLElement>(sel: string) => page.querySelector<T>(sel);

    // Map, coloured track and legend.
    const map = createReportMap($('.act-map')!, r.streams, r.samples, s.bounds);
    teardown.push(map.destroy);
    if (!s.has.time && colorMode === 'pace') colorMode = 'hr';
    const applyMode = (mode: ColorMode) => {
      colorMode = mode;
      $('.act-legend')!.innerHTML = legendHtml(map.setMode(mode), mode);
      page.querySelectorAll<HTMLButtonElement>('.act-toggle button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode)),
      );
    };
    applyMode(colorMode);
    page.querySelectorAll<HTMLButtonElement>('.act-toggle button').forEach((b) =>
      b.addEventListener('click', () => applyMode(b.dataset.mode as ColorMode)),
    );

    // Charts along the run, linked to the map marker.
    const defs = streamDefs(r);
    if (defs.length && r.samples.length > 1) {
      const charts = createStreamCharts($('.act-charts')!, r.samples, defs, (i) =>
        map.highlight(i === null ? null : r.samples[i]),
      );
      teardown.push(charts.destroy);
    } else {
      $('.act-charts-card')!.hidden = true;
    }

    // Heart-rate and pace zones.
    for (const [kind, seconds] of [['hr', r.zones], ['pace', r.paceZones]] as const) {
      if (!seconds) continue;
      const zonesChart: Chart<'bar'> = createZonesChart(
        $<HTMLElement>(`.act-zones-chart[data-zones="${kind}"]`)!.querySelector('canvas')!,
        seconds.map((_, i) => tr('zoneLabel', { n: i + 1 })),
        seconds,
        (sec, share) => `${formatDuration(sec)} · ${Math.round(share * 100)}%`,
      );
      teardown.push(() => zonesChart.destroy());
    }

    // Editing.
    const nameInput = $<HTMLInputElement>('.act-name')!;
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim();
      if (name && name !== r.activity.name) void save({ name });
      else nameInput.value = r.activity.name;
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });
    $('.act-rpe select')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      void save({ rpe: v ? Number(v) : undefined });
    });
    $('.act-notes textarea')!.addEventListener('change', (e) => {
      void save({ notes: (e.target as HTMLTextAreaElement).value.trim() || undefined });
    });

    $('.act-export')!.addEventListener('click', () => downloadActivityGpx(r.points, r.activity.name));
    $('.act-delete')!.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: tg('dlgDeleteRun'),
        message: tr('confirmDelete', { name: r.activity.name }),
        confirmLabel: tg('dlgDelete'),
        tone: 'danger',
      });
      if (!ok) return;
      void deleteActivity(r.activity.id).then(() => {
        showToast(tr('deleted'));
        navigate('/activity');
      });
    });
  }

  async function load() {
    const [activity, points, settings] = await Promise.all([getActivity(id), getTrack(id), getSettings()]);
    if (disposed) return;
    if (!activity || points.length < 2) {
      notFound = true;
      renderNotFound();
      return;
    }
    report = computeReport(activity, points, settings);
    render();
  }

  cleanups.push(
    onLangChange(() => {
      if (report) render();
      else if (notFound) renderNotFound();
    }),
  );
  void load();

  return () => {
    disposed = true;
    clearRender();
    cleanups.forEach((fn) => fn());
  };
}
