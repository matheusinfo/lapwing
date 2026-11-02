let hideTimer: number | undefined;

/** Shows a short message at the bottom of the screen. */
export function showToast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('visible');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el.classList.remove('visible'), 4000);
}
