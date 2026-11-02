/**
 * HTML builders for the History run filters: the panel, active-filter chips,
 * the filtered totals and the comparison bar. Event wiring lives in index.ts.
 */
import type { ActivityType } from '../../data/types';
import { formatDistance, formatDuration, formatNumber, formatPace, formatDate } from '../../format';
import type { Totals } from './aggregate';
import {
  ACTIVITY_TYPES,
  RANGE_GROUPS,
  WORKOUT_FILTERS,
  type RangeGroup,
  type RunFilters,
  type WorkoutFilter,
} from './filters';
import { t, type HistoryKey } from './i18n';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const TYPE_LABEL: Record<ActivityType, HistoryKey> = {
  run: 'typeRun',
  'trail-run': 'typeTrail',
  walk: 'typeWalk',
  other: 'typeOther',
};

export const WORKOUT_LABEL: Record<WorkoutFilter, HistoryKey> = {
  easy: 'wk_easy',
  long: 'wk_long',
  tempo: 'wk_tempo',
  intervals: 'wk_intervals',
  recovery: 'wk_recovery',
  race: 'wk_race',
  unplanned: 'wk_unplanned',
};

/** Chip / group ids that can be removed one by one. */
export type FilterGroupId = RangeGroup | 'type' | 'workout' | 'date';

/** Copy of `f` without one filter group. */
export function withoutGroup(f: RunFilters, id: FilterGroupId): RunFilters {
  const next = { ...f };
  const range = RANGE_GROUPS.find((g) => g.id === id);
  if (range) {
    delete next[range.min];
    delete next[range.max];
  } else if (id === 'type') next.activityTypes = [];
  else if (id === 'workout') next.workoutKinds = [];
  else if (id === 'date') {
    delete next.dateFrom;
    delete next.dateTo;
  }
  return next;
}

// ---- Presets ----

export interface Preset {
  id: string;
  label: HistoryKey;
  group: FilterGroupId;
  apply: (f: RunFilters) => RunFilters;
  isActive: (f: RunFilters) => boolean;
  /** Only offered when training plans exist. */
  needsPlans?: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'long',
    label: 'presetLong',
    group: 'distance',
    apply: (f) => ({ ...withoutGroup(f, 'distance'), distanceMin: 15000 }),
    isActive: (f) => f.distanceMin === 15000 && f.distanceMax === undefined,
  },
  {
    id: 'hr',
    label: 'presetHr',
    group: 'hr',
    apply: (f) => ({ ...withoutGroup(f, 'hr'), hrMin: 0 }),
    isActive: (f) => f.hrMin === 0 && f.hrMax === undefined,
  },
  {
    id: 'hilly',
    label: 'presetHilly',
    group: 'elevation',
    apply: (f) => ({ ...withoutGroup(f, 'elevation'), elevationMin: 200 }),
    isActive: (f) => f.elevationMin === 200 && f.elevationMax === undefined,
  },
  {
    id: 'race',
    label: 'presetRace',
    group: 'workout',
    apply: (f) => ({ ...f, workoutKinds: ['race'] }),
    isActive: (f) => f.workoutKinds.length === 1 && f.workoutKinds[0] === 'race',
    needsPlans: true,
  },
];

/** Applies a preset, or removes it when it is already active. */
export function togglePreset(f: RunFilters, id: string): RunFilters {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return f;
  return p.isActive(f) ? withoutGroup(f, p.group) : p.apply(f);
}

// ---- Input values (internal units → text) ----

const km = (m: number) => String(Number((m / 1000).toFixed(3)));

interface RangeMeta {
  label: HistoryKey;
  chip: HistoryKey;
  invalid: HistoryKey;
  inputMode: string;
  toText: (v: number) => string;
  show: (v: number) => string;
  unit: string;
  placeholders: [string, string];
}

export const RANGE_META: Record<RangeGroup, RangeMeta> = {
  distance: {
    label: 'filterDistance',
    chip: 'chipDistance',
    invalid: 'invalidKm',
    inputMode: 'decimal',
    toText: km,
    show: (v) => formatNumber(v / 1000, 2),
    unit: ' km',
    placeholders: ['0', '42.2'],
  },
  pace: {
    label: 'filterPace',
    chip: 'chipPace',
    invalid: 'invalidPace',
    inputMode: 'text',
    toText: (v) => formatDuration(v),
    show: (v) => formatDuration(v),
    unit: ' /km',
    placeholders: ['4:00', '7:00'],
  },
  elevation: {
    label: 'filterElevation',
    chip: 'chipElevation',
    invalid: 'invalidWhole',
    inputMode: 'numeric',
    toText: String,
    show: (v) => formatNumber(v),
    unit: ' m',
    placeholders: ['0', '1000'],
  },
  hr: {
    label: 'filterHr',
    chip: 'chipHr',
    invalid: 'invalidWhole',
    inputMode: 'numeric',
    toText: String,
    show: (v) => formatNumber(v),
    unit: ' bpm',
    placeholders: ['100', '190'],
  },
};

function rangeText(min: number | undefined, max: number | undefined, show: (v: number) => string, unit: string): string {
  if (min !== undefined && max !== undefined) return t('between', { a: show(Math.min(min, max)), b: show(Math.max(min, max)) }) + unit;
  if (min !== undefined) return t('atLeast', { v: show(min) }) + unit;
  return t('atMost', { v: show(max!) }) + unit;
}

// ---- Panel ----

export interface PanelOptions {
  hasPlans: boolean;
}

function rangeField(f: RunFilters, g: (typeof RANGE_GROUPS)[number]): string {
  const meta = RANGE_META[g.id];
  const what = t(meta.label);
  const input = (bound: 'min' | 'max') => {
    const v = f[bound === 'min' ? g.min : g.max];
    const boundLabel = t(bound === 'min' ? 'filterMin' : 'filterMax');
    return `<input type="text" id="his-f-${g.id}-${bound}" class="his-num-input" inputmode="${meta.inputMode}"
      autocomplete="off" data-range-input="${g.id}" data-bound="${bound}"
      value="${v !== undefined ? esc(meta.toText(v)) : ''}"
      placeholder="${esc(meta.placeholders[bound === 'min' ? 0 : 1])}"
      aria-label="${esc(t('filterBoundLabel', { what, bound: boundLabel }))}"
      aria-describedby="his-f-${g.id}-err" />`;
  };
  return `
    <fieldset class="his-fieldset his-range-field">
      <legend>${what}</legend>
      <div class="his-minmax">${input('min')}<span aria-hidden="true">–</span>${input('max')}</div>
      <p class="his-field-error" id="his-f-${g.id}-err" aria-live="polite"></p>
    </fieldset>`;
}

const checkChip = (attr: string, value: string, label: string, checked: boolean) => `
  <label class="his-check">
    <input type="checkbox" ${attr}="${value}"${checked ? ' checked' : ''} />
    <span>${label}</span>
  </label>`;

export function panelHtml(f: RunFilters, opts: PanelOptions): string {
  const presets = PRESETS.filter((p) => !p.needsPlans || opts.hasPlans)
    .map(
      (p) =>
        `<button type="button" class="his-preset" data-preset="${p.id}" aria-pressed="${p.isActive(f)}">${t(p.label)}</button>`,
    )
    .join('');

  const types = ACTIVITY_TYPES.map((ty) =>
    checkChip('data-filter-type', ty, t(TYPE_LABEL[ty]), f.activityTypes.includes(ty)),
  ).join('');

  const workout =
    opts.hasPlans || f.workoutKinds.length
      ? `<fieldset class="his-fieldset his-wide-field">
          <legend>${t('filterWorkout')} <span class="his-subtle">${t('filterWorkoutHint')}</span></legend>
          <div class="his-checks">${WORKOUT_FILTERS.map((k) =>
            checkChip('data-filter-kind', k, t(WORKOUT_LABEL[k]), f.workoutKinds.includes(k)),
          ).join('')}</div>
        </fieldset>`
      : '';

  return `
    <div class="his-presets" role="group" aria-label="${t('presets')}">
      <span class="his-panel-label" aria-hidden="true">${t('presets')}</span>
      ${presets}
    </div>
    <div class="his-filter-grid">
      ${RANGE_GROUPS.map((g) => rangeField(f, g)).join('')}
    </div>
    <div class="his-filter-grid">
      <fieldset class="his-fieldset">
        <legend>${t('filterType')}</legend>
        <div class="his-checks">${types}</div>
      </fieldset>
      <fieldset class="his-fieldset his-date-field">
        <legend>${t('filterDate')}</legend>
        <div class="his-minmax">
          <input type="date" id="his-f-date-from" data-date-input="from" value="${esc(f.dateFrom ?? '')}"
            aria-label="${esc(t('filterBoundLabel', { what: t('filterDate'), bound: t('filterFrom') }))}" />
          <span aria-hidden="true">–</span>
          <input type="date" id="his-f-date-to" data-date-input="to" value="${esc(f.dateTo ?? '')}"
            aria-label="${esc(t('filterBoundLabel', { what: t('filterDate'), bound: t('filterTo') }))}" />
        </div>
      </fieldset>
      ${workout}
    </div>`;
}

// ---- Chips ----

export interface Chip {
  id: FilterGroupId;
  label: string;
}

/** One chip per active filter group (labels are plain text; escape before use in HTML). */
export function filterChips(f: RunFilters): Chip[] {
  const chips: Chip[] = [];
  for (const g of RANGE_GROUPS) {
    const min = f[g.min], max = f[g.max];
    if (min === undefined && max === undefined) continue;
    const meta = RANGE_META[g.id];
    const label =
      g.id === 'hr' && min === 0 && max === undefined
        ? t('chipWithHr')
        : t(meta.chip, { range: rangeText(min, max, meta.show, meta.unit) });
    chips.push({ id: g.id, label });
  }
  if (f.activityTypes.length) {
    chips.push({ id: 'type', label: t('chipType', { list: f.activityTypes.map((x) => t(TYPE_LABEL[x])).join(', ') }) });
  }
  if (f.workoutKinds.length) {
    chips.push({
      id: 'workout',
      label: t('chipWorkout', { list: f.workoutKinds.map((x) => t(WORKOUT_LABEL[x])).join(', ') }),
    });
  }
  if (f.dateFrom || f.dateTo) {
    const show = (d: string) => formatDate(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getTime());
    const range =
      f.dateFrom && f.dateTo
        ? t('between', { a: show(f.dateFrom), b: show(f.dateTo) })
        : f.dateFrom
          ? t('atLeast', { v: show(f.dateFrom) })
          : t('atMost', { v: show(f.dateTo!) });
    chips.push({ id: 'date', label: t('chipDate', { range }) });
  }
  return chips;
}

export function chipsHtml(chips: Chip[]): string {
  if (!chips.length) return '';
  return `
    <ul class="his-chips" aria-label="${t('activeFilters')}">
      ${chips
        .map((c) => {
          const label = esc(c.label);
          const remove = esc(t('removeFilter', { label: c.label }));
          return `<li class="his-chip">
            <span>${label}</span>
            <button type="button" class="his-chip-remove" data-remove-filter="${c.id}" title="${remove}" aria-label="${remove}">×</button>
          </li>`;
        })
        .join('')}
      <li><button type="button" class="btn ghost small" data-clear-filters>${t('clearAll')}</button></li>
    </ul>`;
}

// ---- Filtered totals and compare bar ----

export function filteredTotalsHtml(tot: Totals): string {
  const item = (label: HistoryKey, value: string) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`;
  return `
    <dl class="his-filter-totals" aria-label="${t('filteredTotals')}">
      ${item('totDistance', formatDistance(tot.distance))}
      ${item('totTime', formatDuration(tot.movingTime))}
      ${item('totPace', formatPace(tot.avgPace))}
    </dl>`;
}

export function compareBarHtml(count: number): string {
  if (!count) return '';
  const action =
    count === 2
      ? `<button type="button" class="btn primary small" data-compare>${t('compare')}</button>`
      : `<span class="muted">${t(count === 1 ? 'compareHintOne' : 'compareHintMany')}</span>`;
  return `
    <strong>${t('selectedCount', { n: count })}</strong>
    ${action}
    <button type="button" class="btn ghost small" data-clear-selection>${t('clearSelection')}</button>`;
}
