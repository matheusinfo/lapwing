/** Modal forms of the training screen, all in one reusable <dialog>. */
import { newId, put, putMany, remove } from '../../data/db';
import type { Activity } from '../../data/types';
import { formatDistance, formatDuration, formatNumber, formatPace, parsePace } from '../../format';
import { getLang, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import { exportPlanCsv, exportPlanJson, parsePlanFile, parseDuration, type PlanImport } from './csv';
import { addDays, isDateStr, localDateOf, weekStart } from './dates';
import { downloadFile, exportIcs, exportPlanIcs, exportTcx, exportWorkoutFit, fileSlug, RUNNING_KINDS, selectWorkouts } from './export';
import { generatePlan, TEMPLATES, type GenGoal, type GenKey, type GenText } from './generator';
import { t } from './i18n';
import type { WorkoutResult } from './matching';
import { createStepsEditor, type StepsEditor } from './steps-editor';
import { buildTemplate, distance as stepDistance, paceRange, simpleStep, STEP_TEMPLATES, time as stepTime, type StepTemplateId } from './structure';
import type { PlannedWorkout, PlanGoal, TrainingPlan, WorkoutDraft, WorkoutKind, WorkoutStep } from './types';
import { esc, goalLabel, goalOptions, icon, kindOptions, shortDate, workoutTitle } from './view';
import { confirmDialog } from '../../ui/confirm';

export interface DialogContext {
  dialog: HTMLDialogElement;
  today: () => string;
  activities: () => Activity[];
  /** Called after a plan is created, to select it. */
  selectPlan: (planId: string) => void;
}

function open(ctx: DialogContext, html: string): HTMLFormElement {
  const { dialog } = ctx;
  dialog.innerHTML = `<form class="trn-form" novalidate>${html}</form>`;
  const form = dialog.querySelector('form')!;
  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  if (!dialog.open) dialog.showModal();
  form.querySelector<HTMLElement>('input, select, textarea')?.focus();
  return form;
}

function showError(form: HTMLFormElement, message: string | null): void {
  const el = form.querySelector<HTMLElement>('.trn-form-error')!;
  el.textContent = message ?? '';
  el.hidden = !message;
}

const field = (name: string, form: HTMLFormElement) =>
  (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value.trim() ?? '';

const fmtKm = (m: number) => formatNumber(m / 1000, 2);

/** Formats targets back into the inputs (seconds → "m:ss"). */
const durationInput = (s?: number) => (s ? formatDuration(s) : '');
const paceInput = (s?: number) => (s ? formatDuration(s) : '');

const footer = (submitLabel: string, extra = '') => `
  <p class="trn-form-error" role="alert" hidden></p>
  <div class="trn-form-actions">
    ${extra}
    <span class="trn-spacer"></span>
    <button class="btn" type="button" data-close>${t('cancel')}</button>
    <button class="btn primary" type="submit">${submitLabel}</button>
  </div>`;

// ---- Workout ----

export function openWorkoutDialog(
  ctx: DialogContext,
  plan: TrainingPlan,
  opts: { workout?: PlannedWorkout; date?: string; result?: WorkoutResult; easyPace?: number },
): void {
  const w = opts.workout;
  const date = w?.date ?? opts.date ?? ctx.today();
  // Runs of the workout's week (a run may be linked to another day's workout),
  // plus the linked run wherever it is, so saving never drops the link.
  const wkStart = w ? weekStart(w.date) : '';
  const wkEnd = w ? addDays(wkStart, 6) : '';
  const runsThatDay = w
    ? ctx
        .activities()
        .filter((a) => {
          const d = localDateOf(a.startTime);
          return (
            d === w.date ||
            (d >= wkStart && d <= wkEnd && (a.type === 'run' || a.type === 'trail-run')) ||
            a.id === w.linkedActivityId
          );
        })
        .sort((a, b) => a.startTime - b.startTime)
    : [];
  const linkValue = w?.linkedActivityId ?? (w?.unlinked ? 'none' : 'auto');
  const time = (a: Activity) => {
    const d = localDateOf(a.startTime);
    const hm = new Intl.DateTimeFormat(getLang(), { hour: '2-digit', minute: '2-digit' }).format(a.startTime);
    return d === w?.date ? hm : `${shortDate(d)} ${hm}`;
  };
  const linkOptions = [
    `<option value="auto" ${linkValue === 'auto' ? 'selected' : ''}>${t('linkAuto')}</option>`,
    `<option value="none" ${linkValue === 'none' ? 'selected' : ''}>${t('linkNone')}</option>`,
    ...runsThatDay.map(
      (a) =>
        `<option value="${esc(a.id)}" ${linkValue === a.id ? 'selected' : ''}>${esc(`${time(a)} · ${formatDistance(a.summary.distance)} · ${a.name}`)}</option>`,
    ),
  ].join('');
  const matched = opts.result?.activity;
  const hasSteps = !!w?.steps?.length;

  const form = open(
    ctx,
    `
    <h2>${w ? t('editWorkout') : t('newWorkout')}</h2>
    <div class="trn-form-grid">
      <label class="field"><span>${t('fDate')}</span><input type="date" name="date" value="${esc(date)}" required /></label>
      <label class="field"><span>${t('fKind')}</span><select name="kind">${kindOptions(w?.kind ?? 'easy')}</select></label>
      <label class="field trn-span2"><span>${t('fTitle')}</span><input type="text" name="title" maxlength="80" placeholder="${esc(t('fTitlePh'))}" value="${esc(w?.title ?? '')}" /></label>
      <label class="field"><span>${t('fDistance')}</span><input type="text" inputmode="decimal" name="distance" placeholder="8" value="${w?.distance ? esc(fmtKm(w.distance)) : ''}" /></label>
      <label class="field"><span>${t('fDuration')}</span><input type="text" name="duration" placeholder="45:00" value="${esc(durationInput(w?.duration))}" /></label>
      <label class="field"><span>${t('fPace')}</span><input type="text" name="pace" placeholder="5:30" value="${esc(paceInput(w?.pace))}" /></label>
      <div class="trn-span2 trn-structured">
        <div class="trn-structured-head">
          <label class="trn-check"><input type="checkbox" name="structured" ${hasSteps ? 'checked' : ''} /><span>${t('structured')}</span></label>
          <select name="stepTemplate" aria-label="${esc(t('templatePick'))}">
            <option value="">${t('templatePick')}</option>
            ${STEP_TEMPLATES.map((tp) => `<option value="${tp.id}">${esc(t(`tpl_${tp.id}`))}</option>`).join('')}
          </select>
        </div>
        <p class="muted trn-structured-hint">${t('structuredHint')}</p>
        <div class="trn-steps" ${hasSteps ? '' : 'hidden'}></div>
      </div>
      <label class="field trn-span2"><span>${t('fDescription')}</span><textarea name="description" rows="3" maxlength="500" placeholder="${esc(t('fDescriptionPh'))}">${esc(w?.description ?? '')}</textarea></label>
      ${
        w
          ? `
      <label class="field"><span>${t('fStatus')}</span>
        <select name="status">
          <option value="auto" ${!w.status ? 'selected' : ''}>${t('statusAuto')}</option>
          <option value="done" ${w.status === 'done' ? 'selected' : ''}>${t('statusManualDone')}</option>
          <option value="skipped" ${w.status === 'skipped' ? 'selected' : ''}>${t('statusSkipped')}</option>
        </select></label>
      <label class="field"><span>${t('fLink')}</span><select name="link">${linkOptions}</select>
        <small class="muted">${
          matched
            ? esc(t('linkCurrent', { run: `${formatDistance(matched.summary.distance)}${matched.summary.avgPace ? ' · ' + formatPace(matched.summary.avgPace) : ''}` }))
            : runsThatDay.length ? '' : t('noRunsThatDay')
        }</small></label>`
          : ''
      }
      <div class="trn-span2 trn-wexport">
        <span class="muted">${t('exportWorkout')}:</span>
        <button class="btn ghost small" type="button" data-export="fit">${icon('download')}${t('exportFit')}</button>
        <button class="btn ghost small" type="button" data-export="tcx">${icon('download')}TCX</button>
        <button class="btn ghost small" type="button" data-export="ics">${icon('download')}ICS</button>
        <small class="muted">${t('exportFitHint')}</small>
      </div>
    </div>
    ${footer(
      t('save'),
      w
        ? `<button class="btn danger" type="button" data-delete>${icon('trash')}${t('delete')}</button>
           ${matched ? `<a class="btn ghost" href="#/activity/${encodeURIComponent(matched.id)}" data-close>${t('openRun')}</a>` : ''}`
        : '',
    )}`,
  );

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!w) return;
    const ok = await confirmDialog({
      title: tg('dlgDeleteWorkout'),
      message: t('confirmDeleteWorkout'),
      confirmLabel: tg('dlgDelete'),
      tone: 'danger',
    });
    if (!ok) return;
    await remove('workouts', w.id);
    ctx.dialog.close();
  });

  // ---- Structured steps ----
  const structuredBox = form.elements.namedItem('structured') as HTMLInputElement;
  const templateSel = form.elements.namedItem('stepTemplate') as HTMLSelectElement;
  const kindSel = form.elements.namedItem('kind') as HTMLSelectElement;
  const titleInput = form.elements.namedItem('title') as HTMLInputElement;
  const distInput = form.elements.namedItem('distance') as HTMLInputElement;
  const durInput = form.elements.namedItem('duration') as HTMLInputElement;
  const paceInputEl = form.elements.namedItem('pace') as HTMLInputElement;
  const stepsHost = form.querySelector<HTMLElement>('.trn-steps')!;
  const exportRow = form.querySelector<HTMLElement>('.trn-wexport')!;
  // Distance/duration filled from the steps; they follow the steps until the user types another value.
  let autoDist: string | null = hasSteps ? distInput.value : null;
  let autoDur: string | null = hasSteps ? durInput.value : null;
  let editor: StepsEditor | null = null;

  const syncDerived = (force = false) => {
    if (!editor || !structuredBox.checked) return;
    const d = editor.derived();
    const distText = d.distance ? fmtKm(d.distance) : '';
    const durText = d.duration ? formatDuration(d.duration) : '';
    if (force || distInput.value === '' || distInput.value === autoDist) {
      distInput.value = distText;
      autoDist = distText;
    }
    if (force || durInput.value === '' || durInput.value === autoDur) {
      durInput.value = durText;
      autoDur = durText;
    }
  };
  const ensureEditor = (): StepsEditor => {
    editor ??= createStepsEditor(stepsHost, w?.steps ?? [], { easyPace: opts.easyPace, onChange: () => syncDerived() });
    return editor;
  };
  /** A first structure from the simple targets: warm-up, the run, cool-down. */
  const defaultSteps = (): WorkoutStep[] => {
    const km = Number(distInput.value.replace(',', '.'));
    const secs = parseDuration(durInput.value);
    const pace = parsePace(paceInputEl.value);
    const main = km > 0 ? stepDistance(Math.round(km * 1000)) : secs ? stepTime(secs) : stepDistance(5000);
    return [simpleStep('warmup', stepTime(600)), simpleStep('active', main, pace ? paceRange(pace, 10) : undefined), simpleStep('cooldown', stepTime(600))];
  };
  const setStructured = (on: boolean) => {
    structuredBox.checked = on;
    stepsHost.hidden = !on;
    if (!on) return;
    const ed = ensureEditor();
    if (ed.isEmpty()) {
      ed.set(defaultSteps());
      syncDerived(true);
    }
  };
  if (hasSteps) ensureEditor();
  structuredBox.addEventListener('change', () => setStructured(structuredBox.checked));
  templateSel.addEventListener('change', async () => {
    const id = templateSel.value as StepTemplateId;
    templateSel.value = '';
    const tpl = STEP_TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    const ed = ensureEditor();
    if (structuredBox.checked && !ed.isEmpty()) {
      const ok = await confirmDialog({
        title: tg('dlgReplaceSteps'),
        message: t('confirmReplaceSteps'),
        confirmLabel: tg('dlgReplace'),
      });
      if (!ok) return;
    }
    structuredBox.checked = true;
    stepsHost.hidden = false;
    ed.set(buildTemplate(tpl.id, opts.easyPace ? { easy: opts.easyPace } : undefined));
    kindSel.value = tpl.kind;
    if (!titleInput.value.trim()) titleInput.value = t(`tpl_${tpl.id}`);
    syncDerived(true);
    updateExportRow();
  });
  const updateExportRow = () => (exportRow.hidden = !RUNNING_KINDS.includes(kindSel.value as WorkoutKind));
  kindSel.addEventListener('change', updateExportRow);
  updateExportRow();

  /** The workout as entered, or null after showing what's wrong. */
  const collect = (): PlannedWorkout | null => {
    const fail = (message: string) => {
      showError(form, message);
      return null;
    };
    const d = field('date', form);
    if (!isDateStr(d)) return fail(t('errDate'));
    const distRaw = field('distance', form).replace(',', '.');
    const dist = distRaw ? Number(distRaw) : 0;
    if (!Number.isFinite(dist) || dist < 0 || dist > 500) return fail(t('errDistance'));
    const durRaw = field('duration', form);
    const duration = durRaw ? parseDuration(durRaw) : undefined;
    if (durRaw && duration === undefined) return fail(t('errDuration'));
    const paceRaw = field('pace', form);
    const pace = paceRaw ? parsePace(paceRaw) ?? undefined : undefined;
    if (paceRaw && pace === undefined) return fail(t('errPace'));
    let steps: WorkoutStep[] | undefined;
    if (structuredBox.checked && editor) {
      const r = editor.read();
      if (r.issue) return fail(t(`errSteps_${r.issue.code}`, { n: r.issue.index }));
      steps = r.steps;
    }
    showError(form, null);

    const next: PlannedWorkout = {
      id: w?.id ?? newId(),
      planId: plan.id,
      date: d,
      kind: field('kind', form) as WorkoutKind,
      title: field('title', form),
    };
    if (dist > 0) next.distance = Math.round(dist * 1000);
    if (duration) next.duration = duration;
    if (pace) next.pace = pace;
    const description = field('description', form);
    if (description) next.description = description;
    if (steps?.length) next.steps = steps;
    if (w) {
      const status = field('status', form);
      if (status === 'done' || status === 'skipped') next.status = status;
      const link = field('link', form);
      if (link === 'none') next.unlinked = true;
      else if (link !== 'auto') next.linkedActivityId = link;
    }
    return next;
  };

  exportRow.addEventListener('click', (e) => {
    const format = (e.target as HTMLElement).closest<HTMLElement>('[data-export]')?.dataset.export;
    const next = format ? collect() : null;
    if (!next) return;
    const name = `${next.date}-${fileSlug(workoutTitle(next), 'workout')}`;
    if (format === 'fit') downloadFile(exportWorkoutFit(next), `${name}.fit`, 'application/vnd.ant.fit');
    else if (format === 'tcx') downloadFile(exportTcx([next], { schedule: true }), `${name}.tcx`, 'application/vnd.garmin.tcx+xml');
    else if (format === 'ics') downloadFile(exportIcs(workoutTitle(next), [next]), `${name}.ics`, 'text/calendar');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = collect();
    if (!next) return;
    await put('workouts', next);
    ctx.dialog.close();
  });
}

// ---- Export ----

type ExportFormat = 'ics' | 'tcx' | 'csv' | 'json';
const EXPORT_FORMATS: ExportFormat[] = ['ics', 'tcx', 'csv', 'json'];
/** Defaults per format: watch/calendar files usually only need what's ahead. */
const EXPORT_DEFAULTS: Record<ExportFormat, { upcoming: boolean; rest: boolean }> = {
  ics: { upcoming: true, rest: false },
  tcx: { upcoming: true, rest: false },
  csv: { upcoming: false, rest: true },
  json: { upcoming: false, rest: true },
};

export function openExportDialog(ctx: DialogContext, plan: TrainingPlan, workouts: PlannedWorkout[]): void {
  const form = open(
    ctx,
    `
    <h2>${t('exportTitle')}</h2>
    <p class="muted trn-form-intro">${t('exportIntro')}</p>
    <fieldset class="trn-formats">
      <legend class="trn-sr-only">${t('exportTitle')}</legend>
      ${EXPORT_FORMATS.map(
        (f, i) => `
      <label class="trn-format">
        <input type="radio" name="format" value="${f}" ${i === 0 ? 'checked' : ''} />
        <span><strong>${t(`fmt_${f}`)}</strong><small class="muted">${t(`fmt_${f}_desc`)}</small></span>
      </label>`,
      ).join('')}
    </fieldset>
    <div class="trn-export-opts">
      <label class="trn-check"><input type="checkbox" name="upcoming" /><span>${t('exportUpcoming')}</span></label>
      <label class="trn-check"><input type="checkbox" name="rest" /><span>${t('exportRest')}</span></label>
    </div>
    <p class="muted trn-export-count" aria-live="polite"></p>
    ${footer(t('exportDownload'))}`,
  );
  const upcoming = form.elements.namedItem('upcoming') as HTMLInputElement;
  const rest = form.elements.namedItem('rest') as HTMLInputElement;
  const countEl = form.querySelector<HTMLElement>('.trn-export-count')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const format = () => (form.querySelector<HTMLInputElement>('input[name="format"]:checked')?.value ?? 'ics') as ExportFormat;
  const selected = () =>
    selectWorkouts(workouts, {
      includeRest: format() !== 'tcx' && rest.checked,
      from: upcoming.checked ? ctx.today() : undefined,
      runningOnly: format() === 'tcx',
    });
  const update = () => {
    rest.disabled = format() === 'tcx';
    const n = selected().length;
    countEl.textContent = n ? t('exportCount', { count: n }) : t('exportNone');
    submit.disabled = !n;
  };
  const applyDefaults = () => {
    const d = EXPORT_DEFAULTS[format()];
    upcoming.checked = d.upcoming;
    rest.checked = d.rest;
    update();
  };
  form.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).name === 'format') applyDefaults();
    else update();
  });
  applyDefaults();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const list = selected();
    if (!list.length) return;
    const name = fileSlug(plan.name);
    const f = format();
    if (f === 'ics') downloadFile(exportPlanIcs(plan, list), `${name}.ics`, 'text/calendar');
    else if (f === 'tcx') downloadFile(exportTcx(list, { schedule: true }), `${name}.tcx`, 'application/vnd.garmin.tcx+xml');
    else if (f === 'csv') downloadFile(exportPlanCsv(list), `${name}.csv`, 'text/csv');
    else downloadFile(exportPlanJson(plan, list), `${name}.json`, 'application/json');
    ctx.dialog.close();
    showToast(t('exportDone', { count: list.length }));
  });
}

// ---- Plan (create blank / edit) ----

export function openPlanDialog(ctx: DialogContext, plan?: TrainingPlan): void {
  const form = open(
    ctx,
    `
    <h2>${plan ? t('planDialogEdit') : t('planDialogNew')}</h2>
    <div class="trn-form-grid">
      <label class="field trn-span2"><span>${t('fName')}</span><input type="text" name="name" maxlength="80" required value="${esc(plan?.name ?? '')}" /></label>
      <label class="field"><span>${t('fGoal')}</span><select name="goal">${goalOptions(plan?.goal ?? '10k')}</select></label>
      <label class="field"><span>${t('fRaceDate')} <small class="muted">${t('optional')}</small></span><input type="date" name="raceDate" value="${esc(plan?.raceDate ?? '')}" /></label>
    </div>
    ${footer(t('save'))}`,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = field('name', form);
    if (!name) return showError(form, t('errName'));
    const raceDate = field('raceDate', form);
    if (raceDate && !isDateStr(raceDate)) return showError(form, t('errDate'));
    const next: TrainingPlan = {
      id: plan?.id ?? newId(),
      name,
      goal: field('goal', form) as PlanGoal,
      createdAt: plan?.createdAt ?? Date.now(),
    };
    if (raceDate) next.raceDate = raceDate;
    await put('plans', next);
    if (!plan) ctx.selectPlan(next.id);
    ctx.dialog.close();
    showToast(t('planSaved'));
  });
}

// ---- Generator ----

/** Generator text with paces and numbers formatted for the current language. */
const genText: GenText = (key: GenKey, p = {}) =>
  t(key, {
    km: p.km !== undefined ? formatNumber(p.km, 1) : '',
    pace: p.pace !== undefined ? formatPace(p.pace) : '',
    reps: p.reps ?? '',
    meters: p.meters ?? '',
    goal: p.goal ? goalLabel(p.goal) : '',
  });

const GEN_GOALS: GenGoal[] = ['5k', '10k', 'half', 'marathon'];

const defaultRaceDate = (today: string, goal: GenGoal) =>
  addDays(weekStart(today), (TEMPLATES[goal].weeks - 1) * 7 + 6);

export function openGeneratorDialog(ctx: DialogContext): void {
  const today = ctx.today();
  const form = open(
    ctx,
    `
    <h2>${t('genTitle')}</h2>
    <p class="muted trn-form-intro">${t('genIntro')}</p>
    <div class="trn-form-grid">
      <label class="field"><span>${t('fGoal')}</span><select name="goal">${goalOptions('10k', GEN_GOALS)}</select></label>
      <label class="field"><span>${t('fRaceDate')}</span><input type="date" name="raceDate" min="${addDays(today, 1)}" value="${defaultRaceDate(today, '10k')}" required /></label>
      <label class="field"><span>${t('fRunsPerWeek')}</span>
        <select name="runs"><option value="3">3</option><option value="4" selected>4</option><option value="5">5</option></select></label>
      <label class="field"><span>${t('fTargetTime')} <small class="muted">${t('optional')}</small></span>
        <input type="text" name="target" placeholder="55:00" />
        <small class="muted">${t('fTargetTimeHint')}</small></label>
      <label class="field trn-span2"><span>${t('fName')} <small class="muted">${t('optional')}</small></span>
        <input type="text" name="name" maxlength="80" placeholder="${esc(t('defaultPlanName', { goal: goalLabel('10k') }))}" /></label>
    </div>
    <div class="trn-preview" aria-live="polite"></div>
    ${footer(t('genSave'), `<button class="btn" type="button" data-preview>${t('genPreview')}</button>`)}`,
  );
  const saveBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const previewEl = form.querySelector<HTMLElement>('.trn-preview')!;
  const goalSel = form.elements.namedItem('goal') as HTMLSelectElement;
  const raceInput = form.elements.namedItem('raceDate') as HTMLInputElement;
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  let raceTouched = false;
  let generated: { input: { goal: GenGoal; raceDate: string; targetTime?: number }; workouts: WorkoutDraft[] } | null = null;
  saveBtn.disabled = true;

  const reset = () => {
    generated = null;
    saveBtn.disabled = true;
    previewEl.innerHTML = '';
    showError(form, null);
  };
  raceInput.addEventListener('input', () => (raceTouched = true));
  goalSel.addEventListener('change', () => {
    const goal = goalSel.value as GenGoal;
    if (!raceTouched) raceInput.value = defaultRaceDate(today, goal);
    nameInput.placeholder = t('defaultPlanName', { goal: goalLabel(goal) });
  });
  form.addEventListener('input', reset);
  form.addEventListener('change', reset);

  const build = (): boolean => {
    const goal = goalSel.value as GenGoal;
    const raceDate = raceInput.value;
    if (!isDateStr(raceDate) || raceDate <= today) {
      showError(form, t('errRaceDate'));
      return false;
    }
    const targetRaw = field('target', form);
    const targetTime = targetRaw ? parseDuration(targetRaw) : undefined;
    if (targetRaw && targetTime === undefined) {
      showError(form, t('errDuration'));
      return false;
    }
    const runsPerWeek = Number(field('runs', form)) as 3 | 4 | 5;
    const plan = generatePlan({ goal, raceDate, runsPerWeek, targetTime, today }, genText);
    if (typeof plan === 'string') {
      showError(form, t('errRaceDate'));
      return false;
    }
    showError(form, null);
    generated = { input: { goal, raceDate, targetTime }, workouts: plan.workouts };
    const total = plan.workouts.reduce((s, w) => s + (w.distance ?? 0), 0);
    const rows = plan.weeks
      .map((wk, i) => {
        const ws = plan.workouts.filter((w) => weekStart(w.date) === wk.start);
        const weekKm = ws.reduce((s, w) => s + (w.distance ?? 0), 0);
        const long = ws.find((w) => w.kind === 'long' || w.kind === 'race');
        const sessions = ws.map((w) => esc(workoutTitle(w))).join(' · ');
        return `<tr class="trn-phase-${wk.phase}">
          <td>${i + 1}</td>
          <td>${esc(shortDate(wk.start))}</td>
          <td>${wk.phase === 'build' ? '' : `<span class="badge">${t(`phase_${wk.phase}`)}</span>`}</td>
          <td class="num">${formatNumber(weekKm / 1000, 1)}</td>
          <td class="num">${long?.distance ? formatNumber(long.distance / 1000, 1) : '—'}</td>
          <td class="trn-sessions">${sessions}</td>
        </tr>`;
      })
      .join('');
    previewEl.innerHTML = `
      <p class="trn-preview-summary"><strong>${esc(t('genSummary', { weeks: plan.weeks.length, workouts: plan.workouts.length, km: formatNumber(total / 1000, 0) }))}</strong></p>
      ${plan.shortened ? `<p class="badge warn trn-preview-warn">${esc(t('genShort', { weeks: plan.weeks.length, ideal: plan.idealWeeks }))}</p>` : ''}
      <div class="table-wrap trn-preview-table"><table class="table">
        <thead><tr><th>#</th><th>${t('colWeek')}</th><th></th><th class="num">${t('colKm')}</th><th class="num">${t('colLong')}</th><th>${t('colSessions')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    saveBtn.disabled = false;
    return true;
  };
  form.querySelector('[data-preview]')!.addEventListener('click', build);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!generated && !build()) return;
    const g = generated!;
    const plan: TrainingPlan = {
      id: newId(),
      name: field('name', form) || t('defaultPlanName', { goal: goalLabel(g.input.goal) }),
      goal: g.input.goal,
      raceDate: g.input.raceDate,
      createdAt: Date.now(),
    };
    await put('plans', plan);
    await putMany('workouts', g.workouts.map((w) => ({ ...w, id: newId(), planId: plan.id })));
    ctx.selectPlan(plan.id);
    ctx.dialog.close();
    showToast(t('planSaved'));
  });
}

// ---- Import ----

export function openImportDialog(ctx: DialogContext, downloads: { csv: () => void; json: () => void }): void {
  const form = open(
    ctx,
    `
    <h2>${t('importTitle')}</h2>
    <p class="muted trn-form-intro">${t('importIntro')}</p>
    <p class="trn-templates">
      <button class="btn ghost small" type="button" data-template="csv">${icon('file')}${t('templateCsv')}</button>
      <button class="btn ghost small" type="button" data-template="json">${icon('file')}${t('templateJson')}</button>
    </p>
    <label class="dropzone trn-dropzone">
      ${icon('upload')}
      <span>${t('importChoose')}</span>
      <input type="file" name="file" accept=".csv,.json,.txt,text/csv,application/json" hidden />
    </label>
    <div class="trn-import-result" aria-live="polite"></div>
    ${footer(t('importSave', { count: 0 }))}`,
  );
  form.querySelector('[data-template="csv"]')!.addEventListener('click', downloads.csv);
  form.querySelector('[data-template="json"]')!.addEventListener('click', downloads.json);
  const saveBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  saveBtn.disabled = true;
  const resultEl = form.querySelector<HTMLElement>('.trn-import-result')!;
  const drop = form.querySelector<HTMLElement>('.trn-dropzone')!;
  const fileInput = form.elements.namedItem('file') as HTMLInputElement;
  let parsed: PlanImport | null = null;

  const errorText = (e: PlanImport['errors'][number]) =>
    `${e.line ? `${t('importLine', { line: e.line })}: ` : ''}${t(`err_${e.code}`, { value: e.value ?? '' })}`;

  async function handle(file: File) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      showToast(t('readError'), 'error');
      return;
    }
    parsed = parsePlanFile(text, file.name);
    const { workouts, errors } = parsed;
    const lastRace = [...workouts].reverse().find((w) => w.kind === 'race')?.date;
    const raceDate = parsed.raceDate ?? lastRace ?? '';
    const name = parsed.name ?? file.name.replace(/\.(csv|json|txt)$/i, '');
    const shownErrors = errors.slice(0, 15).map((e) => `<li>${esc(errorText(e))}</li>`).join('');
    resultEl.innerHTML = `
      ${workouts.length ? `<p><strong>${esc(t('importFound', { count: workouts.length, file: file.name }))}</strong></p>` : `<p class="badge bad">${t('importNone')}</p>`}
      ${errors.length && workouts.length ? `<p class="muted">${t('importErrors', { count: errors.length })}</p>` : ''}
      ${errors.length ? `<ul class="trn-import-errors">${shownErrors}${errors.length > 15 ? '<li>…</li>' : ''}</ul>` : ''}
      ${
        workouts.length
          ? `<div class="trn-form-grid">
        <label class="field trn-span2"><span>${t('fName')}</span><input type="text" name="name" maxlength="80" value="${esc(name)}" /></label>
        <label class="field"><span>${t('fGoal')}</span><select name="goal">${goalOptions(parsed.goal ?? 'other')}</select></label>
        <label class="field"><span>${t('fRaceDate')} <small class="muted">${t('optional')}</small></span><input type="date" name="raceDate" value="${esc(raceDate)}" /></label>
      </div>`
          : ''
      }`;
    saveBtn.textContent = t('importSave', { count: workouts.length });
    saveBtn.disabled = !workouts.length;
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handle(f);
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) void handle(f);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!parsed?.workouts.length) return;
    const raceDate = field('raceDate', form);
    const plan: TrainingPlan = {
      id: newId(),
      name: field('name', form) || t('importTitle'),
      goal: (field('goal', form) || 'other') as PlanGoal,
      createdAt: Date.now(),
    };
    if (isDateStr(raceDate)) plan.raceDate = raceDate;
    await put('plans', plan);
    await putMany('workouts', parsed.workouts.map((w) => ({ ...w, id: newId(), planId: plan.id })));
    ctx.selectPlan(plan.id);
    ctx.dialog.close();
    showToast(t('imported', { count: parsed.workouts.length }));
  });
}

