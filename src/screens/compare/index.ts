import './compare.css';
import { navigate } from '../../app/router';
import type { ScreenMount } from '../../app/screen';
import { getSettings, getTrack, listActivities, onDataChange } from '../../data/db';
import type { Activity, AthleteSettings, TrackPoint } from '../../data/types';
import { formatDate, formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import { onLangChange } from '../../i18n';
import { buildStreams, type Sample, type Split, type Streams } from '../activity/calc';
import { esc } from '../activity/dom';
import {
  alignedSamples,
  compareSplits,
  effortRows,
  metricRows,
  runMetrics,
  similarRuns,
  timeGap,
  type Delta,
  type MetricKind,
  type RunMetrics,
} from './calc';
import { createOverlayCharts, runColors, type OverlayDef, type OverlaySeries } from './charts';
import { tr, type CmpKey } from './i18n';
import { createCompareMap } from './map';

interface RunData {
  activity: Activity;
  points: TrackPoint[];
  streams: Streams;
  metrics: RunMetrics;
}

type Slot = 'a' | 'b';

const SWAP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>';

const MINUS = '−';

/** App path for a pair of run ids (either may be missing). */
export function comparePath(a?: string, b?: string): string {
  const ids = [a, b].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
  return '/compare' + ids.map((id) => '/' + encodeURIComponent(id)).join('');
}

export function formatValue(kind: MetricKind, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  switch (kind) {
    case 'date': return formatDate(v);
    case 'distance': return formatDistance(v);
    case 'duration': return formatDuration(v);
    case 'pace': return formatPace(v);
    case 'meters': return `${formatNumber(Math.round(v))} m`;
    case 'bpm': return `${Math.round(v)} bpm`;
    case 'spm': return `${Math.round(v)} spm`;
    case 'watts': return `${Math.round(v)} W`;
    case 'number': return formatNumber(Math.round(v));
  }
}

/** A signed difference, e.g. "−0:12 /km", "+1,2 km", "+3 bpm". */
export function formatDelta(kind: MetricKind, diff: number): string {
  const sign = (rounded: number) => (rounded > 0 ? '+' : rounded < 0 ? MINUS : '');
  const abs = Math.abs(diff);
  switch (kind) {
    case 'date': {
      const days = Math.round(diff / 86_400_000);
      return tr('days', { n: `${sign(days)}${formatNumber(Math.abs(days))}` });
    }
    case 'distance': {
      const r = Math.round(diff / 10) * 10;
      return `${sign(r)}${formatDistance(Math.abs(r))}`;
    }
    case 'duration':
    case 'pace': {
      const r = Math.round(diff);
      return `${sign(r)}${formatDuration(Math.abs(r))}${kind === 'pace' ? ' /km' : ''}`;
    }
    default: {
      const r = Math.round(diff);
      const unit = { meters: ' m', bpm: ' bpm', spm: ' spm', watts: ' W', number: '' }[kind];
      return `${sign(r)}${formatNumber(Math.round(abs))}${unit}`;
    }
  }
}

const VERDICT_KEYS: Partial<Record<Delta['verdict'], CmpKey>> = { better: 'better', worse: 'worse', same: 'same' };

function deltaCell(kind: MetricKind, delta: Delta | undefined): string {
  if (!delta) return '<td class="num cmp-delta">—</td>';
  const key = VERDICT_KEYS[delta.verdict];
  const title = key ? ` title="${esc(tr(key))}"` : '';
  return `<td class="num cmp-delta cmp-${delta.verdict}"${title}>${formatDelta(kind, delta.diff)}</td>`;
}

const optionLabel = (a: Activity) =>
  `${a.hasStartTime ? formatDate(a.startTime) + ' · ' : ''}${a.name} · ${formatDistance(a.summary.distance)}`;

/**
 * "/compare", "/compare/:a" and "/compare/:a/:b": two runs side by side.
 * Changing a picker navigates to the new path (which remounts the screen).
 */
export const mount: ScreenMount = (root, params) => {
  const ids: Record<Slot, string | undefined> = { a: params.a || undefined, b: params.b || undefined };
  if (ids.a && ids.a === ids.b) ids.b = undefined;

  let disposed = false;
  let loadSeq = 0;
  let activities: Activity[] | null = null;
  let runs: Partial<Record<Slot, RunData>> = {};
  let missing = false;
  /** Charts and map of the current render, destroyed before each re-render. */
  let teardown: (() => void)[] = [];

  root.innerHTML = '<div class="page cmp-page"></div>';
  const page = root.querySelector<HTMLElement>('.page')!;

  const clearRender = () => {
    teardown.forEach((fn) => fn());
    teardown = [];
  };

  function pickerHtml(slot: Slot): string {
    const list = activities ?? [];
    const other = slot === 'a' ? ids.b : ids.a;
    const current = ids[slot];
    const known = !!current && list.some((x) => x.id === current);
    const options = [`<option value=""${known ? '' : ' selected'}>${esc(tr('choose'))}</option>`]
      .concat(
        list.map(
          (x) =>
            `<option value="${esc(x.id)}"${x.id === current ? ' selected' : ''}${x.id === other ? ' disabled' : ''}>${esc(optionLabel(x))}</option>`,
        ),
      )
      .join('');
    return `<label class="field cmp-pick cmp-pick-${slot}">
        <span><i class="cmp-dot cmp-dot-${slot}"></i>${tr(slot === 'a' ? 'runA' : 'runB')}</span>
        <select data-slot="${slot}">${options}</select>
      </label>`;
  }

  function suggestionsHtml(): string {
    const ref = runs.a?.activity;
    if (!ref || !activities) return '';
    const list = similarRuns(activities, ref, 3, ids.b ? [ids.b] : []);
    if (!list.length) return '';
    return `<div class="cmp-suggest"><span class="muted">${tr('similar')}</span>${list
      .map((x) => `<button type="button" class="btn small cmp-suggest-btn" data-suggest="${esc(x.id)}">${esc(optionLabel(x))}</button>`)
      .join('')}</div>`;
  }

  function legendHtml(a: RunData, b: RunData): string {
    const item = (slot: Slot, r: RunData) => `
      <div class="cmp-legend-item cmp-legend-${slot}">
        <div class="cmp-legend-text">
          <span class="cmp-legend-slot">${tr(slot === 'a' ? 'runA' : 'runB')}</span>
          <a href="#/activity/${encodeURIComponent(r.activity.id)}" title="${esc(tr('openRun'))}">${esc(r.activity.name)}</a>
          <span class="muted">${r.activity.hasStartTime ? formatDate(r.activity.startTime) + ' · ' : ''}${formatDistance(r.activity.summary.distance)}${
            r.streams.hasTime ? '' : ` · ${tr('noTime')}`
          }</span>
        </div>
      </div>`;
    return `<section class="card cmp-legend">${item('a', a)}${item('b', b)}</section>`;
  }

  function summaryHtml(a: RunData, b: RunData): string {
    const rows = metricRows(a.metrics, b.metrics)
      .map(
        (row) => `<tr><th scope="row">${tr(row.key)}</th>
          <td class="num">${formatValue(row.kind, row.a)}</td>
          <td class="num">${formatValue(row.kind, row.b)}</td>
          ${deltaCell(row.kind, row.delta)}</tr>`,
      )
      .join('');
    return `<section class="card cmp-summary">
      <h2 class="card-title">${tr('summaryTitle')}</h2>
      <div class="table-wrap"><table class="table cmp-table">
        <thead><tr><th>${tr('colMetric')}</th>
          <th class="num"><i class="cmp-dot cmp-dot-a"></i>A</th>
          <th class="num"><i class="cmp-dot cmp-dot-b"></i>B</th>
          <th class="num">${tr('colDelta')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="cmp-hint">${tr('deltaHint')}</p>
    </section>`;
  }

  function effortsHtml(a: RunData, b: RunData): string {
    const rows = effortRows(a.streams, b.streams);
    const body = rows.length
      ? `<div class="table-wrap"><table class="table cmp-table">
          <thead><tr><th></th><th class="num"><i class="cmp-dot cmp-dot-a"></i>A</th>
            <th class="num"><i class="cmp-dot cmp-dot-b"></i>B</th><th class="num">${tr('colDelta')}</th></tr></thead>
          <tbody>${rows
            .map(
              (e) => `<tr><th scope="row">${tr(e.key)}</th>
                <td class="num">${formatDuration(e.a)}<br /><small class="muted">${formatPace(e.a / (e.meters / 1000))}</small></td>
                <td class="num">${formatDuration(e.b)}<br /><small class="muted">${formatPace(e.b / (e.meters / 1000))}</small></td>
                ${deltaCell('duration', e.delta)}</tr>`,
            )
            .join('')}</tbody></table></div>`
      : `<p class="muted">${tr('noEfforts')}</p>`;
    return `<section class="card cmp-efforts"><h2 class="card-title">${tr('effortsTitle')}</h2>${body}</section>`;
  }

  function splitLabel(s: Split): string {
    return s.partial ? `${s.km - 1}–${formatNumber(s.km - 1 + s.distance / 1000, 2)}` : String(s.km);
  }

  function splitsHtml(a: RunData, b: RunData): string {
    const rows = compareSplits(a.streams, b.streams);
    if (!rows.length) return `<section class="card"><h2 class="card-title">${tr('splitsTitle')}</h2><p class="muted">${tr('noSplits')}</p></section>`;
    const hasHr = a.activity.summary.has.hr || b.activity.summary.has.hr;
    const paceCell = (s: Split | undefined) =>
      s ? `<td class="num${s.partial ? ' cmp-partial' : ''}"${s.partial ? ` title="${formatDistance(s.distance)}"` : ''}>${formatPace(s.pace)}</td>` : '<td class="num">—</td>';
    const hr = (s: Split | undefined) => (s?.avgHr !== undefined ? String(Math.round(s.avgHr)) : '—');
    const body = rows
      .map((r) => {
        const full = (r.a && !r.a.partial) || (r.b && !r.b.partial);
        const label = full ? String(r.km) : splitLabel((r.a ?? r.b)!);
        return `<tr>
          <td>${label}</td>
          ${paceCell(r.a)}
          ${paceCell(r.b)}
          ${deltaCell('pace', r.paceDelta)}
          ${hasHr ? `<td class="num cmp-hide-phone">${hr(r.a)}</td><td class="num cmp-hide-phone">${hr(r.b)}</td>` : ''}
        </tr>`;
      })
      .join('');
    return `<section class="card cmp-splits">
      <h2 class="card-title">${tr('splitsTitle')}</h2>
      <div class="table-wrap"><table class="table cmp-table">
        <thead><tr><th>${tr('colKm')}</th>
          <th class="num"><i class="cmp-dot cmp-dot-a"></i>${tr('colPace')} A</th>
          <th class="num"><i class="cmp-dot cmp-dot-b"></i>${tr('colPace')} B</th>
          <th class="num">${tr('colDelta')}</th>
          ${hasHr ? `<th class="num cmp-hide-phone">${tr('colHr')} A</th><th class="num cmp-hide-phone">${tr('colHr')} B</th>` : ''}
        </tr></thead>
        <tbody>${body}</tbody></table></div>
    </section>`;
  }

  function chartDefs(a: RunData, b: RunData): OverlayDef[] {
    const { a: sa, b: sb } = alignedSamples(a.streams, b.streams);
    const labelA = tr('runA'), labelB = tr('runB');
    const series = (key: keyof Sample, fill = false): OverlaySeries[] =>
      (
        [
          [labelA, runColors.a, sa],
          [labelB, runColors.b, sb],
        ] as const
      )
        .filter(([, , samples]) => samples.some((s) => s[key] !== undefined))
        .map(([label, color, samples]) => ({
          label,
          color,
          fill,
          data: samples.map((s) => ({ x: s.d / 1000, y: (s[key] as number | undefined) ?? null })),
        }));

    const defs: OverlayDef[] = [];
    const pace = series('pace');
    if (pace.length)
      defs.push({ title: tr('pace'), series: pace, reverse: true, clipOutliers: true, format: (v, l) => `${l}: ${formatPace(v)}`, tick: (v) => formatDuration(v) });
    const hr = series('hr');
    if (hr.length) defs.push({ title: tr('heartRate'), series: hr, format: (v, l) => `${l}: ${Math.round(v)} bpm`, tick: (v) => `${Math.round(v)}` });
    const ele = series('ele', true);
    if (ele.length)
      defs.push({ title: tr('elevation'), series: ele, format: (v, l) => `${l}: ${formatNumber(Math.round(v))} m`, tick: (v) => `${Math.round(v)} m` });
    const gap = timeGap(a.streams, b.streams);
    if (gap.length > 1) {
      const signed = (v: number) => `${v > 0.5 ? '+' : v < -0.5 ? MINUS : ''}${formatDuration(Math.abs(v))}`;
      defs.push({
        title: tr('gapTitle'),
        series: [{ label: labelB, color: runColors.b, fill: true, data: gap.map((g) => ({ x: g.d / 1000, y: g.ahead })) }],
        zeroLine: true,
        format: (v) =>
          v > 0.5 ? tr('ahead', { time: formatDuration(v) }) : v < -0.5 ? tr('behind', { time: formatDuration(-v) }) : tr('even'),
        tick: signed,
      });
    }
    return defs;
  }

  function bodyHtml(): string {
    if (!activities) return `<p class="muted">${tr('loading')}</p>`;
    if (!activities.length)
      return `<div class="card empty-state"><h2>${tr('emptyTitle')}</h2><p>${tr('emptyText')}</p>
        <a class="btn primary" href="#/activity">${tr('goImport')}</a></div>`;
    if (missing) return `<div class="card empty-state cmp-missing"><h2>${tr('notFoundTitle')}</h2><p>${tr('notFoundText')}</p></div>`;
    const { a, b } = runs;
    if (!a || !b) return `<p class="card muted cmp-hint-card">${tr(a ? 'hintPickOne' : 'hintPickTwo')}</p>`;
    return `
      ${legendHtml(a, b)}
      ${summaryHtml(a, b)}
      <section class="card cmp-charts-card">
        <h2 class="card-title">${tr('chartsTitle')}</h2>
        <p class="cmp-hint">${tr('chartsHint')}</p>
        <div class="cmp-charts"></div>
        <p class="cmp-hint cmp-gap-hint" hidden>${tr('gapHint')}</p>
      </section>
      <div class="cmp-grid">
        ${effortsHtml(a, b)}
        <section class="card cmp-map-card"><h2 class="card-title">${tr('mapTitle')}</h2><div class="cmp-map"></div></section>
      </div>
      ${splitsHtml(a, b)}`;
  }

  function render() {
    clearRender();
    page.innerHTML = `
      <header class="page-header"><h1>${tr('title')}</h1></header>
      <section class="card cmp-pickers">
        <p class="muted cmp-intro">${tr('intro')}</p>
        <div class="cmp-pick-row">
          ${pickerHtml('a')}
          <button type="button" class="btn cmp-swap" title="${esc(tr('swap'))}" aria-label="${esc(tr('swap'))}"${
            ids.a && ids.b ? '' : ' disabled'
          }>${SWAP_ICON}</button>
          ${pickerHtml('b')}
        </div>
        ${suggestionsHtml()}
      </section>
      ${bodyHtml()}`;

    const { a, b } = runs;
    if (!a || !b || missing) return;

    const chartsEl = page.querySelector<HTMLElement>('.cmp-charts')!;
    const defs = chartDefs(a, b);
    if (defs.length) {
      const charts = createOverlayCharts(chartsEl, defs);
      teardown.push(charts.destroy);
      const gapHint = page.querySelector<HTMLElement>('.cmp-gap-hint');
      if (gapHint) gapHint.hidden = !defs.some((d) => d.zeroLine);
    } else {
      page.querySelector<HTMLElement>('.cmp-charts-card')!.hidden = true;
    }

    const mapCard = page.querySelector<HTMLElement>('.cmp-map-card')!;
    const map = createCompareMap(
      page.querySelector<HTMLElement>('.cmp-map')!,
      { points: a.points, color: runColors.a, bounds: a.activity.summary.bounds },
      { points: b.points, color: runColors.b, bounds: b.activity.summary.bounds },
    );
    if (map) teardown.push(map.destroy);
    else mapCard.hidden = true;
  }

  // Event delegation: survives re-renders.
  const onChange = (e: Event) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-slot]');
    if (!select) return;
    const slot = select.dataset.slot as Slot;
    const next = { ...ids, [slot]: select.value || undefined };
    navigate(comparePath(next.a, next.b));
  };
  const onClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest('.cmp-swap') && ids.a && ids.b) {
      navigate(comparePath(ids.b, ids.a));
      return;
    }
    const suggest = target.closest<HTMLElement>('[data-suggest]');
    if (suggest && ids.a) navigate(comparePath(ids.a, suggest.dataset.suggest));
  };
  page.addEventListener('change', onChange);
  page.addEventListener('click', onClick);

  async function loadRun(id: string | undefined, list: Activity[], settings: AthleteSettings): Promise<RunData | null | undefined> {
    if (!id) return undefined;
    const activity = list.find((x) => x.id === id);
    if (!activity) return null;
    const points = await getTrack(id);
    if (points.length < 2) return null;
    return { activity, points, streams: buildStreams(points), metrics: runMetrics(activity, points, settings) };
  }

  async function load() {
    const seq = ++loadSeq;
    try {
      const [list, settings] = await Promise.all([listActivities(), getSettings()]);
      if (disposed || seq !== loadSeq) return;
      const [ra, rb] = await Promise.all([loadRun(ids.a, list, settings), loadRun(ids.b, list, settings)]);
      if (disposed || seq !== loadSeq) return;
      activities = list;
      missing = ra === null || rb === null;
      runs = { a: ra ?? undefined, b: rb ?? undefined };
      render();
    } catch (err) {
      console.error('Compare: failed to load runs', err);
      if (disposed || seq !== loadSeq) return;
      activities = activities ?? [];
      render();
    }
  }

  const unsubLang = onLangChange(() => render());
  const unsubData = onDataChange((store) => {
    if (store === 'activities' || store === 'tracks' || store === 'settings') void load();
  });

  render();
  void load();

  return () => {
    disposed = true;
    clearRender();
    unsubLang();
    unsubData();
    page.removeEventListener('change', onChange);
    page.removeEventListener('click', onClick);
  };
};
