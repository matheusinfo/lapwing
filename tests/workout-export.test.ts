// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import {
  effectiveSteps,
  exportIcs,
  exportPlanIcs,
  exportTcx,
  exportWorkoutFit,
  fileSlug,
  foldLine,
  icsEscape,
  selectWorkouts,
  tcxName,
} from '../src/screens/training/export';
import { encodeWorkoutFit, fitCrc, FIT_EPOCH_MS, fitStepCount } from '../src/screens/training/fit';
import { createStepsEditor } from '../src/screens/training/steps-editor';
import { distance, repeatStep, simpleStep, time } from '../src/screens/training/structure';
import type { PlannedWorkout, WorkoutStep } from '../src/screens/training/types';
import { answerConfirm } from './helpers/confirm';

beforeAll(() => setLang('en'));

const intervals = (): WorkoutStep[] => [
  simpleStep('warmup', time(600)),
  repeatStep(8, [simpleStep('active', distance(400), { type: 'pace', min: 240, max: 250 }), simpleStep('recovery', distance(200))]),
  simpleStep('cooldown', time(600)),
];
const wo = (id: string, date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({ id, planId: 'p', date, kind: 'easy', title: '', ...extra });

const plan = [
  wo('w1', '2026-11-03', { kind: 'intervals', title: 'Track 8×400, fast; "go"', distance: 7500, steps: intervals(), description: 'Line 1\nLine 2 \\ end' }),
  wo('w2', '2026-11-04', { kind: 'rest' }),
  wo('w3', '2026-11-05', { title: 'Corrida leve com acentuação çãõ é longa demais para uma linha só de calendário', distance: 6000, pace: 375 }),
  wo('w4', '2026-11-06', { kind: 'cross', title: 'Strength', duration: 2700 }),
  wo('w5', '2026-11-08', { kind: 'long', title: 'Long run 14 km', distance: 14000 }),
];

describe('files', () => {
  it('makes safe file names', () => {
    expect(fileSlug('Meu Plano: Maratona de São Paulo!')).toBe('meu-plano-maratona-de-sao-paulo');
    expect(fileSlug('***')).toBe('plan');
  });

  it('selects workouts', () => {
    expect(selectWorkouts(plan).map((w) => w.id)).toEqual(['w1', 'w3', 'w4', 'w5']);
    expect(selectWorkouts(plan, { includeRest: true, from: '2026-11-04' }).map((w) => w.id)).toEqual(['w2', 'w3', 'w4', 'w5']);
    expect(selectWorkouts(plan, { runningOnly: true }).map((w) => w.id)).toEqual(['w1', 'w3', 'w5']);
  });

  it('turns simple workouts into one watch step', () => {
    expect(effectiveSteps({ distance: 6000, pace: 375 })).toMatchObject([{ kind: 'active', duration: { type: 'distance', meters: 6000 }, target: { type: 'pace', min: 365, max: 385 } }]);
    expect(effectiveSteps({ duration: 1800 })).toMatchObject([{ duration: { type: 'time', seconds: 1800 } }]);
    expect(effectiveSteps({})).toMatchObject([{ duration: { type: 'open' } }]);
  });
});

describe('iCalendar', () => {
  it('escapes text values', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(foldLine('SHORT:x')).toBe('SHORT:x');
  });

  it('writes one all-day event per workout', () => {
    const ics = exportPlanIcs({ name: 'My plan, 10K' }, selectWorkouts(plan, { includeRest: true }), { now: Date.UTC(2026, 10, 1, 12, 30, 5) });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = ics.split('\r\n');
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    // Unfold to check content.
    const text = ics.replace(/\r\n /g, '');
    expect(text).toContain('X-WR-CALNAME:My plan\\, 10K');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(5);
    expect(text).toContain('UID:w1@lapwing');
    expect(text).toContain('DTSTAMP:20261101T123005Z');
    expect(text).toContain('DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104');
    expect(text).toContain('SUMMARY:Track 8×400\\, fast\\; "go"');
    expect(text).toContain('DESCRIPTION:Target: 7.5 km\\nStructure: 10 min WU · 8×(400 m @ 4:00–4:10 /km\\, 200 m jog) · 10 min CD\\nLine 1\\nLine 2 \\\\ end');
    expect(text).toContain('SUMMARY:Rest day');
    // Stable output for the same input and time.
    expect(exportIcs('My plan, 10K', selectWorkouts(plan, { includeRest: true }), { now: Date.UTC(2026, 10, 1, 12, 30, 5) })).toBe(ics);
  });
});

const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const kids = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);
const text = (el: Element, name: string) => kids(el, name)[0]?.textContent ?? null;

describe('Garmin TCX', () => {
  const xml = exportTcx(selectWorkouts(plan, { runningOnly: true }), { schedule: true });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  it('is well-formed TrainingCenterDatabase v2', () => {
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.localName).toBe('TrainingCenterDatabase');
    expect(doc.documentElement.namespaceURI).toBe(TCX_NS);
    const workouts = doc.getElementsByTagNameNS(TCX_NS, 'Workout');
    expect(workouts).toHaveLength(3);
    expect([...workouts].every((w) => w.getAttribute('Sport') === 'Running')).toBe(true);
  });

  it('keeps names short and unique and schedules each workout', () => {
    const workouts = [...doc.getElementsByTagNameNS(TCX_NS, 'Workout')];
    const names = workouts.map((w) => text(w, 'Name')!);
    expect(names.every((n) => n.length >= 1 && n.length <= 15)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe('11-03 Track 8×4');
    expect(workouts.map((w) => text(w, 'ScheduledOn'))).toEqual(['2026-11-03', '2026-11-05', '2026-11-08']);
    // Element order of Workout_t: Name, Step+, ScheduledOn*, Notes?
    expect(kids(workouts[0], '*').length).toBe(0);
    expect([...workouts[0].children].map((c) => c.localName)).toEqual(['Name', 'Step', 'Step', 'Step', 'ScheduledOn', 'Notes']);
    expect(tcxName('  a   b  ')).toBe('a b');
    const dup = exportTcx([wo('a', '2026-11-03', { title: 'Same' }), wo('b', '2026-11-04', { title: 'Same' })]);
    expect(dup).toContain('<Name>Same</Name>');
    expect(dup).toContain('<Name>Same 2</Name>');
  });

  it('writes steps, repeats, durations and pace targets', () => {
    const w = doc.getElementsByTagNameNS(TCX_NS, 'Workout')[0];
    const steps = kids(w, 'Step');
    expect(steps.map((s) => s.getAttributeNS(XSI, 'type'))).toEqual(['Step_t', 'Repeat_t', 'Step_t']);
    expect(steps.map((s) => text(s, 'StepId'))).toEqual(['1', '2', '5']);
    const [wu, rep] = steps;
    const dur = kids(wu, 'Duration')[0];
    expect(dur.getAttributeNS(XSI, 'type')).toBe('Time_t');
    expect(text(dur, 'Seconds')).toBe('600');
    expect(text(wu, 'Intensity')).toBe('Active');
    expect(kids(wu, 'Target')[0].getAttributeNS(XSI, 'type')).toBe('None_t');

    expect(text(rep, 'Repetitions')).toBe('8');
    const children = kids(rep, 'Child');
    expect(children.map((c) => [c.getAttributeNS(XSI, 'type'), text(c, 'StepId')])).toEqual([['Step_t', '3'], ['Step_t', '4']]);
    const work = children[0];
    expect(kids(work, 'Duration')[0].getAttributeNS(XSI, 'type')).toBe('Distance_t');
    expect(text(kids(work, 'Duration')[0], 'Meters')).toBe('400');
    const target = kids(work, 'Target')[0];
    expect(target.getAttributeNS(XSI, 'type')).toBe('Speed_t');
    const zone = kids(target, 'SpeedZone')[0];
    expect(zone.getAttributeNS(XSI, 'type')).toBe('CustomSpeedZone_t');
    expect(text(zone, 'ViewAs')).toBe('Pace');
    expect(Number(text(zone, 'LowInMetersPerSecond'))).toBeCloseTo(1000 / 250, 3);
    expect(Number(text(zone, 'HighInMetersPerSecond'))).toBeCloseTo(1000 / 240, 3);
    expect(text(children[1], 'Intensity')).toBe('Resting');

    // A simple workout becomes one distance step with a pace range.
    const easy = doc.getElementsByTagNameNS(TCX_NS, 'Workout')[1];
    expect(kids(easy, 'Step')).toHaveLength(1);
    expect(text(kids(kids(easy, 'Step')[0], 'Duration')[0], 'Meters')).toBe('6000');
    // Escaped notes.
    expect(text(w, 'Notes')).toContain('Line 2 \\ end');
  });

  it('writes heart-rate targets and open steps', () => {
    const x = exportTcx([wo('h', '2026-11-03', { steps: [simpleStep('active', { type: 'open' }, { type: 'hr', zone: 2 }), simpleStep('active', time(60), { type: 'hr', min: 150, max: 160 })] })]);
    const d = new DOMParser().parseFromString(x, 'application/xml');
    const steps = [...d.getElementsByTagNameNS(TCX_NS, 'Step')];
    expect(kids(steps[0], 'Duration')[0].getAttributeNS(XSI, 'type')).toBe('UserInitiated_t');
    const z = kids(kids(steps[0], 'Target')[0], 'HeartRateZone')[0];
    expect(z.getAttributeNS(XSI, 'type')).toBe('PredefinedHeartRateZone_t');
    expect(text(z, 'Number')).toBe('2');
    const c = kids(kids(steps[1], 'Target')[0], 'HeartRateZone')[0];
    expect(c.getAttributeNS(XSI, 'type')).toBe('CustomHeartRateZone_t');
    expect(text(kids(c, 'Low')[0], 'Value')).toBe('150');
    expect(text(kids(c, 'High')[0], 'Value')).toBe('160');
  });
});

// ---- FIT ----

interface FitMessage {
  global: number;
  fields: Record<number, number | string>;
}

/** A small FIT decoder for our own files: checks CRCs and reads definition/data messages. */
function decodeFit(bytes: Uint8Array): FitMessage[] {
  const headerSize = bytes[0];
  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  expect(headerSize + dataSize + 2).toBe(bytes.length);
  expect(fitCrc(bytes, 0, 12)).toBe(bytes[12] | (bytes[13] << 8));
  expect(fitCrc(bytes)).toBe(0); // CRC over data + stored CRC leaves no remainder.
  const defs = new Map<number, { global: number; fields: { num: number; size: number; base: number }[] }>();
  const out: FitMessage[] = [];
  let p = headerSize;
  while (p < headerSize + dataSize) {
    const h = bytes[p++];
    expect(h & 0x80).toBe(0); // No compressed timestamps.
    const local = h & 0x0f;
    if (h & 0x40) {
      p++; // reserved
      expect(bytes[p++]).toBe(0); // little endian
      const global = bytes[p] | (bytes[p + 1] << 8);
      p += 2;
      const n = bytes[p++];
      const fields = [];
      for (let i = 0; i < n; i++, p += 3) fields.push({ num: bytes[p], size: bytes[p + 1], base: bytes[p + 2] });
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local)!;
      const fields: FitMessage['fields'] = {};
      for (const f of def.fields) {
        const chunk = bytes.slice(p, p + f.size);
        p += f.size;
        if (f.base === 0x07) {
          const end = chunk.indexOf(0);
          fields[f.num] = new TextDecoder().decode(chunk.slice(0, end < 0 ? chunk.length : end));
        } else {
          let v = 0;
          for (let b = f.size - 1; b >= 0; b--) v = v * 256 + chunk[b];
          fields[f.num] = v;
        }
      }
      out.push({ global: def.global, fields });
    }
  }
  return out;
}

describe('FIT workout', () => {
  it('computes the FIT CRC-16', () => {
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
    expect(fitCrc([])).toBe(0);
  });

  it('writes a valid 14-byte header', () => {
    const bytes = encodeWorkoutFit({ name: 'Test', steps: intervals(), timeCreated: Date.UTC(2026, 10, 1) });
    expect(bytes[0]).toBe(14);
    expect(bytes[1]).toBe(0x10);
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
    const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
    expect(dataSize).toBe(bytes.length - 16);
  });

  it('round-trips file_id, workout and workout steps', () => {
    const created = Date.UTC(2026, 10, 1, 8);
    const steps: WorkoutStep[] = [...intervals(), simpleStep('active', { type: 'open' }, { type: 'hr', zone: 2 }, 'easy 🏃'), simpleStep('rest', time(60), { type: 'hr', min: 120, max: 130 })];
    const msgs = decodeFit(encodeWorkoutFit({ name: 'Intervalos 8×400 na pista', steps, stepName: (s) => s.kind, timeCreated: created }));
    expect(msgs.map((m) => m.global)).toEqual([0, 26, 27, 27, 27, 27, 27, 27, 27]);

    const [fileId, workout, ...ws] = msgs;
    expect(fileId.fields[0]).toBe(5); // workout file
    expect(fileId.fields[1]).toBe(255);
    expect(fileId.fields[4]).toBe((created - FIT_EPOCH_MS) / 1000);

    expect(workout.fields[4]).toBe(1); // running
    expect(workout.fields[6]).toBe(7);
    expect(fitStepCount(steps)).toBe(7);
    expect(workout.fields[8]).toBe('Intervalos 8×400 na pista');

    const field = (i: number, n: number) => ws[i].fields[n];
    expect(ws.map((_, i) => field(i, 254))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Warm-up: 10 min = 600000 ms, open target, intensity warmup.
    expect([field(0, 0), field(0, 1), field(0, 2), field(0, 3), field(0, 7)]).toEqual(['warmup', 0, 600_000, 2, 2]);
    // Work: 400 m = 40000 cm, speed target 4:10–4:00 /km in mm/s.
    expect([field(1, 1), field(1, 2), field(1, 3), field(1, 4), field(1, 5), field(1, 6), field(1, 7)]).toEqual([1, 40_000, 0, 0, 4000, 4167, 0]);
    // Recovery 200 m.
    expect([field(2, 1), field(2, 2), field(2, 7)]).toEqual([1, 20_000, 4]);
    // Repeat: back to step 1, 8 times.
    expect([field(3, 1), field(3, 2), field(3, 4), field(3, 3), field(3, 7)]).toEqual([6, 1, 8, 0xff, 0xff]);
    // Cool-down.
    expect([field(4, 1), field(4, 2), field(4, 7)]).toEqual([0, 600_000, 3]);
    // Open step with an HR zone and a note.
    expect([field(5, 1), field(5, 2), field(5, 3), field(5, 4), field(5, 8)]).toEqual([5, 0xffffffff, 1, 2, 'easy 🏃']);
    // Custom bpm are offset by 100.
    expect([field(6, 3), field(6, 4), field(6, 5), field(6, 6), field(6, 7)]).toEqual([1, 0, 220, 230, 1]);
  });

  it('cuts long UTF-8 names at a character boundary', () => {
    const msgs = decodeFit(encodeWorkoutFit({ name: 'ç'.repeat(40), steps: [simpleStep('active', distance(1000))], timeCreated: Date.UTC(2026, 0, 1) }));
    expect(msgs[1].fields[8]).toBe('ç'.repeat(15));
  });

  it('exports a planned workout', () => {
    const msgs = decodeFit(exportWorkoutFit(plan[2], { now: Date.UTC(2026, 10, 1) }));
    expect(msgs[1].fields[6]).toBe(1);
    expect(msgs[2].fields[1]).toBe(1);
    expect(msgs[2].fields[2]).toBe(600_000);
    expect(msgs[2].fields[0]).toBe('Work');
  });
});

// ---- Editor ----

describe('steps editor', () => {
  it('edits, reorders and reads steps', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let changes = 0;
    const editor = createStepsEditor(host, [], { easyPace: 360, onChange: () => changes++ });
    expect(editor.isEmpty()).toBe(true);
    expect(editor.read().issue).toEqual({ code: 'empty', index: 0 });

    const click = (sel: string, root: ParentNode = host) => root.querySelector<HTMLElement>(sel)!.click();
    click('[data-op="add-step"]');
    click('[data-op="add-repeat"]');
    expect(host.querySelectorAll('.trn-srepeat .trn-srow')).toHaveLength(2);

    // Type a pace target on the first step.
    const row = host.querySelector<HTMLElement>('.trn-srows > .trn-srow')!;
    const tgt = row.querySelector<HTMLSelectElement>('[data-f="tgt"]')!;
    tgt.value = 'pace';
    tgt.dispatchEvent(new Event('change', { bubbles: true }));
    const setText = (el: HTMLInputElement, v: string) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const row1 = host.querySelector<HTMLElement>('.trn-srows > .trn-srow')!;
    setText(row1.querySelector('[data-f="a"]')!, '5:10');
    setText(row1.querySelector('[data-f="b"]')!, '5:00');
    setText(host.querySelector('[data-f="times"]')!, '6');

    // Move the repeat block up.
    click('[data-op="up"]', host.querySelector('.trn-srepeat-head')!);
    const r = editor.read();
    expect(r.issue).toBeNull();
    expect(r.steps![0]).toMatchObject({ type: 'repeat', times: 6 });
    expect(r.steps![1]).toMatchObject({ kind: 'active', duration: { type: 'distance', meters: 1000 }, target: { type: 'pace', min: 300, max: 310 } });
    expect(changes).toBeGreaterThan(3);
    expect(host.querySelector('.trn-steps-summary')!.textContent).toBe('6×(400 m, 200 m jog) · 1 km @ 5:00–5:10 /km');
    expect(host.querySelectorAll('.trn-bar')).toHaveLength(13);

    // Invalid input is reported with its position.
    setText(host.querySelector(':scope > .trn-srows > .trn-srow [data-f="value"]')!, 'abc');
    expect(editor.read().issue).toEqual({ code: 'duration', index: 2 });
    host.remove();
  });
});

// ---- Dialogs (smoke) ----

describe('workout and export dialogs', () => {
  const setup = async () => {
    const { openExportDialog, openWorkoutDialog } = await import('../src/screens/training/dialogs');
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    if (!('showModal' in HTMLDialogElement.prototype) || typeof proto.showModal !== 'function') {
      proto.showModal = function (this: HTMLDialogElement) { this.open = true; };
      proto.close = function (this: HTMLDialogElement) { this.open = false; };
    }
    document.body.innerHTML = '<div class="trn-root"><dialog class="trn-dialog"></dialog></div>';
    const dialog = document.querySelector('dialog')!;
    const ctx = { dialog, today: () => '2026-11-04', activities: () => [], selectPlan: () => {} };
    return { ctx, dialog, openExportDialog, openWorkoutDialog };
  };
  const trainingPlan = { id: 'p', name: 'Plano 10K', goal: '10k' as const, createdAt: 0 };

  it('edits a structured workout with templates and derived targets', async () => {
    const { ctx, dialog, openWorkoutDialog } = await setup();
    openWorkoutDialog(ctx, trainingPlan, { workout: plan[0], easyPace: 360 });
    const form = dialog.querySelector('form')!;
    const input = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    expect(input('structured').checked).toBe(true);
    expect(form.querySelector<HTMLElement>('.trn-steps')!.hidden).toBe(false);
    expect(form.querySelectorAll('.trn-srow')).toHaveLength(4);
    expect(form.querySelector('.trn-steps-summary')!.textContent).toContain('8×(400 m @ 4:00–4:10 /km, 200 m jog)');

    // A template replaces the steps and updates kind and derived distance/duration.
    const sel = form.elements.namedItem('stepTemplate') as HTMLSelectElement;
    sel.value = 'tempo3x10';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = await answerConfirm(true);
    expect(shown.title).toBe('Replace steps');
    expect(shown.dialog.querySelector('.btn.primary')).not.toBeNull();
    await vi.waitFor(() => expect((form.elements.namedItem('kind') as HTMLSelectElement).value).toBe('tempo'));
    expect((form.elements.namedItem('kind') as HTMLSelectElement).value).toBe('tempo');
    expect(form.querySelector('.trn-steps-summary')!.textContent).toBe('15 min WU · 3×(10 min @ 5:10–5:20 /km, 2 min jog) · 10 min CD');
    expect(input('duration').value).toBe('1:01:00');
    expect(input('distance').value).not.toBe('7.5');

    // Turning structure on for a simple workout starts from its targets.
    openWorkoutDialog(ctx, trainingPlan, { workout: plan[2] });
    const f2 = dialog.querySelector('form')!;
    const box = f2.elements.namedItem('structured') as HTMLInputElement;
    expect(f2.querySelector<HTMLElement>('.trn-steps')!.hidden).toBe(true);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f2.querySelector('.trn-steps-summary')!.textContent).toBe('10 min WU · 6 km @ 6:05–6:25 /km · 10 min CD');
    expect(f2.querySelector<HTMLElement>('.trn-wexport')!.hidden).toBe(false);
  });

  it('offers export formats with sensible defaults', async () => {
    const { ctx, dialog, openExportDialog } = await setup();
    openExportDialog(ctx, trainingPlan, plan);
    const form = dialog.querySelector('form')!;
    expect(form.querySelectorAll('input[name="format"]')).toHaveLength(4);
    const upcoming = form.elements.namedItem('upcoming') as HTMLInputElement;
    const rest = form.elements.namedItem('rest') as HTMLInputElement;
    expect(upcoming.checked).toBe(true); // ICS by default: from today (2026-11-04) on.
    expect(form.querySelector('.trn-export-count')!.textContent).toContain('3 workouts');
    const json = form.querySelector<HTMLInputElement>('input[value="json"]')!;
    json.checked = true;
    json.dispatchEvent(new Event('change', { bubbles: true }));
    expect(upcoming.checked).toBe(false);
    expect(rest.checked).toBe(true);
    expect(form.querySelector('.trn-export-count')!.textContent).toContain('5 workouts');
    const tcx = form.querySelector<HTMLInputElement>('input[value="tcx"]')!;
    tcx.checked = true;
    tcx.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rest.disabled).toBe(true);
    expect(form.querySelector('.trn-export-count')!.textContent).toContain('2 workouts');
  });
});
