import './zones.css';
import { getSettings, listActivities, onDataChange, saveSettings } from '../../data/db';
import type { AthleteSettings } from '../../data/types';
import {
  hrStarts,
  hrZonesFromLthr,
  HR_MAX,
  HR_MIN,
  paceStarts,
  paceZonesFromThreshold,
  validHrStarts,
  validPaceStarts,
  type ZoneStarts,
} from '../../data/zones';
import { formatDistance, formatDuration, formatNumber, formatPace, parsePace } from '../../format';
import { getLang, onLangChange } from '../../i18n';
import { confirmDialog } from '../../ui/confirm';
import { showToast } from '../../ui/toast';
import { estimateZones, type ZoneEstimate } from './zones-estimate';
import { t } from './zones-i18n';

/** What the form shows; saved only on "Save zones". */
interface Draft {
  maxHr: number;
  restingHr: number;
  lthr?: number;
  thresholdPace?: number;
  hr: ZoneStarts;
  pace?: ZoneStarts;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const draftOf = (s: AthleteSettings): Draft => ({
  maxHr: s.maxHr,
  restingHr: s.restingHr,
  lthr: s.lthr,
  thresholdPace: s.thresholdPace,
  hr: hrStarts(s),
  pace: paceStarts(s),
});

const paceText = (v: number | undefined) => (v === undefined ? '' : formatDuration(v));
const dateText = (ms: number) => new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);

/** "Training zones" card: edit heart-rate and pace zones, or calculate them from the runs. */
export function mountZonesSection(el: HTMLElement): () => void {
  let settings: AthleteSettings | null = null;
  let draft: Draft | null = null;
  let notes: string[] = [];
  let dirty = false;
  let busy = false;
  let job: AbortController | null = null;
  let disposed = false;

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
  const $$ = <T extends HTMLElement>(sel: string) => [...el.querySelectorAll<T>(sel)];

  function zoneRows(d: Draft): string {
    const hrIn = (b: number, side: 'lo' | 'hi', zone: number) =>
      `<input class="zn-in" type="text" inputmode="numeric" data-hr="${b}" data-side="${side}" value="${side === 'lo' ? d.hr[b] : d.hr[b] - 1}"
        aria-label="${esc(t('zoneInput', { n: zone, what: `${t('hrWord')} ${t(side === 'lo' ? 'boundLow' : 'boundHigh')}` }))}" />`;
    const paceIn = (b: number, side: 'lo' | 'hi', zone: number) =>
      `<input class="zn-in" type="text" inputmode="numeric" placeholder="m:ss" data-pace="${b}" data-side="${side}" value="${paceText(d.pace?.[b])}"
        aria-label="${esc(t('zoneInput', { n: zone, what: `${t('paceWord')} ${t(side === 'lo' ? 'boundLow' : 'boundHigh')}` }))}" />`;
    const word = (w: string) => `<span class="zn-word">${w}</span>`;
    const rows: string[] = [];
    for (let z = 0; z < 5; z++) {
      const hr =
        z === 0 ? `${word(t('upTo'))}${hrIn(0, 'hi', 1)}`
        : z === 4 ? `${word(t('fromOn'))}${hrIn(3, 'lo', 5)}`
        : `${hrIn(z - 1, 'lo', z + 1)}<span class="zn-dash">–</span>${hrIn(z, 'hi', z + 1)}`;
      const pace =
        z === 0 ? `${word(t('slowerThan'))}${paceIn(0, 'hi', 1)}`
        : z === 4 ? `${word(t('fasterThan'))}${paceIn(3, 'lo', 5)}`
        : `${paceIn(z - 1, 'lo', z + 1)}<span class="zn-dash">–</span>${paceIn(z, 'hi', z + 1)}`;
      rows.push(`
        <div class="zn-row">
          <div class="zn-name"><span class="zn-swatch zn-z${z + 1}" aria-hidden="true"></span><strong>Z${z + 1}</strong> <span class="muted">${t(`zone${z + 1}` as 'zone1')}</span></div>
          <div class="zn-range zn-hr" data-label="${esc(t('colHr'))}">${hr}</div>
          <div class="zn-range zn-pace" data-label="${esc(t('colPace'))}">${pace}</div>
        </div>`);
    }
    return rows.join('');
  }

  function render(): void {
    if (!settings || !draft) return;
    const d = draft;
    const custom = !!settings.hrZoneStarts || !!settings.paceZoneStarts;
    el.innerHTML = `
      <section class="card zn-card" id="zones">
        <h2 class="card-title">${t('title')}</h2>
        <p class="muted zn-intro">${t('intro')}</p>
        <form class="zn-form" novalidate>
          <div class="zn-block">
            <h3 class="zn-subtitle">${t('refsTitle')}</h3>
            <div class="zn-refs">
              <label class="field"><span>${t('maxHr')} <small class="muted">${t('unitBpm')}</small></span>
                <input type="text" inputmode="numeric" name="maxHr" value="${d.maxHr}" /></label>
              <label class="field"><span>${t('restingHr')} <small class="muted">${t('unitBpm')}</small></span>
                <input type="text" inputmode="numeric" name="restingHr" value="${d.restingHr}" /></label>
              <label class="field"><span>${t('lthr')} <small class="muted">${t('unitBpm')}</small></span>
                <input type="text" inputmode="numeric" name="lthr" value="${d.lthr ?? ''}" /></label>
              <label class="field"><span>${t('thresholdPace')} <small class="muted">${t('unitPace')}</small></span>
                <input type="text" inputmode="numeric" name="thresholdPace" placeholder="m:ss" value="${paceText(d.thresholdPace)}" /></label>
            </div>
            <p class="muted zn-hint">${t('refsHint')}</p>
            <div class="zn-actions">
              <button class="btn" type="button" data-zn="estimate" ${busy ? 'disabled' : ''}>${busy ? t('estimating') : t('estimate')}</button>
              <button class="btn ghost" type="button" data-zn="from-refs" ${busy ? 'disabled' : ''}>${t('fromRefs')}</button>
            </div>
            ${notes.length ? `<ul class="zn-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          </div>
          <div class="zn-block">
            <h3 class="zn-subtitle">${t('zonesTitle')}</h3>
            <div class="zn-table" role="group" aria-label="${esc(t('zonesTitle'))}">
              <div class="zn-row zn-head" aria-hidden="true"><div>${t('colZone')}</div><div>${t('colHr')}</div><div>${t('colPace')}</div></div>
              ${zoneRows(d)}
            </div>
            <p class="muted zn-hint">${t('paceHint')}</p>
            <p class="zn-status muted">${custom ? t('usingCustom') : t('usingDefault')}${dirty ? ` <strong class="zn-dirty">${t('unsaved')}</strong>` : ''}</p>
            <p class="zn-error" role="alert" hidden></p>
            <div class="zn-actions">
              <button class="btn primary" type="submit">${t('save')}</button>
              ${custom ? `<button class="btn ghost" type="button" data-zn="reset">${t('reset')}</button>` : ''}
            </div>
          </div>
        </form>
      </section>`;
  }

  const fail = (msg: string) => {
    const box = $('.zn-error');
    if (box) {
      box.textContent = msg;
      box.hidden = false;
    }
    return null;
  };

  const num = (name: string) => {
    const v = ($<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();
    return v === '' ? undefined : Number(v);
  };

  /** Reads the references; null (with the error shown) when they're invalid. */
  function readRefs(): Pick<Draft, 'maxHr' | 'restingHr' | 'lthr' | 'thresholdPace'> | null {
    const maxHr = num('maxHr');
    const restingHr = num('restingHr');
    if (!(Number.isInteger(maxHr) && Number.isInteger(restingHr) && restingHr! >= HR_MIN && maxHr! <= HR_MAX && restingHr! <= maxHr! - 20)) {
      return fail(t('errRefs'));
    }
    const lthr = num('lthr');
    if (lthr !== undefined && !(Number.isInteger(lthr) && lthr >= HR_MIN && lthr <= HR_MAX)) return fail(t('errLthr'));
    const paceRaw = ($<HTMLInputElement>('[name="thresholdPace"]')?.value ?? '').trim();
    const thresholdPace = paceRaw ? parsePace(paceRaw) ?? NaN : undefined;
    if (thresholdPace !== undefined && !(thresholdPace >= 120 && thresholdPace <= 1200)) return fail(t('errThresholdPace'));
    return { maxHr: maxHr!, restingHr: restingHr!, lthr, thresholdPace };
  }

  /** Reads the whole form; null (with the error shown) when something is invalid. */
  function readDraft(): Draft | null {
    const refs = readRefs();
    if (!refs) return null;
    const hr = $$<HTMLInputElement>('[data-hr][data-side="lo"]')
      .sort((a, b) => Number(a.dataset.hr) - Number(b.dataset.hr))
      .map((i) => (i.value.trim() === '' ? NaN : Number(i.value)));
    if (!validHrStarts(hr)) return fail(t('errHr'));
    const paceRaw = $$<HTMLInputElement>('[data-pace][data-side="lo"]')
      .sort((a, b) => Number(a.dataset.pace) - Number(b.dataset.pace))
      .map((i) => i.value.trim());
    let pace: ZoneStarts | undefined;
    if (paceRaw.some(Boolean)) {
      if (!paceRaw.every(Boolean)) return fail(t('errPacePartial'));
      const values = paceRaw.map((v) => parsePace(v) ?? NaN);
      if (!validPaceStarts(values)) return fail(t('errPace'));
      pace = values as ZoneStarts;
    }
    return { ...refs, hr: hr as ZoneStarts, pace };
  }

  /** Keeps both sides of a boundary in step: Z2 "to 166" ⇄ Z3 "from 167"; pace edges are shared. */
  function syncPartner(input: HTMLInputElement): void {
    const isHr = input.dataset.hr !== undefined;
    const b = isHr ? input.dataset.hr : input.dataset.pace;
    const other = $<HTMLInputElement>(
      `[data-${isHr ? 'hr' : 'pace'}="${b}"][data-side="${input.dataset.side === 'lo' ? 'hi' : 'lo'}"]`,
    );
    if (!other) return;
    if (!isHr) {
      other.value = input.value;
      return;
    }
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isInteger(v)) other.value = String(input.dataset.side === 'lo' ? v - 1 : v + 1);
  }

  function markDirty(): void {
    if (dirty) return;
    dirty = true;
    const status = $('.zn-status');
    if (status && !status.querySelector('.zn-dirty')) status.insertAdjacentHTML('beforeend', ` <strong class="zn-dirty">${t('unsaved')}</strong>`);
  }

  function estimateNotes(e: ZoneEstimate): string[] {
    const out: string[] = [];
    out.push(
      e.maxHr
        ? t('estMaxHr', { bpm: e.maxHr.value, date: dateText(e.maxHr.activity.startTime), name: e.maxHr.activity.name })
        : t('estNoMaxHr'),
    );
    if (e.lthr) {
      out.push(
        e.lthr.activity
          ? t('estLthr', { bpm: e.lthr.value, date: dateText(e.lthr.activity.startTime), name: e.lthr.activity.name })
          : t('estLthrFallback', { bpm: e.lthr.value }),
      );
    }
    if (e.thresholdPace) {
      const ef = e.thresholdPace.effort;
      out.push(
        t('estPace', {
          pace: formatPace(e.thresholdPace.value),
          vdot: formatNumber(e.thresholdPace.vdot, 1),
          distance: formatDistance(ef.distance),
          time: formatDuration(ef.time),
          date: dateText(ef.activity.startTime),
        }),
      );
    } else {
      out.push(t('estNoPace'));
    }
    out.push(t('estCheck'));
    return out;
  }

  async function runEstimate(): Promise<void> {
    const current = readDraft() ?? draft!;
    busy = true;
    draft = current;
    render();
    job?.abort();
    job = new AbortController();
    try {
      const est = await estimateZones(await listActivities(), Date.now(), job.signal);
      if (disposed || job.signal.aborted) return;
      draft = {
        ...current,
        maxHr: est.maxHr?.value ?? current.maxHr,
        lthr: est.lthr?.value ?? current.lthr,
        thresholdPace: est.thresholdPace?.value ?? current.thresholdPace,
        hr: est.hrZoneStarts ?? current.hr,
        pace: est.paceZoneStarts ?? current.pace,
      };
      if (draft.restingHr > draft.maxHr - 20) draft.restingHr = Math.max(HR_MIN, draft.maxHr - 20);
      notes = estimateNotes(est);
      dirty = true;
    } catch (err) {
      console.error(err);
      showToast(t('estFailed'), 'error');
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }

  function fromRefs(): void {
    const refs = readRefs();
    if (!refs) return;
    if (refs.lthr === undefined && refs.thresholdPace === undefined) {
      fail(t('errNeedRef'));
      return;
    }
    const current = readDraft();
    const base = current ?? draft!;
    draft = {
      ...base,
      ...refs,
      hr: refs.lthr !== undefined ? hrZonesFromLthr(refs.lthr) : base.hr,
      pace: refs.thresholdPace !== undefined ? paceZonesFromThreshold(refs.thresholdPace) : base.pace,
    };
    notes = [];
    dirty = true;
    render();
  }

  async function save(): Promise<void> {
    const d = readDraft();
    if (!d || !settings) return;
    const next: AthleteSettings = { ...settings, maxHr: d.maxHr, restingHr: d.restingHr, hrZoneStarts: d.hr };
    delete next.lthr;
    delete next.thresholdPace;
    delete next.paceZoneStarts;
    if (d.lthr !== undefined) next.lthr = d.lthr;
    if (d.thresholdPace !== undefined) next.thresholdPace = d.thresholdPace;
    if (d.pace) next.paceZoneStarts = d.pace;
    dirty = false;
    notes = [];
    settings = next;
    draft = draftOf(next);
    await saveSettings(next);
    render();
    showToast(t('saved'));
  }

  async function reset(): Promise<void> {
    if (!settings) return;
    const ok = await confirmDialog({ title: t('reset'), message: t('usingDefault'), confirmLabel: t('reset') });
    if (!ok) return;
    const next: AthleteSettings = { ...settings };
    delete next.hrZoneStarts;
    delete next.paceZoneStarts;
    dirty = false;
    notes = [];
    settings = next;
    draft = draftOf(next);
    await saveSettings(next);
    render();
    showToast(t('resetDone'));
  }

  const run = (p: Promise<void>) =>
    p.catch((err) => {
      console.error(err);
      showToast(String(err), 'error');
    });

  const onInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('input')) return;
    if (input.dataset.side) syncPartner(input);
    $('.zn-error')?.setAttribute('hidden', '');
    markDirty();
  };
  const onClick = (e: Event) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-zn]')?.dataset.zn;
    if (action === 'estimate') void run(runEstimate());
    else if (action === 'from-refs') fromRefs();
    else if (action === 'reset') void run(reset());
  };
  const onSubmit = (e: Event) => {
    e.preventDefault();
    void run(save());
  };
  el.addEventListener('input', onInput);
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);

  async function load(): Promise<void> {
    const s = await getSettings();
    if (disposed) return;
    settings = s;
    if (!dirty) draft = draftOf(s);
    render();
  }
  void run(load());

  const offData = onDataChange((store) => {
    if (store === 'settings' && !dirty && !busy) void run(load());
  });
  const offLang = onLangChange(() => {
    if (dirty) draft = readDraft() ?? draft;
    render();
  });

  return () => {
    disposed = true;
    job?.abort();
    el.removeEventListener('input', onInput);
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
    offData();
    offLang();
  };
}
