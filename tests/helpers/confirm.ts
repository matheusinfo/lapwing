import { vi } from 'vitest';

/**
 * Waits for the app's confirmation dialog (src/ui/confirm.ts), answers it,
 * and returns what it showed.
 */
export async function answerConfirm(answer: boolean): Promise<{ title: string; message: string; dialog: HTMLElement }> {
  const dialog = await vi.waitFor(() => {
    const d = document.querySelector<HTMLElement>('.confirm-modal');
    if (!d) throw new Error('No confirmation dialog open');
    return d;
  });
  const shown = {
    title: dialog.querySelector('.modal-title')!.textContent ?? '',
    message: dialog.querySelector('.modal-message')!.textContent ?? '',
    dialog,
  };
  dialog.querySelector<HTMLButtonElement>(`[data-answer="${answer ? 'ok' : 'cancel'}"]`)!.click();
  return shown;
}
