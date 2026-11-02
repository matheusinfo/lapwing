/**
 * Every screen module exports `mount`. The router calls it with an empty
 * element to fill and the URL parameters, and calls the returned function
 * (if any) when the user leaves the screen. Clean up everything there:
 * maps (`map.remove()`), charts (`chart.destroy()`), listeners on window or
 * document, timers, and `onLangChange` / `onDataChange` subscriptions.
 */
export type ScreenMount = (root: HTMLElement, params: Record<string, string>) => void | (() => void);
