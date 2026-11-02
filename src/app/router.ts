import type { ScreenMount } from './screen';
import type { MessageKey } from '../i18n';

export interface RouteDef {
  /** Path pattern; `:name` captures one segment, e.g. `/activity/:id`. */
  path: string;
  /** Menu entry this route highlights. */
  nav: NavId;
  load: () => Promise<{ mount: ScreenMount }>;
}

/**
 * The shoes screen (`src/screens/gear/`, nav id `gear`) is disabled: its code
 * and the `shoes` store are kept, but it has no route or menu entry.
 */
export type NavId = 'routes' | 'activity' | 'training' | 'history' | 'insights' | 'settings';

export const NAV_ITEMS: { id: NavId; path: string; label: MessageKey; icon: string }[] = [
  {
    id: 'routes',
    path: '/routes',
    label: 'navRoutes',
    icon: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  },
  {
    id: 'activity',
    path: '/activity',
    label: 'navActivity',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  },
  {
    id: 'training',
    path: '/training',
    label: 'navTraining',
    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  },
  {
    id: 'history',
    path: '/history',
    label: 'navHistory',
    icon: '<path d="M3 3v18h18"/><path d="M7 16v-3M11 16V9M15 16v-5M19 16V7"/>',
  },
  {
    id: 'insights',
    path: '/insights',
    label: 'navInsights',
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'navSettings',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  },
];

export const ROUTES: RouteDef[] = [
  { path: '/routes', nav: 'routes', load: () => import('../screens/routes') },
  { path: '/activity', nav: 'activity', load: () => import('../screens/activity') },
  { path: '/activity/:id', nav: 'activity', load: () => import('../screens/activity') },
  { path: '/training', nav: 'training', load: () => import('../screens/training') },
  { path: '/history', nav: 'history', load: () => import('../screens/history') },
  { path: '/compare', nav: 'history', load: () => import('../screens/compare') },
  { path: '/compare/:a', nav: 'history', load: () => import('../screens/compare') },
  { path: '/compare/:a/:b', nav: 'history', load: () => import('../screens/compare') },
  { path: '/insights', nav: 'insights', load: () => import('../screens/insights') },
  { path: '/settings', nav: 'settings', load: () => import('../screens/settings') },
];

export const DEFAULT_PATH = '/routes';

/** Goes to an app path, e.g. `navigate('/activity/' + id)`. */
export function navigate(path: string): void {
  location.hash = '#' + path;
}

/** The current app path from the URL hash, without query string. */
export function currentPath(): string {
  return location.hash.replace(/^#/, '').split('?')[0] || DEFAULT_PATH;
}

/** Query parameters after `?` in the hash, e.g. `#/history?week=2026-10-27`. */
export function currentQuery(): URLSearchParams {
  return new URLSearchParams(location.hash.split('?')[1] ?? '');
}

export function matchRoute(path: string): { route: RouteDef; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok) return { route, params };
  }
  return null;
}
