/**
 * Inline editor for structured workout steps, used inside the workout dialog.
 * Keeps the typed text of every input in a draft model, so re-rendering (add,
 * remove, reorder) never loses what the user typed; text is parsed into
 * `WorkoutStep[]` only when read.
 */
import { formatDuration, formatNumber, parsePace } from '../../format';
import { parseDuration } from './csv';
import { t } from './i18n';
import { derivedTargets, estimateSteps, stepId, stepKindLabel, stepsSummary, validateSteps, type StepIssue } from './structure';
import { STEP_KINDS, type SimpleStep, type StepKind, type StepTarget, type WorkoutStep } from './types';
import { esc, structureBars } from './view';

type DurUnit = 'km' | 'm' | 'time' | 'open';
type TgtType = 'none' | 'pace' | 'zone' | 'bpm';

interface StepDraft {
  id: string;
  kind: StepKind;
  dur: DurUnit;
  value: string;
  tgt: TgtType;
  a: string;
  b: string;
  note: string;
}
interface RepeatDraft {
  id: string;
  repeat: true;
  times: string;
  steps: StepDraft[];
}
type Draft = StepDraft | RepeatDraft;

const isRepeat = (d: Draft): d is RepeatDraft => 'repeat' in d;

function toStepDraft(s: SimpleStep): StepDraft {
  const d = s.duration;
  const draft: StepDraft = { id: s.id, kind: s.kind, dur: 'open', value: '', tgt: 'none', a: '', b: '', note: s.note ?? '' };
  if (d.type === 'distance') {
    draft.dur = d.meters < 1000 ? 'm' : 'km';
    draft.value = d.meters < 1000 ? String(d.meters) : formatNumber(d.meters / 1000, 3).replace(/\s/g, '');
  } else if (d.type === 'time') {
    draft.dur = 'time';
    draft.value = formatDuration(d.seconds);
  }
  const tg = s.target;
  if (tg?.type === 'pace') Object.assign(draft, { tgt: 'pace', a: formatDuration(tg.min), b: formatDuration(tg.max) });
  else if (tg && 'zone' in tg) Object.assign(draft, { tgt: 'zone', a: String(tg.zone) });
  else if (tg) Object.assign(draft, { tgt: 'bpm', a: String(tg.min), b: String(tg.max) });
  return draft;
}

const toDrafts = (steps: WorkoutStep[]): Draft[] =>
  steps.map((s) => (s.type === 'repeat' ? { id: s.id, repeat: true, times: String(s.times), steps: s.steps.map(toStepDraft) } : toStepDraft(s)));

const numberOf = (v: string) => (v.trim() ? Number(v.trim().replace(',', '.')) : NaN);

/** Parses a draft; invalid numbers become NaN so validation reports them. */
function fromStepDraft(d: StepDraft): SimpleStep {
  const s: SimpleStep = { type: 'step', id: d.id, kind: d.kind, duration: { type: 'open' } };
  if (d.dur === 'km') s.duration = { type: 'distance', meters: Math.round(numberOf(d.value) * 1000) };
  else if (d.dur === 'm') s.duration = { type: 'distance', meters: Math.round(numberOf(d.value)) };
  else if (d.dur === 'time') s.duration = { type: 'time', seconds: parseDuration(d.value) ?? NaN };
  let target: StepTarget | undefined;
  if (d.tgt === 'pace') {
    const a = parsePace(d.a) ?? NaN;
    const b = d.b.trim() ? parsePace(d.b) ?? NaN : a;
    target = { type: 'pace', min: Math.min(a, b), max: Math.max(a, b) };
    if (Number.isNaN(a) || Number.isNaN(b)) target = { type: 'pace', min: NaN, max: NaN };
  } else if (d.tgt === 'zone') {
    target = { type: 'hr', zone: numberOf(d.a) };
  } else if (d.tgt === 'bpm') {
    const a = numberOf(d.a);
    const b = d.b.trim() ? numberOf(d.b) : a;
    target = { type: 'hr', min: Math.min(a, b), max: Math.max(a, b) };
    if (Number.isNaN(a) || Number.isNaN(b)) target = { type: 'hr', min: NaN, max: NaN };
  }
  if (target) s.target = target;
  if (d.note.trim()) s.note = d.note.trim().slice(0, 200);
  return s;
}

const fromDrafts = (drafts: Draft[]): WorkoutStep[] =>
  drafts.map((d) =>
    isRepeat(d)
      ? { type: 'repeat', id: d.id, times: Number(d.times.trim() || NaN), steps: d.steps.map(fromStepDraft) }
      : fromStepDraft(d),
  );

const newStep = (kind: StepKind, dur: DurUnit, value: string): StepDraft => ({ id: stepId(), kind, dur, value, tgt: 'none', a: '', b: '', note: '' });

export interface StepsEditor {
  /** Parsed steps, or the first problem. */
  read(): { steps: WorkoutStep[]; issue: null } | { steps: null; issue: StepIssue };
  set(steps: WorkoutStep[]): void;
  isEmpty(): boolean;
  /** Estimated targets from the valid steps (for auto-filling the form). */
  derived(): { distance?: number; duration?: number };
}

export function createStepsEditor(
  host: HTMLElement,
  initial: WorkoutStep[],
  opts: { easyPace?: number; onChange?: () => void } = {},
): StepsEditor {
  let drafts = toDrafts(initial);

  const opt = (value: string, label: string, selected: string) =>
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
  const iconBtn = (op: string, label: string, glyph: string, disabled = false) =>
    `<button class="btn ghost small trn-sbtn" type="button" data-op="${op}" title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>${glyph}</button>`;

  function stepRow(d: StepDraft, i: number, list: StepDraft[] | Draft[], parent?: string): string {
    const valueInput =
      d.dur === 'open'
        ? ''
        : `<input class="trn-sval" type="text" inputmode="${d.dur === 'time' ? 'text' : 'decimal'}" data-f="value" value="${esc(d.value)}" placeholder="${d.dur === 'km' ? '1,5' : d.dur === 'm' ? '400' : '10:00'}" aria-label="${esc(t('fStepValue'))}" />`;
    let target = '';
    if (d.tgt === 'pace') {
      target = `<input class="trn-space" type="text" data-f="a" value="${esc(d.a)}" placeholder="4:00" aria-label="${esc(t('paceFast'))}" title="${esc(t('paceFast'))}" /><span aria-hidden="true">–</span><input class="trn-space" type="text" data-f="b" value="${esc(d.b)}" placeholder="4:10" aria-label="${esc(t('paceSlow'))}" title="${esc(t('paceSlow'))}" />`;
    } else if (d.tgt === 'zone') {
      target = `<select data-f="a" aria-label="${esc(t('tgt_zone'))}">${[1, 2, 3, 4, 5].map((z) => opt(String(z), `Z${z}`, d.a || '2')).join('')}</select>`;
    } else if (d.tgt === 'bpm') {
      target = `<input class="trn-sbpm" type="text" inputmode="numeric" data-f="a" value="${esc(d.a)}" placeholder="140" aria-label="${esc(t('bpmLow'))}" /><span aria-hidden="true">–</span><input class="trn-sbpm" type="text" inputmode="numeric" data-f="b" value="${esc(d.b)}" placeholder="150" aria-label="${esc(t('bpmHigh'))}" />`;
    }
    return `
      <li class="trn-srow trn-step-${d.kind}" data-id="${esc(d.id)}" ${parent ? `data-parent="${esc(parent)}"` : ''}>
        <select data-f="kind" aria-label="${esc(t('fStepKind'))}">${STEP_KINDS.map((k) => opt(k, stepKindLabel(k), d.kind)).join('')}</select>
        <span class="trn-sgroup">${valueInput}<select data-f="dur" aria-label="${esc(t('fStepDuration'))}">${(['km', 'm', 'time', 'open'] as DurUnit[]).map((u) => opt(u, t(`dur_${u}`), d.dur)).join('')}</select></span>
        <span class="trn-sgroup"><select data-f="tgt" aria-label="${esc(t('fStepTarget'))}">${(['none', 'pace', 'zone', 'bpm'] as TgtType[]).map((v) => opt(v, t(`tgt_${v}`), d.tgt)).join('')}</select>${target}</span>
        <input class="trn-snote" type="text" data-f="note" maxlength="200" value="${esc(d.note)}" placeholder="${esc(t('stepNotePh'))}" aria-label="${esc(t('stepNotePh'))}" />
        <span class="trn-sbtns">
          ${iconBtn('up', t('moveUp'), '↑', i === 0)}${iconBtn('down', t('moveDown'), '↓', i === list.length - 1)}${iconBtn('del', t('removeStep'), '×')}
        </span>
      </li>`;
  }

  function render(): void {
    const active = document.activeElement as HTMLElement | null;
    const focus = active && host.contains(active)
      ? { id: active.closest<HTMLElement>('[data-id]')?.dataset.id, f: active.dataset.f, op: active.dataset.op }
      : null;
    const rows = drafts
      .map((d, i) =>
        isRepeat(d)
          ? `
      <li class="trn-srepeat" data-id="${esc(d.id)}">
        <div class="trn-srepeat-head">
          <label><span>${esc(t('repeatLabel'))}</span>
            <input class="trn-stimes" type="number" min="1" max="99" step="1" data-f="times" value="${esc(d.times)}" />
            <span>${esc(t('repeatTimes'))}</span></label>
          <span class="trn-sbtns">${iconBtn('up', t('moveUp'), '↑', i === 0)}${iconBtn('down', t('moveDown'), '↓', i === drafts.length - 1)}${iconBtn('del', t('removeStep'), '×')}</span>
        </div>
        <ol class="trn-srows">${d.steps.map((c, j) => stepRow(c, j, d.steps, d.id)).join('')}</ol>
        <button class="btn ghost small" type="button" data-op="add-child">+ ${esc(t('addStepInBlock'))}</button>
      </li>`
          : stepRow(d, i, drafts),
      )
      .join('');
    host.innerHTML = `
      <ol class="trn-srows">${rows}</ol>
      <div class="trn-steps-actions">
        <button class="btn small" type="button" data-op="add-step">+ ${esc(t('addStep'))}</button>
        <button class="btn small" type="button" data-op="add-repeat">+ ${esc(t('addRepeat'))}</button>
      </div>
      <div class="trn-steps-preview" aria-live="polite"></div>`;
    if (focus?.id) {
      const row = host.querySelector<HTMLElement>(`[data-id="${CSS.escape(focus.id)}"]`);
      const el = focus.f ? row?.querySelector<HTMLElement>(`[data-f="${focus.f}"]`) : focus.op ? row?.querySelector<HTMLElement>(`[data-op="${focus.op}"]:not([disabled])`) : null;
      (el ?? row?.querySelector<HTMLElement>('select'))?.focus();
    }
    updatePreview();
  }

  /** Steps that parse correctly (for the live preview). */
  function validSteps(): WorkoutStep[] {
    return fromDrafts(drafts).flatMap((s): WorkoutStep[] => {
      if (s.type === 'repeat') {
        const children = s.steps.filter((c) => !validateSteps([c]));
        return children.length && !validateSteps([{ ...s, steps: children }]) ? [{ ...s, steps: children }] : [];
      }
      return validateSteps([s]) ? [] : [s];
    });
  }

  function updatePreview(): void {
    const el = host.querySelector<HTMLElement>('.trn-steps-preview');
    if (!el) return;
    const steps = validSteps();
    if (!steps.length) {
      el.innerHTML = '';
      return;
    }
    const e = estimateSteps(steps, opts.easyPace);
    const parts: string[] = [];
    if (e.distance > 0) parts.push(`${formatNumber(e.distance / 1000, 1)} km`);
    if (e.duration > 0) parts.push(formatDuration(Math.round(e.duration / 60) * 60));
    if (e.hasOpen) parts.push(t('stepsEstimateOpen'));
    el.innerHTML = `
      ${structureBars(steps, opts.easyPace)}
      <p class="trn-steps-summary">${esc(stepsSummary(steps))}</p>
      ${parts.length ? `<p class="muted trn-steps-estimate">${esc(t('stepsEstimate', { value: parts.join(' · ') }))}</p>` : ''}`;
  }

  /** The draft with this id and the list it is in. */
  function locate(id: string): { list: Draft[]; index: number; draft: Draft } | null {
    for (const list of [drafts, ...drafts.filter(isRepeat).map((r) => r.steps as Draft[])]) {
      const index = list.findIndex((d) => d.id === id);
      if (index >= 0) return { list, index, draft: list[index] };
    }
    return null;
  }

  /** Inserts at the end, but before a trailing cool-down. */
  function insertTop(d: Draft): void {
    const last = drafts[drafts.length - 1];
    if (last && !isRepeat(last) && last.kind === 'cooldown') drafts.splice(drafts.length - 1, 0, d);
    else drafts.push(d);
  }

  const changed = () => opts.onChange?.();

  function onField(el: HTMLInputElement | HTMLSelectElement): void {
    const f = el.dataset.f;
    const id = el.closest<HTMLElement>('[data-id]')?.dataset.id;
    const hit = id ? locate(id) : null;
    if (!f || !hit) return;
    const d = hit.draft as unknown as Record<string, string>;
    d[f] = el.value;
    if (f === 'kind') el.closest<HTMLElement>('.trn-srow')!.className = `trn-srow trn-step-${el.value}`;
    if (f === 'dur' || f === 'tgt') {
      if (f === 'dur') d.value = '';
      else {
        d.a = el.value === 'zone' ? '2' : '';
        d.b = '';
      }
      render();
    } else updatePreview();
    changed();
  }
  // Text inputs update on every keystroke; selects on change.
  host.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) onField(e.target);
  });
  host.addEventListener('change', (e) => {
    if (e.target instanceof HTMLSelectElement) onField(e.target);
  });

  host.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-op]');
    if (!btn || btn.disabled) return;
    const op = btn.dataset.op!;
    const id = btn.closest<HTMLElement>('[data-id]')?.dataset.id;
    const hit = id ? locate(id) : null;
    if (op === 'add-step') insertTop(newStep('active', 'km', '1'));
    else if (op === 'add-repeat') {
      insertTop({ id: stepId(), repeat: true, times: '4', steps: [newStep('active', 'm', '400'), newStep('recovery', 'm', '200')] });
    } else if (op === 'add-child' && hit && isRepeat(hit.draft)) hit.draft.steps.push(newStep('active', 'm', '400'));
    else if (hit && op === 'del') hit.list.splice(hit.index, 1);
    else if (hit && (op === 'up' || op === 'down')) {
      const j = hit.index + (op === 'up' ? -1 : 1);
      if (j < 0 || j >= hit.list.length) return;
      [hit.list[hit.index], hit.list[j]] = [hit.list[j], hit.list[hit.index]];
    } else return;
    render();
    changed();
  });

  render();

  return {
    read() {
      const steps = fromDrafts(drafts);
      const issue = validateSteps(steps);
      return issue ? { steps: null, issue } : { steps, issue: null };
    },
    set(steps) {
      drafts = toDrafts(steps);
      render();
      changed();
    },
    isEmpty: () => !drafts.length,
    derived: () => derivedTargets(validSteps(), opts.easyPace),
  };
}
