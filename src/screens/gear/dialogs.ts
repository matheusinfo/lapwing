/** Modal forms of the gear screen, sharing one <dialog>. */
import { newId } from '../../data/db';
import {
  assignCandidates,
  assignShoe,
  DEFAULT_RETIRE_DISTANCE,
  localDay,
  saveShoe,
} from '../../data/shoes';
import type { Activity, Shoe } from '../../data/types';
import { formatDistance } from '../../format';
import { showToast } from '../../ui/toast';
import { t } from './i18n';

const HTML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' };

/** Escapes user text (shoe names, notes) for use inside HTML. */
export const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => HTML_ESCAPES[c]);

export const shoeLabel = (s: Shoe) => [s.brand, s.model].filter(Boolean).join(' ');

function open(dialog: HTMLDialogElement, html: string): HTMLFormElement {
  dialog.innerHTML = `<form class="gear-form" novalidate>${html}</form>`;
  const form = dialog.querySelector('form')!;
  form.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => close(dialog)));
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  form.querySelector<HTMLElement>('input, select, textarea')?.focus();
  return form;
}

export function close(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function showError(form: HTMLFormElement, message: string | null): void {
  const el = form.querySelector<HTMLElement>('.gear-form-error')!;
  el.textContent = message ?? '';
  el.hidden = !message;
}

const value = (form: HTMLFormElement, name: string) =>
  (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value.trim() ?? '';
const checked = (form: HTMLFormElement, name: string) =>
  (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;

/** Kilometre input text → metres (accepts a decimal comma); null when invalid. */
function kmInput(text: string): number | null {
  if (text === '') return 0;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}
const kmValue = (m: number) => String(Math.round(m / 100) / 10);

const footer = (submit: string) => `
  <p class="gear-form-error" role="alert" hidden></p>
  <div class="gear-form-actions">
    <button class="btn" type="button" data-close>${t('cancel')}</button>
    <button class="btn primary" type="submit">${submit}</button>
  </div>`;

/** Add or edit a shoe. `isFirst` pre-checks "default" for the first shoe. */
export function openShoeDialog(dialog: HTMLDialogElement, shoe?: Shoe, isFirst = false): void {
  const isDefault = shoe ? !!shoe.isDefault : isFirst;
  const form = open(
    dialog,
    `
    <h2>${shoe ? t('editShoe') : t('newShoe')}</h2>
    <div class="gear-form-grid">
      <label class="field gear-span2"><span>${t('fName')}</span>
        <input type="text" name="name" maxlength="80" required placeholder="${esc(t('fNamePh'))}" value="${esc(shoe?.name ?? '')}" /></label>
      <label class="field"><span>${t('fBrand')}</span>
        <input type="text" name="brand" maxlength="60" value="${esc(shoe?.brand ?? '')}" /></label>
      <label class="field"><span>${t('fModel')}</span>
        <input type="text" name="model" maxlength="60" value="${esc(shoe?.model ?? '')}" /></label>
      <label class="field"><span>${t('fStart')}</span>
        <input type="text" inputmode="decimal" name="start" placeholder="0" value="${shoe?.startDistance ? kmValue(shoe.startDistance) : ''}" />
        <small class="muted">${t('fStartHint')}</small></label>
      <label class="field"><span>${t('fRetire')}</span>
        <input type="text" inputmode="decimal" name="retire" value="${kmValue(shoe?.retireDistance ?? DEFAULT_RETIRE_DISTANCE)}" />
        <small class="muted">${t('fRetireHint')}</small></label>
      <label class="field gear-span2"><span>${t('fNotes')}</span>
        <textarea name="notes" rows="2" maxlength="500">${esc(shoe?.notes ?? '')}</textarea></label>
      ${
        shoe?.retiredAt
          ? ''
          : `<label class="gear-check gear-span2"><input type="checkbox" name="isDefault" ${isDefault ? 'checked' : ''} /> ${t('fDefault')}</label>`
      }
    </div>
    ${footer(t('save'))}`,
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = value(form, 'name');
    if (!name) return showError(form, t('errName'));
    const startDistance = kmInput(value(form, 'start'));
    const retireDistance = kmInput(value(form, 'retire'));
    if (startDistance === null || retireDistance === null || retireDistance <= 0) return showError(form, t('errDistance'));
    const next: Shoe = {
      id: shoe?.id ?? newId(),
      name,
      startDistance,
      retireDistance,
      createdAt: shoe?.createdAt ?? Date.now(),
    };
    const brand = value(form, 'brand');
    const model = value(form, 'model');
    const notes = value(form, 'notes');
    if (brand) next.brand = brand;
    if (model) next.model = model;
    if (notes) next.notes = notes;
    if (shoe?.retiredAt) next.retiredAt = shoe.retiredAt;
    else if (checked(form, 'isDefault')) next.isDefault = true;
    void saveShoe(next).then(() => {
      close(dialog);
      showToast(t('saved'));
    });
  });
}

/** Bulk-assign a shoe to past runs in a date range, with a live count preview. */
export function openAssignDialog(
  dialog: HTMLDialogElement,
  shoes: Shoe[],
  activities: Activity[],
  preselect?: string,
): void {
  if (!shoes.length) {
    showToast(t('noActiveShoes'), 'warn');
    return;
  }
  const options = shoes
    .map((s) => `<option value="${esc(s.id)}" ${s.id === preselect ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');
  const form = open(
    dialog,
    `
    <h2>${t('assignTitle')}</h2>
    <p class="muted gear-form-intro">${t('assignIntro')}</p>
    <div class="gear-form-grid">
      <label class="field gear-span2"><span>${t('fShoe')}</span><select name="shoe">${options}</select></label>
      <label class="field"><span>${t('fFrom')}</span><input type="date" name="from" /></label>
      <label class="field"><span>${t('fTo')}</span><input type="date" name="to" value="${localDay(Date.now())}" /></label>
      <label class="gear-check gear-span2"><input type="checkbox" name="onlyUnassigned" checked /> ${t('fOnlyUnassigned')}</label>
    </div>
    <p class="gear-preview" aria-live="polite"></p>
    ${footer(t('assign'))}`,
  );

  const candidates = () =>
    assignCandidates(activities, {
      shoeId: value(form, 'shoe'),
      from: value(form, 'from'),
      to: value(form, 'to'),
      onlyUnassigned: checked(form, 'onlyUnassigned'),
    });
  const preview = form.querySelector<HTMLElement>('.gear-preview')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const update = () => {
    const list = candidates();
    const km = list.reduce((sum, a) => sum + a.summary.distance, 0);
    preview.textContent = list.length ? t('assignPreview', { count: list.length, km: formatDistance(km) }) : t('assignNone');
    submit.disabled = !list.length;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const list = candidates();
    if (!list.length) return;
    void assignShoe(list, value(form, 'shoe')).then((count) => {
      close(dialog);
      showToast(t('assignedToast', { count }));
    });
  });
}
