import './gear.css';
import type { ScreenMount } from '../../app/screen';
import { listActivities, onDataChange } from '../../data/db';
import {
  deleteShoe,
  isRunType,
  listShoes,
  retireShoe,
  setDefaultShoe,
  shoeStats,
  unretireShoe,
  type ShoeStats,
  type ShoeStatus,
} from '../../data/shoes';
import type { Activity, Shoe } from '../../data/types';
import { formatDate, formatDuration, formatNumber, formatPace } from '../../format';
import { getLang, onLangChange, t as tg } from '../../i18n';
import { showToast } from '../../ui/toast';
import { close, esc, openAssignDialog, openShoeDialog, shoeLabel } from './dialogs';
import { t, type GearKey } from './i18n';
import { confirmDialog } from '../../ui/confirm';

const STATUS: Record<ShoeStatus, { key: GearKey; badge: string }> = {
  ok: { key: 'statusOk', badge: 'good' },
  worn: { key: 'statusWorn', badge: 'warn' },
  replace: { key: 'statusReplace', badge: 'bad' },
  retired: { key: 'statusRetired', badge: '' },
};

const MONTHS = 6;

/** Distance (m) per calendar month for the last `MONTHS` months, oldest first. */
export function monthlyDistance(shoeId: string, activities: Activity[], now = Date.now()): { month: number; distance: number }[] {
  const end = new Date(now);
  const buckets = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth() - (MONTHS - 1 - i), 1);
    return { month: d.getTime(), distance: 0 };
  });
  for (const a of activities) {
    if (a.shoeId !== shoeId) continue;
    const d = new Date(a.startTime);
    const idx = (d.getFullYear() - end.getFullYear()) * 12 + d.getMonth() - end.getMonth() + MONTHS - 1;
    if (idx >= 0 && idx < MONTHS) buckets[idx].distance += a.summary.distance;
  }
  return buckets;
}

const km = (m: number) => `${formatNumber(m / 1000, m < 100_000 ? 1 : 0)} km`;

/** Shoes: register pairs, follow mileage and wear, retire them. */
export const mount: ScreenMount = (root) => {
  root.classList.add('gear-root');
  root.innerHTML = `<div class="page gear-page"><p class="screen-message">${t('loading')}</p></div><dialog class="gear-dialog"></dialog>`;
  const page = root.querySelector<HTMLElement>('.gear-page')!;
  const dialog = root.querySelector<HTMLDialogElement>('.gear-dialog')!;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(dialog); // Click on the backdrop.
  });

  let disposed = false;
  let loadId = 0;
  let loaded = false;
  let shoes: Shoe[] = [];
  let activities: Activity[] = [];

  const byId = (id: string | undefined) => shoes.find((s) => s.id === id);
  const sortedShoes = () => {
    const active = shoes.filter((s) => !s.retiredAt).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || b.createdAt - a.createdAt);
    const retired = shoes.filter((s) => s.retiredAt).sort((a, b) => b.retiredAt! - a.retiredAt!);
    return { active, retired };
  };

  function chartHtml(shoe: Shoe): string {
    const months = monthlyDistance(shoe.id, activities);
    if (!months.some((m) => m.distance > 0)) return '';
    const max = Math.max(...months.map((m) => m.distance));
    const fmt = new Intl.DateTimeFormat(getLang(), { month: 'short' });
    return `<div class="gear-chart" role="img" aria-label="${esc(months.map((m) => `${fmt.format(m.month)} ${km(m.distance)}`).join(', '))}">
      ${months
        .map(
          (m) => `<div class="gear-chart-col" title="${esc(`${fmt.format(m.month)} · ${km(m.distance)}`)}">
            <span class="gear-chart-bar" style="height:${max ? Math.max(m.distance ? 4 : 0, (m.distance / max) * 100) : 0}%"></span>
            <span class="gear-chart-label">${esc(fmt.format(m.month))}</span></div>`,
        )
        .join('')}
    </div>`;
  }

  function cardHtml(shoe: Shoe, st: ShoeStats): string {
    const status = STATUS[st.status];
    const pct = Math.round(st.wear * 100);
    const sub = shoeLabel(shoe);
    let projection: string;
    if (shoe.retiredAt) projection = esc(t('retiredOn', { date: formatDate(shoe.retiredAt) }));
    else if (st.status === 'replace' || st.wear >= 1) projection = t('pastLimit');
    else projection = st.projectedRetireAt ? formatDate(st.projectedRetireAt) : t('projectedNone');
    const facts = [
      [t('runs'), formatNumber(st.runs)],
      [t('lastUsed'), st.lastUsed ? formatDate(st.lastUsed) : t('never')],
      [t('avgPace'), formatPace(st.avgPace)],
      [t('movingTime'), st.movingTime ? formatDuration(st.movingTime) : '—'],
      [shoe.retiredAt ? t('statusRetired') : t('projected'), projection],
    ];
    return `
      <article class="card gear-card gear-${st.status}" data-id="${esc(shoe.id)}">
        <div class="gear-card-head">
          <div class="gear-card-title">
            <h2>${esc(shoe.name)}</h2>
            ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
          </div>
          <div class="gear-badges">
            ${shoe.isDefault ? `<span class="badge gear-default">${t('defaultBadge')}</span>` : ''}
            <span class="badge ${status.badge}">${t(status.key)}</span>
          </div>
        </div>
        <div class="gear-wear">
          <p><strong>${esc(t('usedOf', { used: km(st.distance), total: km(shoe.retireDistance) }))}</strong>
            <span class="muted">${esc(t('wearPct', { pct }))}</span></p>
          <div class="gear-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}">
            <span style="width:${Math.min(100, Math.max(0, pct))}%"></span>
          </div>
          ${shoe.startDistance > 0 ? `<p class="muted gear-small">${esc(t('includesStart', { km: km(shoe.startDistance) }))}</p>` : ''}
        </div>
        <dl class="gear-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        ${chartHtml(shoe)}
        ${shoe.notes ? `<p class="gear-notes">${esc(shoe.notes)}</p>` : ''}
        <div class="gear-actions">
          <button class="btn small" type="button" data-action="edit">${t('edit')}</button>
          ${
            shoe.retiredAt
              ? `<button class="btn small" type="button" data-action="unretire">${t('unretire')}</button>`
              : `${
                  shoe.isDefault
                    ? `<button class="btn small" type="button" data-action="unset-default">${t('unsetDefault')}</button>`
                    : `<button class="btn small" type="button" data-action="default">${t('makeDefault')}</button>`
                }
                <button class="btn small" type="button" data-action="assign">${t('assignTool')}</button>
                <button class="btn small" type="button" data-action="retire">${t('retire')}</button>`
          }
          <button class="btn small ghost danger" type="button" data-action="delete">${t('delete')}</button>
        </div>
      </article>`;
  }

  function render() {
    if (!loaded) return;
    const header = `
      <header class="page-header gear-header">
        <h1>${t('title')}</h1>
        ${shoes.length ? `<button class="btn" type="button" data-action="assign-all">${t('assignTool')}</button>` : ''}
        <button class="btn primary" type="button" data-action="add">${t('addShoe')}</button>
      </header>
      <p class="muted gear-intro">${t('intro')}</p>`;
    if (!shoes.length) {
      page.innerHTML = `${header}
        <div class="card empty-state gear-empty"><h2>${t('emptyTitle')}</h2><p>${t('emptyText')}</p>
          <p><button class="btn primary" type="button" data-action="add">${t('addShoe')}</button></p></div>`;
      return;
    }
    const { active, retired } = sortedShoes();
    const unassigned = activities.filter((a) => isRunType(a.type) && !a.shoeId).length;
    const cards = (list: Shoe[]) => list.map((s) => cardHtml(s, shoeStats(s, activities))).join('');
    page.innerHTML = `${header}
      ${
        unassigned && active.length
          ? `<p class="card gear-hint">${esc(t('unassignedHint', { count: unassigned }))}
              <button class="btn small" type="button" data-action="assign-all">${t('unassignedAction')}</button></p>`
          : ''
      }
      ${active.length ? `<div class="gear-grid">${cards(active)}</div>` : ''}
      ${
        retired.length
          ? `<details class="gear-retired"${active.length ? '' : ' open'}>
              <summary>${esc(t('retiredSection', { count: retired.length }))}</summary>
              <div class="gear-grid">${cards(retired)}</div>
            </details>`
          : ''
      }`;
  }

  const assignableShoes = () => {
    const { active, retired } = sortedShoes();
    return [...active, ...retired];
  };

  async function onAction(action: string, shoe: Shoe | undefined) {
    switch (action) {
      case 'add':
        openShoeDialog(dialog, undefined, !shoes.some((s) => s.isDefault && !s.retiredAt));
        break;
      case 'assign-all':
        openAssignDialog(dialog, assignableShoes(), activities, sortedShoes().active[0]?.id);
        break;
    }
    if (!shoe) return;
    switch (action) {
      case 'edit':
        openShoeDialog(dialog, shoe);
        break;
      case 'assign':
        openAssignDialog(dialog, assignableShoes(), activities, shoe.id);
        break;
      case 'default':
        await setDefaultShoe(shoe.id);
        showToast(t('defaultToast', { name: shoe.name }));
        break;
      case 'unset-default':
        await setDefaultShoe(null);
        showToast(t('saved'));
        break;
      case 'retire':
        await retireShoe(shoe.id);
        showToast(t('retiredToast'));
        break;
      case 'unretire':
        await unretireShoe(shoe.id);
        showToast(t('saved'));
        break;
      case 'delete': {
        const count = activities.filter((a) => a.shoeId === shoe.id).length;
        const msg = count ? t('confirmDelete', { name: shoe.name, count }) : t('confirmDeleteNoRuns', { name: shoe.name });
        const ok = await confirmDialog({
          title: tg('dlgDeleteShoe'),
          message: msg,
          confirmLabel: tg('dlgDelete'),
          tone: 'danger',
        });
        if (!ok) return;
        await deleteShoe(shoe.id);
        showToast(t('deleted'));
        break;
      }
    }
  }

  page.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-id]')?.dataset.id;
    void onAction(btn.dataset.action!, byId(id));
  });

  async function load() {
    const id = ++loadId;
    const [s, a] = await Promise.all([listShoes(), listActivities()]);
    if (disposed || id !== loadId) return;
    shoes = s;
    activities = a;
    loaded = true;
    render();
  }

  const offData = onDataChange((store) => {
    if (store === 'shoes' || store === 'activities') void load();
  });
  const offLang = onLangChange(render);
  void load();

  return () => {
    disposed = true;
    offData();
    offLang();
    close(dialog);
    root.classList.remove('gear-root');
  };
};
