import './activity.css';
import type { ScreenMount } from '../../app/screen';
import { mountImportPage } from './import-page';
import { mountReportPage } from './report-page';

/**
 * Analysis screen.
 * - `/activity`: import GPX files (e.g. from Strava) and list the runs.
 * - `/activity/:id`: full report of one run.
 */
export const mount: ScreenMount = (root, params) => {
  root.classList.add('act-root');
  const unmount = params.id ? mountReportPage(root, params.id) : mountImportPage(root);
  return () => {
    unmount();
    root.classList.remove('act-root');
  };
};
