/**
 * Writes realistic Strava-style GPX runs to tests/fixtures/runs/ for testing:
 *   node scripts/make-fixtures.mjs [end-date YYYY-MM-DD]
 * Runs cover the 5 weeks up to the end date (default 2026-10-31): easy runs,
 * long runs, intervals and tempo, with heart rate, cadence, temperature,
 * elevation, a traffic-light stop, and power on one file.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '../tests/fixtures/runs');
const END = new Date((process.argv[2] ?? '2026-10-31') + 'T00:00:00-03:00');
const DAY = 86400000;

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const noise = (a) => (rand() - 0.5) * 2 * a;

// A loop around Lago Ingá, Maringá (ellipse with wobble).
const CENTER = { lat: -23.4285, lon: -51.9255 };
const RX = 520, RY = 300; // metres
const shape = (a) => {
  const wob = 1 + 0.06 * Math.sin(5 * a);
  return [RX * wob * Math.cos(a), RY * wob * Math.sin(a)];
};
// Arc-length table, so equal simulated metres are equal distances on the
// ground (stepping the angle evenly would make the speed swing around the lap).
const STEPS = 20000;
const ARC = new Float64Array(STEPS + 1);
{
  let prev = shape(0);
  for (let i = 1; i <= STEPS; i++) {
    const cur = shape((i / STEPS) * 2 * Math.PI);
    ARC[i] = ARC[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
}
const PERIM = ARC[STEPS];
function angleAt(meters) {
  const d = meters % PERIM;
  let lo = 0, hi = STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ARC[mid] <= d) lo = mid; else hi = mid;
  }
  const f = (d - ARC[lo]) / (ARC[hi] - ARC[lo] || 1);
  return ((lo + f) / STEPS) * 2 * Math.PI;
}
function loopPoint(meters) {
  const a = angleAt(meters);
  const [x, y] = shape(a);
  return {
    lat: CENTER.lat + y / 110540,
    lon: CENTER.lon + x / (111320 * Math.cos((CENTER.lat * Math.PI) / 180)),
    ele: 560 + 14 * Math.sin(a) + 4 * Math.sin(3 * a),
  };
}

/** Workout = list of [meters, paceSecPerKm]. */
const easy = (km, pace = 365) => [[km * 1000, pace]];
const long = (km) => [[km * 1000, 385]];
const intervals = (reps, rep, pace) => {
  const out = [[2000, 370]];
  for (let i = 0; i < reps; i++) out.push([rep, pace], [400, 430]);
  out.push([1500, 380]);
  return out;
};
const tempo = () => [[2000, 365], [5000, 300], [1500, 380]];

function simulate(start, blocks, { stopAt, power } = {}) {
  const pts = [];
  let t = start.getTime(), m = 0, hr = 95, stopped = false;
  for (const [len, pace] of blocks) {
    const end = m + len;
    while (m < end) {
      if (stopAt && !stopped && m >= stopAt) {
        stopped = true;
        for (let s = 0; s < 35; s++) { // 35 s at a traffic light
          t += 1000; hr += (100 - hr) * 0.05;
          pts.push({ ...loopPoint(m), t, hr, cad: 0, stop: true });
        }
      }
      const v = 1000 / (pace + noise(8)); // m/s
      m += v; t += 1000;
      const target = 65 + (1000 / pace) * 30 + (m / 1000) * 0.6; // effort + drift
      hr += (Math.min(target, 192) - hr) * 0.03;
      const cad = 158 + (1000 / pace) * 6 + noise(2);
      pts.push({ ...loopPoint(m), t, hr: hr + noise(1.5), cad, w: power ? 180 + (1000 / pace) * 40 + noise(10) : undefined });
    }
  }
  return pts;
}

function gpx(name, pts, temp) {
  const iso = (t) => new Date(t).toISOString().replace('.000', '');
  const rows = pts.map((p) => {
    const ext = [
      `<gpxtpx:atemp>${Math.round(temp)}</gpxtpx:atemp>`,
      `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`,
      p.stop ? '' : `<gpxtpx:cad>${Math.round(p.cad / 2)}</gpxtpx:cad>`,
    ].join('');
    const pw = p.w ? `<power>${Math.round(p.w)}</power>` : '';
    return `   <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">
    <ele>${(p.ele + noise(0.3)).toFixed(1)}</ele>
    <time>${iso(p.t)}</time>
    <extensions>${pw}<gpxtpx:TrackPointExtension>${ext}</gpxtpx:TrackPointExtension></extensions>
   </trkpt>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3">
 <metadata>
  <time>${iso(pts[0].t)}</time>
 </metadata>
 <trk>
  <name>${name}</name>
  <type>running</type>
  <trkseg>
${rows.join('\n')}
  </trkseg>
 </trk>
</gpx>
`;
}

// Day offsets back from END, workout, options.
const PLAN = [
  [34, 'Corrida leve', easy(6)],
  [32, 'Intervalado 6x800', intervals(6, 800, 270)],
  [30, 'Corrida leve', easy(7), { stopAt: 3000 }],
  [28, 'Longão', long(14)],
  [26, 'Corrida leve', easy(6, 360)],
  [24, 'Tempo run', tempo()],
  [21, 'Longão', long(16), { stopAt: 8000 }],
  [19, 'Corrida leve', easy(8)],
  [17, 'Intervalado 5x1000', intervals(5, 1000, 265), { power: true }],
  [14, 'Longão', long(17)],
  [12, 'Regenerativo', easy(5, 400)],
  [10, 'Tempo run', tempo()],
  [7, 'Longão', long(18)],
  [5, 'Corrida leve', easy(7)],
  [3, 'Intervalado 8x400', intervals(8, 400, 255)],
  [1, 'Corrida leve', easy(6), { stopAt: 2500 }],
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
for (const [back, name, blocks, opts] of PLAN) {
  const day = new Date(END.getTime() - back * DAY);
  const start = new Date(day.getTime() + (6 * 60 + Math.round(rand() * 40)) * 60000); // ~6:00–6:40 local
  const temp = 19 + rand() * 9;
  const pts = simulate(start, blocks, opts);
  const file = `${day.toISOString().slice(0, 10)}-${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}.gpx`;
  fs.writeFileSync(path.join(OUT, file), gpx(name, pts, temp));
  console.log(file, (pts.length / 60).toFixed(0) + ' min');
}
