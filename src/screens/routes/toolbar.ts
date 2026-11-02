import type { RouteEditor } from './route/editor';
import type { RouteState } from './route/state';

export interface ToolbarActions {
  open: () => void;
  export: () => void;
}

const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function setupToolbar(
  state: RouteState,
  editor: RouteEditor,
  actions: ToolbarActions,
  signal: AbortSignal,
): void {
  button('btn-open').addEventListener('click', actions.open);
  button('btn-export').addEventListener('click', actions.export);
  button('btn-undo').addEventListener('click', () => state.undo());
  button('btn-redo').addEventListener('click', () => state.redo());
  button('btn-reverse').addEventListener('click', () => editor.reverse());
  button('btn-loop').addEventListener('click', () => editor.closeLoop());
  button('btn-clear').addEventListener('click', () => editor.clear());

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      state.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      state.redo();
    }
  }, { signal });
}

/** Enables or disables buttons to match the current route. */
export function updateToolbar(state: RouteState, editor: RouteEditor): void {
  const n = state.waypoints.length;
  button('btn-undo').disabled = !state.canUndo;
  button('btn-redo').disabled = !state.canRedo;
  button('btn-export').disabled = n < 2;
  button('btn-reverse').disabled = n < 2;
  button('btn-loop').disabled = n < 2 || editor.isLoop();
  button('btn-clear').disabled = n === 0;
}
