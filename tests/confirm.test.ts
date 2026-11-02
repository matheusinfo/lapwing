// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { confirmDialog, dismissConfirms } from '../src/ui/confirm';

afterEach(() => document.body.replaceChildren());

const modal = () => document.querySelector<HTMLDialogElement>('.confirm-modal');

describe('confirmDialog', () => {
  it('renders the shared modal pattern and resolves true on confirm', async () => {
    const answer = confirmDialog({ title: 'Delete run', message: 'Delete “<b>x</b>”?', confirmLabel: 'Delete', tone: 'danger' });
    const d = modal()!;
    expect(d.classList.contains('modal')).toBe(true);
    expect(d.classList.contains('is-danger')).toBe(true);
    expect(d.getAttribute('role')).toBe('alertdialog');
    expect(d.querySelector('.modal-title')!.textContent).toBe('Delete run');
    // User text is not parsed as HTML.
    expect(d.querySelector('.modal-message b')).toBeNull();
    expect(d.querySelector('.modal-message')!.textContent).toBe('Delete “<b>x</b>”?');
    const [cancel, ok] = d.querySelectorAll<HTMLButtonElement>('.modal-actions .btn');
    expect(cancel.textContent).toBe('Cancel');
    expect(ok.classList.contains('danger-solid')).toBe(true);
    expect(document.activeElement).toBe(cancel);
    ok.click();
    await expect(answer).resolves.toBe(true);
    expect(modal()).toBeNull();
  });

  it('uses the primary button for non-destructive actions and resolves false on cancel', async () => {
    const answer = confirmDialog({ title: 'Replace steps', message: 'Sure?', confirmLabel: 'Replace' });
    const d = modal()!;
    expect(d.classList.contains('is-danger')).toBe(false);
    expect(d.querySelector('[data-answer="ok"]')!.classList.contains('primary')).toBe(true);
    d.querySelector<HTMLButtonElement>('[data-answer="cancel"]')!.click();
    await expect(answer).resolves.toBe(false);
  });

  it('cancels on Esc, on a backdrop click, and when the screen changes', async () => {
    const esc = confirmDialog({ title: 'a', message: 'b', confirmLabel: 'c' });
    modal()!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(esc).resolves.toBe(false);

    const backdrop = confirmDialog({ title: 'a', message: 'b', confirmLabel: 'c' });
    modal()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(backdrop).resolves.toBe(false);

    const leaving = confirmDialog({ title: 'a', message: 'b', confirmLabel: 'c' });
    dismissConfirms();
    await expect(leaving).resolves.toBe(false);
    expect(modal()).toBeNull();
  });
});
