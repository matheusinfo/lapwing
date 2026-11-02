// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportOptions, ImportResult } from '../src/data/import';
import { parseActivityGpx } from '../src/data/parse-activity';
import type { Activity, ActivitySummary, TrackPoint } from '../src/data/types';

const ui = vi.hoisted(() => ({
  calls: [] as { files: File[]; opts: ImportOptions; resolve: (r: ImportResult) => void }[],
  navigate: [] as string[],
  toasts: [] as string[],
}));
vi.mock('../src/data/db', () => ({
  listActivities: async () => [],
  onDataChange: () => () => {},
}));
vi.mock('../src/data/import', () => ({
  importActivityFiles: (files: File[], opts: ImportOptions) =>
    new Promise<ImportResult>((resolve) => ui.calls.push({ files, opts, resolve })),
}));
vi.mock('../src/app/router', () => ({ navigate: (to: string) => ui.navigate.push(to) }));
vi.mock('../src/ui/toast', () => ({ showToast: (msg: string) => ui.toasts.push(msg) }));

import { mountImportPage } from '../src/screens/activity/import-page';
import {
  aerobicDecoupling,
  bestEfforts,
  binOf,
  buildStreams,
  detectFastBlocks,
  kmSplits,
  quantileBreaks,
  sampleByDistance,
} from '../src/screens/activity/calc';
import { toActivityGpx } from '../src/screens/activity/export-gpx';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs');
const fixture = (match: string) => {
  const name = fs.readdirSync(dir).find((f) => f.includes(match))!;
  return parseActivityGpx(fs.readFileSync(path.join(dir, name), 'utf8')).points;
};

/**
 * A straight run heading east, one point per second, from blocks of
 * [metres, pace s/km, heart rate]. Small seeded jitter like a real watch.
 */
function synthRun(blocks: [number, number, number][], opts: { hrDrift?: number } = {}): TrackPoint[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  const pts: TrackPoint[] = [{ lat: 0, lon: 0, time: 0, hr: 100, ele: 500, cad: 170 }];
  let m = 0, t = 0;
  for (const [len, pace, hr] of blocks) {
    const end = m + len;
    while (m < end) {
      m += 1000 / (pace + rand() * 10);
      t += 1000;
      const drift = opts.hrDrift ? (opts.hrDrift * t) / 3_600_000 : 0;
      pts.push({ lat: 0, lon: m / 111320, time: t, hr: hr + drift + rand() * 2, ele: 500 + m / 100, cad: 170 + rand() * 2 });
    }
  }
  return pts;
}

const intervalRun = (reps: number, rep: number) => {
  const blocks: [number, number, number][] = [[2000, 370, 140]];
  for (let i = 0; i < reps; i++) blocks.push([rep, 270, 172], [400, 430, 150]);
  blocks.push([1500, 380, 145]);
  return synthRun(blocks);
};

describe('kmSplits', () => {
  it('gives one split per km with a partial last split', () => {
    const s = buildStreams(synthRun([[3500, 300, 150]]));
    const splits = kmSplits(s);
    expect(splits).toHaveLength(4);
    expect(splits.slice(0, 3).every((x) => !x.partial && Math.abs(x.pace! - 300) < 5)).toBe(true);
    expect(splits[3].partial).toBe(true);
    expect(splits[3].distance).toBeCloseTo(s.total - 3000, 3);
    expect(splits[0].eleChange).toBeCloseTo(10, 0); // +1 m per 100 m
    expect(splits[0].avgHr).toBeCloseTo(150, 0);
  });

  it('splits fixture runs and adds up to the total time', () => {
    const s = buildStreams(fixture('tempo-run'));
    const splits = kmSplits(s);
    expect(splits.length).toBe(Math.ceil(s.total / 1000));
    const time = splits.reduce((a, x) => a + (x.time ?? 0), 0);
    expect(time).toBeCloseTo(s.moving[s.moving.length - 1], 0);
  });
});

describe('sampleByDistance', () => {
  it('samples evenly with smoothed pace', () => {
    const s = buildStreams(synthRun([[2000, 360, 150]]));
    const samples = sampleByDistance(s, 50, 200);
    expect(samples[1].d - samples[0].d).toBe(50);
    const mid = samples[20];
    expect(mid.pace).toBeGreaterThan(350);
    expect(mid.pace).toBeLessThan(370);
    expect(mid.hr).toBeCloseTo(150, 0);
    expect(mid.ele).toBeCloseTo(510, 0);
  });
});

describe('detectFastBlocks', () => {
  it.each([
    [6, 800],
    [5, 1000],
    [8, 400],
  ])('finds %i reps of %i m', (reps, rep) => {
    const blocks = detectFastBlocks(buildStreams(intervalRun(reps, rep)));
    expect(blocks).toHaveLength(reps);
    for (const b of blocks) {
      expect(Math.abs(b.distance - rep)).toBeLessThan(80);
      expect(b.pace).toBeLessThan(290);
      expect(b.avgHr).toBeGreaterThan(160);
    }
  });

  it('finds the tempo block and nothing in a steady run', () => {
    const tempo = detectFastBlocks(buildStreams(synthRun([[2000, 365, 140], [5000, 300, 165], [1500, 380, 145]])));
    expect(tempo).toHaveLength(1);
    expect(Math.abs(tempo[0].distance - 5000)).toBeLessThan(100);
    expect(detectFastBlocks(buildStreams(synthRun([[8000, 365, 145]])))).toHaveLength(0);
  });

  it('keeps a steady pace on the easy-run fixture', () => {
    const paces = sampleByDistance(buildStreams(fixture('2026-10-26')), 50, 200)
      .map((x) => x.pace)
      .filter((p): p is number => p !== undefined);
    expect((Math.max(...paces) - Math.min(...paces)) / Math.min(...paces)).toBeLessThan(0.3);
  });

  it('finds the reps in the intervalado fixtures', () => {
    expect(detectFastBlocks(buildStreams(fixture('tempo-run')))).toHaveLength(1);
    expect(detectFastBlocks(buildStreams(fixture('6x800')))).toHaveLength(6);
    expect(detectFastBlocks(buildStreams(fixture('5x1000')))).toHaveLength(5);
    expect(detectFastBlocks(buildStreams(fixture('8x400')))).toHaveLength(8);
    expect(detectFastBlocks(buildStreams(fixture('2026-10-26')))).toHaveLength(0);
  });
});

describe('aerobicDecoupling', () => {
  it('is near zero for a steady run and positive when HR drifts up', () => {
    const steady = aerobicDecoupling(buildStreams(synthRun([[6000, 360, 150]])))!;
    expect(Math.abs(steady)).toBeLessThan(1.5);
    const drifting = aerobicDecoupling(buildStreams(synthRun([[6000, 360, 145]], { hrDrift: 20 })))!;
    expect(drifting).toBeGreaterThan(3);
  });

  it('needs at least 20 minutes', () => {
    expect(aerobicDecoupling(buildStreams(synthRun([[2000, 360, 150]])))).toBeUndefined();
  });
});

describe('bestEfforts', () => {
  it('lists only distances the run covers', () => {
    const s = buildStreams(synthRun([[5200, 300, 150]]));
    const efforts = bestEfforts(s);
    expect(efforts.map((e) => e.key)).toEqual(['effort400', 'effort1k', 'effortMile', 'effort5k']);
    expect(efforts.find((e) => e.key === 'effort5k')!.time).toBeCloseTo(1500, -1);
  });
});

describe('quantile bins', () => {
  it('splits values into equal groups', () => {
    const breaks = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(breaks).toHaveLength(4);
    expect(binOf(1, breaks)).toBe(0);
    expect(binOf(10, breaks)).toBe(4);
  });
});

describe('toActivityGpx', () => {
  it('keeps time, heart rate and cadence through a round trip', () => {
    const points = fixture('5x1000').slice(0, 50);
    const back = parseActivityGpx(toActivityGpx(points, 'Teste & <ok>')).points;
    expect(back).toHaveLength(50);
    expect(back[10].time).toBe(points[10].time);
    expect(back[10].hr).toBe(points[10].hr);
    expect(back[10].cad).toBe(points[10].cad);
    expect(back[10].power).toBe(points[10].power);
    expect(back[10].lat).toBeCloseTo(points[10].lat, 6);
  });
});

describe('import page', () => {
  let root: HTMLElement;
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
    root?.remove();
    ui.calls.length = 0;
    ui.navigate.length = 0;
    ui.toasts.length = 0;
  });

  function mount() {
    root = document.createElement('div');
    document.body.append(root);
    unmount = mountImportPage(root);
    return root;
  }
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  function choose(...files: File[]) {
    const input = $<HTMLInputElement>('.act-file');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const activity = (i: number): Activity => ({
    id: `a${i}`,
    name: `Run <${i}>`,
    type: 'run',
    startTime: i,
    hasStartTime: true,
    fileName: `activities/${i}.fit.gz`,
    importedAt: 0,
    summary: { distance: 5000 } as ActivitySummary,
  });

  it('accepts every supported format', () => {
    mount();
    expect($<HTMLInputElement>('.act-file').accept).toBe('.gpx,.fit,.tcx,.gz,.zip,application/gpx+xml,application/zip');
    expect($('.act-drop-hint').textContent).toContain('.zip');
    expect($('.act-howto').textContent).toContain('without unzipping');
    expect($('.act-howto').textContent).not.toContain('a GPX for each activity');
  });

  it('shows progress, cancels, and summarises a Strava archive', async () => {
    mount();
    choose(new File(['PK'], 'export_1.zip'), new File(['x'], 'photo.jpg'));
    expect(ui.calls).toHaveLength(1);
    const call = ui.calls[0];
    expect(call.files.map((f) => f.name)).toEqual(['export_1.zip']);
    expect($('.act-progress').hidden).toBe(false);
    expect($<HTMLInputElement>('.act-file').disabled).toBe(true);
    expect($('.act-dropzone').classList.contains('act-busy')).toBe(true);

    call.opts.onProgress!({ phase: 'open', done: 0, total: 0 });
    expect($('.act-progress-text').textContent).toBe('Reading the archive…');
    call.opts.onProgress!({ phase: 'import', done: 119, total: 356 });
    expect($('.act-progress-text').textContent).toBe('Importing 120 of 356…');
    expect($('.act-bar > span').style.width).toBe('33%');

    // A second drop while busy is ignored.
    choose(new File(['x'], 'other.gpx'));
    expect(ui.calls).toHaveLength(1);

    $<HTMLButtonElement>('.act-cancel').click();
    expect(call.opts.signal!.aborted).toBe(true);
    expect($<HTMLButtonElement>('.act-cancel').disabled).toBe(true);

    call.resolve({
      cancelled: true,
      imported: Array.from({ length: 25 }, (_, i) => activity(i)),
      failed: [
        { fileName: 'activities/90.fit.gz', code: 'duplicate', existingId: 'old', name: 'Old run' },
        { fileName: 'activities/91.fit.gz', code: 'duplicate', name: 'Older run' },
        { fileName: 'activities/92.fit.gz', code: 'no-gps', name: 'Treadmill' },
        { fileName: '', code: 'manual', name: 'Manual' },
        { fileName: 'activities/93.fit.gz', code: 'ignored-type', name: 'Gym' },
        { fileName: 'activities/94.fit.gz', code: 'read', name: 'Broken' },
      ],
    });
    await settle();

    expect($('.act-progress').hidden).toBe(true);
    expect($<HTMLInputElement>('.act-file').disabled).toBe(false);
    const box = $('.act-result');
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain('Import cancelled');
    const badges = [...box.querySelectorAll('.act-counts .badge')].map((b) => b.textContent);
    expect(badges).toEqual([
      '25 imported',
      '2 already in the app',
      '1 without GPS',
      '1 entered by hand (no file)',
      '1 other sports ignored',
      '1 with errors',
    ]);
    // Big import: imported runs and errors only, capped.
    const items = [...box.querySelectorAll('.act-result-list li')];
    expect(items).toHaveLength(21);
    expect(items.at(-1)!.textContent).toBe('and 6 more');
    expect(box.innerHTML).toContain('Run &lt;0&gt;');
    expect(box.textContent).not.toContain('Treadmill');
    expect(ui.toasts).toEqual(['25 run(s) imported.']);
    expect(ui.navigate).toEqual([]);
  });

  it('lists every file of a small import and opens a single imported run', async () => {
    mount();
    choose(new File(['x'], 'a.gpx'), new File(['x'], 'b.fit'));
    ui.calls[0].resolve({
      cancelled: false,
      imported: [activity(1)],
      failed: [{ fileName: 'b.fit', code: 'no-gps' }],
    });
    await settle();
    const text = $('.act-result').textContent!;
    expect(text).toContain('Run <1>');
    expect(text).toContain('No GPS (treadmill or indoor)');

    choose(new File(['x'], 'c.tcx.gz'));
    ui.calls[1].resolve({ cancelled: false, imported: [activity(2)], failed: [] });
    await settle();
    expect(ui.navigate).toEqual(['/activity/a2']);
  });

  it('cancels the import when the page is left', async () => {
    mount();
    choose(new File(['PK'], 'export.zip'));
    const call = ui.calls[0];
    unmount!();
    unmount = undefined;
    expect(call.opts.signal!.aborted).toBe(true);
    call.resolve({ cancelled: true, imported: [activity(1)], failed: [] });
    await settle();
    expect(ui.toasts).toEqual([]);
    expect(ui.navigate).toEqual([]);
  });
});
