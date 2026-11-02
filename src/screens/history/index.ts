import './history.css';
import type { ScreenMount } from '../../app/screen';
import { currentPath, currentQuery, navigate } from '../../app/router';
import { deleteActivity, getAll, getSettings, listActivities, onDataChange, type StoreName } from '../../data/db';
import { DEFAULT_SETTINGS, type Activity, type AthleteSettings } from '../../data/types';
import { formatDate, formatDistance, formatDuration, formatNumber, formatPace } from '../../format';
import { getLang, onLangChange, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import type { Chart } from '../../ui/chart-theme';
import {
  RANGES,
  effortRecords,
  fitnessFatigue,
  heatLevel,
  heatmap,
  inPeriod,
  loadOf,
  movingAverage,
  pacePoints,
  percentChange,
  periodFor,
  previousPeriod,
  sortActivities,
  summaryRecords,
  totals,
  weeklyBuckets,
  type EffortDistance,
  type Period,
  type RangeId,
  type SortKey,
  type Totals,
} from './aggregate';
import { fitnessChart, paceTrendChart, weeklyVolumeChart } from './charts';
import { cachedEfforts, effortsCached, loadEfforts } from './efforts';
import { t, type HistoryKey } from './i18n';
import {
  ACTIVITY_TYPES,
  RANGE_GROUPS,
  WORKOUT_FILTERS,
  activeFilterCount,
  applyFilters,
  emptyFilters,
  filtersFromQuery,
  filtersToQuery,
  hasAnyFilter,
  parseDateInput,
  parseKmInput,
  parsePaceInput,
  parseWholeInput,
  workoutKindsByActivity,
  type RangeGroup,
  type RunFilters,
} from './filters';
import {
  RANGE_META,
  TYPE_LABEL,
  chipsHtml,
  compareBarHtml,
  esc,
  filterChips,
  filteredTotalsHtml,
  panelHtml,
  togglePreset,
  withoutGroup,
  type FilterGroupId,
} from './filter-view';
import type { PlannedWorkout, TrainingPlan, WorkoutKind } from '../training/types';
import { todayDate } from '../training/dates';
import { confirmDialog } from '../../ui/confirm';

const DEFAULT_RANGE: RangeId = '12w';

const RANGE_LABEL: Record<RangeId, HistoryKey> = {
  '4w': 'range4w',
  '12w': 'range12w',
  year: 'rangeYear',
  all: 'rangeAll',
};
const COMPARE_LABEL: Record<RangeId, HistoryKey> = {
  '4w': 'vsPrevious4w',
  '12w': 'vsPrevious12w',
  year: 'vsPreviousYear',
  all: 'noComparison',
};
const EFFORT_LABEL: Record<EffortDistance, HistoryKey> = {
  1000: 'rec1k',
  5000: 'rec5k',
  10000: 'rec10k',
  21097.5: 'recHalf',
};

interface Column {
  key: SortKey;
  label: HistoryKey;
  num?: boolean;
  /** Direction used on the first click. */
  firstDir: 'asc' | 'desc';
}
const COLUMNS: Column[] = [
  { key: 'date', label: 'colDate', firstDir: 'desc' },
  { key: 'name', label: 'colName', firstDir: 'asc' },
  { key: 'type', label: 'colType', firstDir: 'asc' },
  { key: 'distance', label: 'colDistance', num: true, firstDir: 'desc' },
  { key: 'time', label: 'colTime', num: true, firstDir: 'desc' },
  { key: 'pace', label: 'colPace', num: true, firstDir: 'asc' },
  { key: 'hr', label: 'colHr', num: true, firstDir: 'desc' },
  { key: 'elevation', label: 'colElevation', num: true, firstDir: 'desc' },
  { key: 'cadence', label: 'colCadence', num: true, firstDir: 'desc' },
  { key: 'load', label: 'colLoad', num: true, firstDir: 'desc' },
];

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>';

function readRange(): RangeId {
  const r = currentQuery().get('range');
  return RANGES.includes(r as RangeId) ? (r as RangeId) : DEFAULT_RANGE;
}

/** Hash for the History screen with a period and filters (default period omitted). */
export function historyHash(range: RangeId, filters: RunFilters): string {
  const p = new URLSearchParams();
  if (range !== DEFAULT_RANGE) p.set('range', range);
  filtersToQuery(filters).forEach((v, k) => p.append(k, v));
  const qs = p.toString();
  return '#/history' + (qs ? '?' + qs : '');
}

const TEXT_DEBOUNCE_MS = 250;

const RANGE_PARSERS: Record<RangeGroup, (text: string) => number | undefined | null> = {
  distance: parseKmInput,
  pace: parsePaceInput,
  elevation: (s) => parseWholeInput(s, 20_000),
  hr: (s) => parseWholeInput(s, 260),
};

const FILTER_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>';

/** History: overview of all runs (totals, trends, load, records, consistency) and a table of every run. */
export const mount: ScreenMount = (root) => {
  root.classList.add('his-root');

  let activities: Activity[] = [];
  let settings: AthleteSettings = { ...DEFAULT_SETTINGS };
  let loaded = false;
  let range = readRange();
  let sortKey: SortKey = 'date';
  let sortDir: 'asc' | 'desc' = 'desc';
  let filters: RunFilters = filtersFromQuery(currentQuery());
  let plans: TrainingPlan[] = [];
  let workouts: PlannedWorkout[] = [];
  let kindOf = new Map<string, WorkoutKind>();
  let panelOpen = false;
  /** Runs ticked for comparison, in the order they were picked. */
  const selected = new Set<string>();
  /** Debounced text-input updates, by input id. */
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();
  let loadId = 0;
  let extrasId = 0;
  let charts: Chart[] = [];
  let effortsJob: AbortController | null = null;
  let disposed = false;

  const destroyCharts = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
  };

  // ---- Data ----

  const safeAll = <T,>(store: StoreName): Promise<T[]> =>
    getAll<T>(store).catch((err) => {
      console.warn(`History: could not load ${store}`, err);
      return [] as T[];
    });

  /** Plans and workouts: optional extras for the workout-kind filter. */
  const loadExtras = () => Promise.all([safeAll<TrainingPlan>('plans'), safeAll<PlannedWorkout>('workouts')]);

  const computeKinds = () => {
    kindOf = workoutKindsByActivity(plans, workouts, activities, todayDate());
  };

  async function reload(): Promise<void> {
    const id = ++loadId;
    extrasId++; // Supersedes any extras-only reload in flight.
    let extras: Awaited<ReturnType<typeof loadExtras>> = [[], []];
    try {
      [activities, settings, extras] = await Promise.all([listActivities(), getSettings(), loadExtras()]);
    } catch (err) {
      console.error('History: could not load data', err);
      activities = [];
    }
    if (disposed || id !== loadId) return;
    [plans, workouts] = extras;
    computeKinds();
    loaded = true;
    renderAll();
  }

  /** Training plans changed: only the runs section depends on them. */
  async function reloadExtras(): Promise<void> {
    const id = ++extrasId;
    const extras = await loadExtras();
    if (disposed || id !== extrasId) return;
    [plans, workouts] = extras;
    computeKinds();
    syncPanel();
    renderTable();
  }

  // ---- Rendering ----

  function renderAll(): void {
    destroyCharts();
    effortsJob?.abort();
    effortsJob = null;

    if (!loaded) {
      root.innerHTML = `<div class="page"><p class="muted">${t('loading')}</p></div>`;
      return;
    }
    if (!activities.length) {
      root.innerHTML = `
        <div class="page his-page">
          <header class="page-header"><h1>${t('title')}</h1></header>
          <div class="card empty-state">
            <h2>${t('emptyTitle')}</h2>
            <p>${t('emptyText')}</p>
            <a class="btn primary" href="#/activity">${t('emptyAction')}</a>
          </div>
        </div>`;
      return;
    }

    const now = Date.now();
    const period = periodFor(range, now, activities);
    const prev = previousPeriod(range, period);
    const inRange = activities.filter((a) => inPeriod(a, period));

    root.innerHTML = `
      <div class="page his-page">
        <header class="page-header">
          <h1>${t('title')}</h1>
          <div class="his-range" role="group" aria-label="${t('rangeLabel')}">
            ${RANGES.map(
              (r) =>
                `<button type="button" class="his-range-btn" data-range="${r}" aria-pressed="${r === range}">${t(RANGE_LABEL[r])}</button>`,
            ).join('')}
          </div>
        </header>

        ${totalsHtml(period, prev, inRange)}

        <div class="his-grid">
          <section class="card his-wide">
            <h2 class="card-title">${t('weeklyTitle')}</h2>
            <div class="his-chart"><canvas id="his-weekly"></canvas></div>
            <div id="his-weekly-data"></div>
          </section>
          <section class="card">
            <h2 class="card-title">${t('paceTitle')} <span class="his-subtle">${t('paceHint')}</span></h2>
            <div id="his-pace-body"></div>
          </section>
          <section class="card">
            <h2 class="card-title">${t('fitnessTitle')}</h2>
            <div id="his-fitness-body"></div>
          </section>
          <section class="card">
            <h2 class="card-title">${t('recordsTitle')} <span class="his-subtle">${t('recordsAllTime')}</span></h2>
            <div id="his-records"></div>
          </section>
          <section class="card">
            <h2 class="card-title">${t('calendarTitle')}</h2>
            <div id="his-calendar"></div>
          </section>
        </div>

        <section class="card his-runs">
          <div class="his-runs-header">
            <h2 class="card-title">${t('runsTitle')} <span class="his-subtle" id="his-runs-count" aria-live="polite"></span></h2>
            <input id="his-search" type="search" placeholder="${t('search')}" aria-label="${t('search')}" value="${esc(filters.query)}" />
            <button type="button" class="btn small his-filter-toggle" id="his-filter-toggle"
              aria-expanded="${panelOpen}" aria-controls="his-filter-panel">
              ${FILTER_ICON}<span>${t('filters')}</span><span class="his-filter-badge" id="his-filter-badge" aria-hidden="true"></span>
            </button>
          </div>
          <div id="his-filter-panel" class="his-filter-panel" role="region" aria-label="${t('filtersPanel')}"${panelOpen ? '' : ' hidden'}>
            ${panelHtml(filters, panelOptions())}
          </div>
          <div id="his-filter-chips"></div>
          <div id="his-filter-summary"></div>
          <div id="his-compare-bar" class="his-compare-bar" aria-live="polite" hidden></div>
          <div id="his-runs-body"></div>
        </section>
      </div>`;

    renderWeekly(period);
    renderPace(period);
    renderFitness(period, now);
    renderCalendar(period, now);
    renderTable(inRange);
    renderRecords();
  }

  function totalsHtml(period: Period, prev: Period | null, inRange: Activity[]): string {
    const cur = totals(inRange, settings);
    const before = prev ? totals(activities.filter((a) => inPeriod(a, prev)), settings) : null;

    const delta = (key: keyof Totals): string => {
      if (!before) return '';
      const pct = percentChange(cur[key], before[key]);
      if (pct === undefined) return '';
      const rounded = Math.round(pct);
      const text =
        rounded > 0
          ? t('deltaUp', { pct: formatNumber(rounded) })
          : rounded < 0
            ? t('deltaDown', { pct: formatNumber(-rounded) })
            : t('deltaSame');
      return `<span class="his-delta">${text}</span>`;
    };
    const paceDelta = (): string => {
      if (!before || cur.avgPace === undefined || before.avgPace === undefined) return '';
      const diff = Math.round(cur.avgPace - before.avgPace);
      if (diff === 0) return `<span class="his-delta">${t('deltaSame')}</span>`;
      const d = formatDuration(Math.abs(diff));
      return `<span class="his-delta">${diff < 0 ? t('paceFaster', { d }) : t('paceSlower', { d })}</span>`;
    };
    const tile = (label: HistoryKey, value: string, deltaHtml: string, main = false) => `
      <div class="stat${main ? ' main' : ''}">
        <dt>${t(label)}</dt>
        <dd>${value}</dd>
        ${deltaHtml}
      </div>`;

    const lastDay = period.end - 1;
    return `
      <section class="card his-totals">
        <p class="his-compare">
          <strong>${formatDate(period.start)} – ${formatDate(lastDay)}</strong>
          <span class="muted">· ${t(COMPARE_LABEL[range])}</span>
        </p>
        <dl class="stat-grid">
          ${tile('totDistance', formatDistance(cur.distance), delta('distance'), true)}
          ${tile('totRuns', formatNumber(cur.runs), delta('runs'))}
          ${tile('totTime', formatDuration(cur.movingTime), delta('movingTime'))}
          ${tile('totElevation', `${formatNumber(cur.elevationGain)} m`, delta('elevationGain'))}
          ${tile('totPace', formatPace(cur.avgPace), paceDelta())}
          ${tile('totHr', cur.avgHr !== undefined ? `${formatNumber(cur.avgHr)} <small>${t('bpm')}</small>` : '—', delta('avgHr'))}
          ${tile('totLoad', cur.load !== undefined ? formatNumber(cur.load) : '—', delta('load'))}
        </dl>
      </section>`;
  }

  function renderWeekly(period: Period): void {
    const buckets = weeklyBuckets(activities, period);
    const canvas = root.querySelector<HTMLCanvasElement>('#his-weekly')!;
    charts.push(weeklyVolumeChart(canvas, buckets));
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('weeklyTitle'));

    root.querySelector('#his-weekly-data')!.innerHTML = `
      <details class="his-data">
        <summary>${t('viewData')}</summary>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${t('colWeek')}</th><th class="num">${t('colDistance')}</th><th class="num">${t('colRuns')}</th><th class="num">${t('colTime')}</th></tr></thead>
            <tbody>
              ${[...buckets]
                .reverse()
                .map(
                  (b) =>
                    `<tr><td>${formatDate(b.weekStart)}</td><td class="num">${formatDistance(b.distance)}</td><td class="num">${b.runs}</td><td class="num">${formatDuration(b.movingTime)}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </details>`;
  }

  function renderPace(period: Period): void {
    const body = root.querySelector('#his-pace-body')!;
    const points = pacePoints(activities, period);
    if (!points.length) {
      body.innerHTML = `<p class="muted his-chart-empty">${t('paceEmpty')}</p>`;
      return;
    }
    body.innerHTML = `<div class="his-chart"><canvas role="img" aria-label="${t('paceTitle')}"></canvas></div>`;
    const trend = movingAverage(points.map((p) => p.pace), 5);
    charts.push(paceTrendChart(body.querySelector('canvas')!, points, trend));
  }

  function renderFitness(period: Period, now: number): void {
    const body = root.querySelector('#his-fitness-body')!;
    const days = fitnessFatigue(activities, settings, now).filter((d) => d.day >= period.start);
    if (!days.length) {
      body.innerHTML = `<p class="muted his-chart-empty">${t('fitnessEmpty')}</p>`;
      return;
    }
    const today = days[days.length - 1];
    const state = today.form > 5 ? t('formFresh') : today.form < -10 ? t('formTired') : t('formNeutral');
    body.innerHTML = `
      <div class="his-chart"><canvas role="img" aria-label="${t('fitnessTitle')}"></canvas></div>
      <p class="his-note"><strong>${t('formNow', { value: `${formatNumber(today.form)} (${state})` })}</strong></p>
      <p class="his-note muted">${t('fitnessHint')}</p>`;
    charts.push(fitnessChart(body.querySelector('canvas')!, days));
  }

  function renderRecords(): void {
    const el = root.querySelector('#his-records');
    if (!el) return;
    const ready = effortsCached(activities);
    const efforts = effortRecords(activities, cachedEfforts(activities));
    const sum = summaryRecords(activities);

    const row = (label: string, value: string, a?: Activity, extra = '') =>
      `<li class="his-record">
        <span class="his-record-label">${label}</span>
        ${
          a
            ? `<a class="his-record-value" href="#/activity/${encodeURIComponent(a.id)}">${value}</a>
               <span class="his-record-meta">${esc(a.name)} · ${formatDate(a.startTime)}${extra}</span>`
            : `<span class="his-record-value muted">${value}</span>`
        }
      </li>`;

    const effortRows = ([1000, 5000, 10000, 21097.5] as EffortDistance[])
      .map((d) => {
        const rec = efforts.find((e) => e.distance === d);
        if (rec) {
          const pace = rec.time / (d / 1000);
          return row(t(EFFORT_LABEL[d]), formatDuration(rec.time), rec.activity, ` · ${formatPace(pace)}`);
        }
        return ready ? '' : row(t(EFFORT_LABEL[d]), t('recCalculating'));
      })
      .join('');

    const rows = [
      effortRows,
      sum.longest ? row(t('recLongest'), formatDistance(sum.longest.summary.distance), sum.longest) : '',
      sum.biggestClimb
        ? row(t('recClimb'), `${formatNumber(sum.biggestClimb.summary.elevationGain)} m`, sum.biggestClimb)
        : '',
      sum.fastestPace ? row(t('recPace'), formatPace(sum.fastestPace.summary.avgPace), sum.fastestPace) : '',
    ].join('');
    el.innerHTML = rows.trim() ? `<ul class="his-records">${rows}</ul>` : `<p class="muted">${t('recNone')}</p>`;

    if (!ready && !effortsJob) {
      const job = new AbortController();
      effortsJob = job;
      void loadEfforts(activities, job.signal).then(() => {
        if (job.signal.aborted || disposed) return;
        effortsJob = null;
        renderRecords();
      });
    }
  }

  function renderCalendar(period: Period, now: number): void {
    const el = root.querySelector('#his-calendar')!;
    const grid = heatmap(activities, period, now);
    const initials = t('weekdayInitials').split(',');
    const runDays = grid.flat().filter((c) => c.runs > 0).length;

    const cells = grid
      .map(
        (week) =>
          `<div class="his-week">${week
            .map((c) => {
              if (c.future) return '<span class="his-cell his-future" aria-hidden="true"></span>';
              const label =
                c.runs > 0
                  ? t('calendarDay', {
                      date: formatDate(c.day),
                      distance: formatDistance(c.distance),
                      runs: c.runs === 1 ? t('weeklyTooltipRun') : t('weeklyTooltipRuns', { n: c.runs }),
                    })
                  : `${formatDate(c.day)}: ${t('calendarRest')}`;
              return `<span class="his-cell l${heatLevel(c.distance)}" title="${esc(label)}" aria-label="${esc(label)}" role="img"></span>`;
            })
            .join('')}</div>`,
      )
      .join('');

    // Month label above the week holding the month's first Monday.
    const monthFmt = new Intl.DateTimeFormat(getLang(), { month: 'short' });
    const months = grid
      .map((week) => `<span>${new Date(week[0].day).getDate() <= 7 ? monthFmt.format(week[0].day) : ''}</span>`)
      .join('');

    el.innerHTML = `
      <p class="his-note muted">${t('calendarRunDays', { n: runDays, weeks: grid.length })}</p>
      <div class="his-calendar-scroll">
        <div class="his-calendar" style="--his-weeks: ${grid.length}">
          <div class="his-months">${months}</div>
          <div class="his-weekdays">${initials.map((d, i) => `<span>${i % 2 === 0 ? d : ''}</span>`).join('')}</div>
          <div class="his-weeks">${cells}</div>
        </div>
      </div>
      <div class="his-legend" aria-hidden="true">
        <span>${t('calendarLess')}</span>
        ${[0, 1, 2, 3, 4].map((l) => `<span class="his-cell l${l}"></span>`).join('')}
        <span>${t('calendarMore')}</span>
        <span class="his-legend-scale">0 · &lt;5 · &lt;10 · &lt;15 · 15+ km</span>
      </div>`;
    // Show the most recent weeks first when the calendar is wider than the card.
    const scroller = el.querySelector<HTMLElement>('.his-calendar-scroll')!;
    scroller.scrollLeft = scroller.scrollWidth;
  }

  const panelOptions = () => ({ hasPlans: workouts.length > 0 });

  /** Rebuilds the filter panel from `filters` (after presets, chips, URL changes). */
  function syncPanel(): void {
    cancelPending();
    const panel = root.querySelector('#his-filter-panel');
    if (panel) panel.innerHTML = panelHtml(filters, panelOptions());
    const search = root.querySelector<HTMLInputElement>('#his-search');
    if (search && search.value !== filters.query) search.value = filters.query;
  }

  function renderFilterState(): void {
    const n = activeFilterCount(filters);
    const badge = root.querySelector<HTMLElement>('#his-filter-badge');
    if (badge) {
      badge.textContent = n ? String(n) : '';
      badge.hidden = !n;
    }
    root
      .querySelector('#his-filter-toggle')
      ?.setAttribute('aria-label', n ? t('filtersWithCount', { n }) : t('filters'));
    const chips = root.querySelector('#his-filter-chips');
    if (chips) chips.innerHTML = chipsHtml(filterChips(filters));
  }

  function renderCompareBar(): void {
    const bar = root.querySelector<HTMLElement>('#his-compare-bar');
    if (!bar) return;
    bar.innerHTML = compareBarHtml(selected.size);
    bar.hidden = selected.size === 0;
  }

  function renderTable(inRange?: Activity[]): void {
    const body = root.querySelector('#his-runs-body');
    if (!body) return;
    const period = periodFor(range, Date.now(), activities);
    const list = inRange ?? activities.filter((a) => inPeriod(a, period));
    const filtered = applyFilters(list, filters, { kindOf });
    const shown = sortActivities(filtered, sortKey, sortDir, settings);
    const filtering = hasAnyFilter(filters);

    // Drop selected runs that are no longer listed.
    const visible = new Set(shown.map((a) => a.id));
    for (const id of selected) if (!visible.has(id)) selected.delete(id);

    root.querySelector('#his-runs-count')!.textContent = filtering
      ? t('resultCount', { n: shown.length, total: list.length })
      : t('runsCount', { n: shown.length });
    renderFilterState();
    renderCompareBar();
    root.querySelector('#his-filter-summary')!.innerHTML =
      filtering && shown.length ? filteredTotalsHtml(totals(shown, settings)) : '';

    if (!list.length) {
      body.innerHTML = `<p class="muted his-chart-empty">${t('noRunsInPeriod')}</p>`;
      return;
    }
    if (!shown.length) {
      body.innerHTML = activeFilterCount(filters)
        ? `<div class="his-chart-empty"><p class="muted">${t('noFilterMatch')}</p>
            <button type="button" class="btn small" data-clear-filters>${t('clearAll')}</button></div>`
        : `<p class="muted his-chart-empty">${t('noMatch', { query: esc(filters.query) })}</p>`;
      return;
    }

    const head = COLUMNS.map((c) => {
      const active = c.key === sortKey;
      const aria = active ? ` aria-sort="${sortDir === 'asc' ? 'ascending' : 'descending'}"` : '';
      const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
      return `<th${c.num ? ' class="num"' : ''}${aria}>
        <button type="button" class="his-sort" data-sort="${c.key}" title="${t('sortBy', { col: t(c.label) })}">
          ${t(c.label)}<span class="his-sort-arrow" aria-hidden="true">${arrow}</span>
        </button>
      </th>`;
    }).join('');

    const rows = shown
      .map((a) => {
        const s = a.summary;
        const load = loadOf(a, settings);
        const name = esc(a.name);
        const cell = (col: HistoryKey, value: string, cls = '') =>
          `<td class="${cls}" data-label="${t(col)}">${value}</td>`;
        return `<tr data-id="${esc(a.id)}">
          <td class="his-col-select">
            <input type="checkbox" class="his-select" data-select="${esc(a.id)}"${selected.has(a.id) ? ' checked' : ''}
              aria-label="${t('selectRun', { name })}" />
          </td>
          ${cell('colDate', formatDate(a.startTime), 'his-col-date')}
          ${cell('colName', `<a href="#/activity/${encodeURIComponent(a.id)}" title="${t('openRun', { name })}">${name}</a>`, 'his-col-name')}
          ${cell('colType', `<span class="badge">${t(TYPE_LABEL[a.type])}</span>`, 'his-col-type')}
          ${cell('colDistance', formatDistance(s.distance), 'num his-col-distance')}
          ${cell('colTime', formatDuration(s.movingTime), 'num')}
          ${cell('colPace', formatPace(s.avgPace), 'num')}
          ${cell('colHr', s.avgHr !== undefined ? formatNumber(s.avgHr) : '—', 'num')}
          ${cell('colElevation', `${formatNumber(s.elevationGain)} m`, 'num')}
          ${cell('colCadence', s.avgCadence !== undefined ? formatNumber(s.avgCadence) : '—', 'num')}
          ${cell('colLoad', load !== undefined ? formatNumber(load) : '—', 'num')}
          <td class="his-col-actions">
            <button type="button" class="btn ghost small danger his-delete" data-delete="${esc(a.id)}"
              title="${t('deleteRun', { name })}" aria-label="${t('deleteRun', { name })}">${TRASH_ICON}</button>
          </td>
        </tr>`;
      })
      .join('');

    body.innerHTML = `
      <div class="table-wrap">
        <table class="table his-table">
          <thead><tr><th class="his-col-select"><span class="his-sr">${t('colSelect')}</span></th>${head}<th class="his-col-actions"><span class="his-sr">${t('colActions')}</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ---- Filter state changes ----

  function cancelPending(): void {
    pending.forEach((p) => clearTimeout(p.timer));
    pending.clear();
  }

  /** Applies typed-but-not-yet-applied input right away. */
  function flushPending(): void {
    const jobs = [...pending.values()];
    cancelPending();
    jobs.forEach((p) => p.run());
  }

  function debounce(key: string, run: () => void): void {
    const prev = pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const job = {
      run,
      timer: setTimeout(() => {
        pending.delete(key);
        run();
      }, TEXT_DEBOUNCE_MS),
    };
    pending.set(key, job);
  }

  /** Keeps the URL shareable without adding history entries or remounting. */
  function writeUrl(): void {
    const hash = historyHash(range, filters);
    if (location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
  }

  function filtersChanged(): void {
    writeUrl();
    renderTable();
  }

  /** Replaces the filters from a click (preset, chip, clear) and refreshes the panel. */
  function setFilters(next: RunFilters, focusSelector?: string): void {
    filters = next;
    syncPanel();
    filtersChanged();
    if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus();
  }

  function onRangeInput(input: HTMLInputElement): void {
    const group = input.dataset.rangeInput as RangeGroup;
    const g = RANGE_GROUPS.find((x) => x.id === group)!;
    const field = input.dataset.bound === 'min' ? g.min : g.max;
    const value = RANGE_PARSERS[group](input.value);
    const error = root.querySelector(`#his-f-${group}-err`);
    if (value === null) {
      input.setAttribute('aria-invalid', 'true');
      if (error) error.textContent = t(RANGE_META[group].invalid);
      return;
    }
    input.removeAttribute('aria-invalid');
    const fieldset = input.closest('fieldset');
    if (error && !fieldset?.querySelector('[aria-invalid="true"]')) error.textContent = '';
    if (filters[field] === value) return;
    filters = { ...filters, [field]: value };
    if (value === undefined) delete filters[field];
    filtersChanged();
  }

  function onDateInput(input: HTMLInputElement): void {
    const value = parseDateInput(input.value);
    if (value === null) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.removeAttribute('aria-invalid');
    const field = input.dataset.dateInput === 'from' ? 'dateFrom' : 'dateTo';
    if (filters[field] === value) return;
    filters = { ...filters, [field]: value };
    if (value === undefined) delete filters[field];
    filtersChanged();
  }

  // ---- Events (delegated; the root element is discarded on unmount) ----

  root.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    const rangeBtn = target.closest<HTMLElement>('[data-range]');
    if (rangeBtn) {
      const next = rangeBtn.dataset.range as RangeId;
      if (next !== range) {
        flushPending();
        location.hash = historyHash(next, filters);
      }
      return;
    }

    if (target.closest('#his-filter-toggle')) {
      panelOpen = !panelOpen;
      root.querySelector<HTMLElement>('#his-filter-panel')!.hidden = !panelOpen;
      root.querySelector('#his-filter-toggle')!.setAttribute('aria-expanded', String(panelOpen));
      if (panelOpen) root.querySelector<HTMLElement>('#his-filter-panel .his-preset')?.focus();
      return;
    }

    const preset = target.closest<HTMLElement>('[data-preset]');
    if (preset) {
      flushPending();
      setFilters(togglePreset(filters, preset.dataset.preset!), `[data-preset="${preset.dataset.preset}"]`);
      return;
    }

    const removeChip = target.closest<HTMLElement>('[data-remove-filter]');
    if (removeChip) {
      flushPending();
      setFilters(withoutGroup(filters, removeChip.dataset.removeFilter as FilterGroupId));
      // Keep keyboard focus in the chip list (or on the toggle once it is empty).
      (root.querySelector<HTMLElement>('[data-remove-filter]') ?? root.querySelector<HTMLElement>('#his-filter-toggle'))?.focus();
      return;
    }

    if (target.closest('[data-clear-filters]')) {
      setFilters(emptyFilters(), '#his-filter-toggle');
      return;
    }

    if (target.closest('[data-compare]')) {
      const [a, b] = [...selected];
      if (a && b) navigate(`/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
      return;
    }

    if (target.closest('[data-clear-selection]')) {
      selected.clear();
      root.querySelectorAll<HTMLInputElement>('[data-select]').forEach((cb) => (cb.checked = false));
      renderCompareBar();
      return;
    }

    const sortBtn = target.closest<HTMLElement>('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort as SortKey;
      if (key === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = key;
        sortDir = COLUMNS.find((c) => c.key === key)!.firstDir;
      }
      renderTable();
      root.querySelector<HTMLElement>(`[data-sort="${key}"]`)?.focus();
      return;
    }

    const del = target.closest<HTMLElement>('[data-delete]');
    if (del) {
      const a = activities.find((x) => x.id === del.dataset.delete);
      if (!a) return;
      const ok = await confirmDialog({
        title: tg('dlgDeleteRun'),
        message: t('confirmDelete', { name: a.name }),
        confirmLabel: tg('dlgDelete'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await deleteActivity(a.id); // onDataChange triggers the reload.
        showToast(t('deleted', { name: a.name }));
      } catch (err) {
        console.error(err);
        showToast(t('deleteFailed'), 'error');
      }
      return;
    }

    if (target.closest('a, button, input, select, label, summary, .his-col-select')) return;
    const row = target.closest<HTMLElement>('tr[data-id]');
    if (row) navigate('/activity/' + row.dataset.id);
  });

  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === 'his-search') {
      debounce(input.id, () => {
        filters = { ...filters, query: input.value };
        filtersChanged();
      });
    } else if (input.dataset.rangeInput) {
      debounce(input.id, () => onRangeInput(input));
    } else if (input.dataset.dateInput) {
      onDateInput(input);
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el instanceof HTMLInputElement && el.dataset.select) {
      if (el.checked) selected.add(el.dataset.select);
      else selected.delete(el.dataset.select);
      renderCompareBar();
      return;
    }
    if (el instanceof HTMLInputElement && el.dataset.dateInput) {
      onDateInput(el);
      return;
    }
    const checked = (attr: string) =>
      new Set([...root.querySelectorAll<HTMLInputElement>(`[${attr}]:checked`)].map((x) => x.getAttribute(attr)!));
    if (el instanceof HTMLInputElement && el.dataset.filterType) {
      const on = checked('data-filter-type');
      filters = { ...filters, activityTypes: ACTIVITY_TYPES.filter((x) => on.has(x)) };
      filtersChanged();
    } else if (el instanceof HTMLInputElement && el.dataset.filterKind) {
      const on = checked('data-filter-kind');
      filters = { ...filters, workoutKinds: WORKOUT_FILTERS.filter((x) => on.has(x)) };
      filtersChanged();
    }
  });

  const onHash = () => {
    if (currentPath() !== '/history') return;
    const nextRange = readRange();
    const nextFilters = filtersFromQuery(currentQuery());
    const changed = filtersToQuery(nextFilters).toString() !== filtersToQuery(filters).toString();
    if (changed) filters = nextFilters;
    if (nextRange !== range) {
      range = nextRange;
      cancelPending();
      renderAll();
    } else if (changed) {
      syncPanel();
      renderTable();
    }
  };
  window.addEventListener('hashchange', onHash);

  const stopData = onDataChange((store) => {
    if (store === 'activities' || store === 'settings') void reload();
    else if (store === 'plans' || store === 'workouts') void reloadExtras();
  });
  const stopLang = onLangChange(() => renderAll());

  renderAll();
  void reload();

  return () => {
    disposed = true;
    cancelPending();
    effortsJob?.abort();
    destroyCharts();
    window.removeEventListener('hashchange', onHash);
    stopData();
    stopLang();
    root.classList.remove('his-root');
  };
};
