/**
 * The app's confirmation dialog, used instead of `window.confirm()` so every
 * confirmation looks the same: a `.modal` panel with a title, a message, and
 * Cancel + action buttons. Destructive actions (`tone: 'danger'`) get a solid
 * red button; others use the primary (accent) button. Cancel has the focus,
 * and Esc or a click on the backdrop cancels.
 *
 *   if (!(await confirmDialog({ title, message, confirmLabel: t('dlgDelete'), tone: 'danger' }))) return;
 */
import { t } from '../i18n';

export interface ConfirmOptions {
  title: string;
  /** Plain text (set with textContent, so user names are safe). Line breaks are kept. */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for actions that delete or replace data. Default `primary`. */
  tone?: 'danger' | 'primary';
}

/** Open dialogs and the function that answers each one. */
const open = new Map<HTMLDialogElement, (answer: boolean) => void>();
let seq = 0;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const id = `confirm-${++seq}`;
  const dialog = document.createElement('dialog');
  dialog.className = `modal confirm-modal${opts.tone === 'danger' ? ' is-danger' : ''}`;
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-msg`);
  dialog.innerHTML = `
    <form class="modal-body" method="dialog">
      <h2 class="modal-title" id="${id}-title"></h2>
      <p class="modal-message" id="${id}-msg"></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-answer="cancel"></button>
        <button type="button" class="btn ${opts.tone === 'danger' ? 'danger-solid' : 'primary'}" data-answer="ok"></button>
      </div>
    </form>`;
  dialog.querySelector('.modal-title')!.textContent = opts.title;
  dialog.querySelector('.modal-message')!.textContent = opts.message;
  const cancelBtn = dialog.querySelector<HTMLButtonElement>('[data-answer="cancel"]')!;
  const okBtn = dialog.querySelector<HTMLButtonElement>('[data-answer="ok"]')!;
  cancelBtn.textContent = opts.cancelLabel ?? t('dlgCancel');
  okBtn.textContent = opts.confirmLabel;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      open.delete(dialog);
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      dialog.remove();
      resolve(answer);
    };
    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    // Esc.
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });
    document.body.append(dialog);
    open.set(dialog, finish);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    cancelBtn.focus();
  });
}

/** Cancels every open confirmation (e.g. when the user leaves the screen). */
export function dismissConfirms(): void {
  for (const finish of [...open.values()]) finish(false);
}
