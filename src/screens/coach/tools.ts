/**
 * The coach's tools, run here in the browser against the local data. The
 * server (coach/prompt.ts) declares them to the model; the names and inputs
 * must match. Every tool returns plain text; a bad input or missing record
 * comes back as an error result the model can read and recover from.
 */
import { getActivity, getAll, getSettings, getTrack, listActivities } from '../../data/db';
import type { AthleteSettings } from '../../data/types';
import { hrZoneSeconds } from '../../data/metrics';
import { paceStarts, paceZoneSeconds } from '../../data/zones';
import { elevationGainLoss, haversine, trackDistance } from '../../geo';
import type { Coord, LngLat } from '../../types';
import { aerobicDecoupling, bestEfforts, buildStreams, detectFastBlocks, kmSplits } from '../activity/calc';
import { loadActivePlan, pickActivePlan } from '../training/active-plan';
import { addDays, isDateStr, localDateOf } from '../training/dates';
import { matchWorkouts } from '../training/matching';
import { computeProgress } from '../training/progress';
import type { PlannedWorkout, TrainingPlan } from '../training/types';
import { RouteState, type Segment } from '../routes/route/state';
import { ACTIVITY_HEADER, activityRow, clip, dur, km, pace, round, table, when, workoutLine } from './text';

export interface ToolResult {
  content: string;
  isError?: boolean;
}

class ToolInputError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function dateArg(input: Record<string, unknown>, key: string, fallback: string): string {
  const v = input[key];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !isDateStr(v)) throw new ToolInputError(`${key} must be a date YYYY-MM-DD.`);
  return v;
}

// ---- list_runs ----

async function listRuns(input: Record<string, unknown>, today: string): Promise<string> {
  const to = dateArg(input, 'to', today);
  const from = dateArg(input, 'from', addDays(to, -27));
  const limit = input.limit ?? 50;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ToolInputError('limit must be an integer from 1 to 200.');
  }
  const [activities, plans, workouts] = await Promise.all([
    listActivities(),
    getAll<TrainingPlan>('plans'),
    getAll<PlannedWorkout>('workouts'),
  ]);
  const inRange = activities
    .filter((a) => {
      const d = localDateOf(a.startTime);
      return d >= from && d <= to;
    })
    .sort((a, b) => b.startTime - a.startTime);
  if (!inRange.length) return `No activities from ${from} to ${to}.`;

  // The plan workout each run counts for (active plan only).
  const plan = pickActivePlan(plans, loadActivePlan());
  const workoutOf = new Map<string, PlannedWorkout>();
  if (plan) {
    const planWorkouts = workouts.filter((w) => w.planId === plan.id);
    const match = matchWorkouts(planWorkouts, activities, today);
    const byId = new Map(planWorkouts.map((w) => [w.id, w]));
    for (const [activityId, workoutId] of match.byActivity) workoutOf.set(activityId, byId.get(workoutId)!);
  }

  const shown = inRange.slice(0, limit);
  const totals = inRange.reduce(
    (t, a) => ({ distance: t.distance + a.summary.distance, time: t.time + a.summary.movingTime }),
    { distance: 0, time: 0 },
  );
  const rows = shown.map((a) => {
    const w = workoutOf.get(a.id);
    return [...activityRow(a), w ? `${w.kind}${w.title ? ` "${clip(w.title, 40)}"` : ''}` : '—', clip(a.notes, 120) || '—'];
  });
  return [
    `${inRange.length} activities from ${from} to ${to}: ${km(totals.distance, 1)}, ${dur(totals.time)} moving.` +
      (shown.length < inRange.length ? ` Showing the newest ${shown.length}.` : ''),
    table([...ACTIVITY_HEADER, 'plan workout', 'notes'], rows),
  ].join('\n\n');
}

// ---- get_run_details ----

async function runDetails(input: Record<string, unknown>, settings: AthleteSettings): Promise<string> {
  if (typeof input.id !== 'string' || !input.id) throw new ToolInputError('id is required.');
  const a = await getActivity(input.id);
  if (!a) throw new ToolInputError(`No activity with id ${input.id}. Use list_runs to find ids.`);
  const s = a.summary;
  const lines = [
    `"${clip(a.name, 100)}" (${a.type}), ${when(a.startTime)}`,
    `- Distance ${km(s.distance)}, moving ${dur(s.movingTime)}, elapsed ${dur(s.elapsedTime)}, average pace ${pace(s.avgPace)}, best 1 km rolling pace ${pace(s.bestPace)}`,
    `- Climb +${Math.round(s.elevationGain)} m / −${Math.round(s.elevationLoss)} m` +
      (s.minEle !== undefined && s.maxEle !== undefined ? `, elevation ${Math.round(s.minEle)}–${Math.round(s.maxEle)} m` : ''),
  ];
  if (s.avgHr) lines.push(`- Heart rate avg ${Math.round(s.avgHr)}, max ${Math.round(s.maxHr ?? s.avgHr)} bpm`);
  if (s.avgCadence) lines.push(`- Cadence avg ${Math.round(s.avgCadence)} spm`);
  if (s.avgPower) lines.push(`- Power avg ${Math.round(s.avgPower)} W`);
  if (s.avgTemp !== undefined) lines.push(`- Temperature avg ${round(s.avgTemp, 1)} °C`);
  if (a.rpe) lines.push(`- Effort (RPE) ${a.rpe}/10`);
  if (a.notes) lines.push(`- Notes: ${clip(a.notes, 500)}`);

  const points = await getTrack(a.id);
  if (points.length < 2) return [...lines, '- No track points stored.'].join('\n');
  const streams = buildStreams(points);

  const efforts = bestEfforts(streams);
  if (efforts.length) {
    lines.push(`- Best efforts in this run: ${efforts.map((e) => `${km(e.meters, e.meters < 1000 ? 1 : 2)} ${dur(e.time)}`).join(', ')}`);
  }
  const decoupling = aerobicDecoupling(streams);
  if (decoupling !== undefined) lines.push(`- Aerobic decoupling (pace:HR drift, 2nd half vs 1st): ${decoupling.toFixed(1)} %`);
  const blocks = detectFastBlocks(streams);
  if (blocks.length) {
    lines.push(
      `- Fast blocks detected (intervals): ${blocks.length}: ` +
        blocks.map((b) => `${km(b.end - b.start)} @ ${pace(b.pace)}${b.avgHr ? ` HR ${Math.round(b.avgHr)}` : ''}`).join('; '),
    );
  }
  if (s.has.hr) {
    const zones = hrZoneSeconds(points, settings);
    const total = zones.reduce((x, y) => x + y, 0);
    if (total > 0) lines.push(`- Time in HR zones: ${zones.map((z, i) => `Z${i + 1} ${dur(z)} (${((z / total) * 100).toFixed(0)} %)`).join(', ')}`);
  }
  const pz = paceStarts(settings);
  if (pz && streams.hasTime) {
    const zones = paceZoneSeconds(streams.dist, streams.moving, pz);
    const total = zones.reduce((x, y) => x + y, 0);
    if (total > 0) lines.push(`- Time in pace zones: ${zones.map((z, i) => `Z${i + 1} ${dur(z)}`).join(', ')}`);
  }

  const splits = kmSplits(streams);
  lines.push(
    '',
    'Splits per km:',
    table(
      ['km', 'distance', 'time', 'pace', 'avg HR', 'elevation change', 'cadence'],
      splits.map((sp) => [
        String(sp.km),
        sp.partial ? km(sp.distance) : '1 km',
        sp.time !== undefined ? dur(sp.time) : '—',
        pace(sp.pace),
        sp.avgHr ? String(Math.round(sp.avgHr)) : '—',
        sp.eleChange !== undefined ? `${sp.eleChange >= 0 ? '+' : ''}${Math.round(sp.eleChange)} m` : '—',
        sp.avgCad ? String(Math.round(sp.avgCad)) : '—',
      ]),
    ),
  );
  return lines.join('\n');
}

// ---- get_training_plan ----

async function trainingPlan(input: Record<string, unknown>, today: string): Promise<string> {
  const [plans, workouts, activities] = await Promise.all([
    getAll<TrainingPlan>('plans'),
    getAll<PlannedWorkout>('workouts'),
    listActivities(),
  ]);
  if (!plans.length) return 'There are no training plans.';
  let plan: TrainingPlan | undefined;
  if (input.plan_id !== undefined) {
    if (typeof input.plan_id !== 'string') throw new ToolInputError('plan_id must be a string.');
    plan = plans.find((p) => p.id === input.plan_id);
    if (!plan) throw new ToolInputError(`No plan with id ${input.plan_id}. Plans: ${plans.map((p) => `${p.id} "${p.name}"`).join(', ')}`);
  } else {
    plan = pickActivePlan(plans, loadActivePlan());
  }
  if (!plan) return 'There is no active training plan.';
  const planWorkouts = workouts.filter((w) => w.planId === plan.id).sort((a, b) => a.date.localeCompare(b.date));
  const match = matchWorkouts(planWorkouts, activities, today);
  const progress = computeProgress(plan, planWorkouts, activities, match, today);
  const lines = [
    `Plan "${clip(plan.name, 80)}" (id ${plan.id}), goal ${plan.goal}${plan.raceDate ? `, race on ${plan.raceDate}` : ''}. Today is ${today}.`,
    `Progress: ${progress.done} done, ${progress.partial} partial, ${progress.missed} missed, ${progress.skipped} skipped, ${progress.upcoming} to go; ` +
      `${km(progress.doneTotal, 1)} done of ${km(progress.plannedTotal, 1)} planned.`,
    '',
    'Weekly volume (planned vs run):',
    ...progress.weeks.map((w) => `- ${w.start}: ${km(w.planned, 1)} planned, ${km(w.actual, 1)} run`),
    '',
    'Workouts:',
  ];
  for (const w of planWorkouts) {
    const r = match.byWorkout.get(w.id)!;
    lines.push(`- ${workoutLine(w, r.status, r.activity)}`);
  }
  return lines.join('\n');
}

// ---- get_current_route ----

const ROUTE_KEY = 'lapwing:route';
const NAME_KEY = 'lapwing:name';

/**
 * Elevation profile per km of a route: elevation at both ends, climb and
 * descent (same 2 m noise filter as `elevationGainLoss`) and average grade.
 */
export function routeProfile(track: Coord[]): string[][] {
  // [distance, 0, elevation] samples, with one more at every km mark.
  const samples: Coord[] = [[0, 0, track[0][2]] as Coord];
  let dist = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const step = haversine(a, b);
    for (let mark = (Math.floor(dist / 1000) + 1) * 1000; mark < dist + step; mark += 1000) {
      const e = a[2] !== undefined && b[2] !== undefined ? a[2] + ((b[2] - a[2]) * (mark - dist)) / step : undefined;
      samples.push([mark, 0, e] as Coord);
    }
    dist += step;
    samples.push([dist, 0, b[2]] as Coord);
  }
  const rows: string[][] = [];
  let j = 0;
  for (let start = 0; start < dist; start += 1000) {
    const end = Math.min(dist, start + 1000);
    if (end - start < 10) break;
    while (j < samples.length - 1 && samples[j + 1][0] <= start) j++;
    const seg: Coord[] = [];
    for (let k = j; k < samples.length && samples[k][0] <= end; k++) seg.push(samples[k]);
    const eles = seg.map((c) => c[2]).filter((e): e is number => e !== undefined);
    const { gain, loss } = elevationGainLoss(seg);
    const from = eles[0];
    const to = eles[eles.length - 1];
    rows.push([
      `${start / 1000}–${end === dist && end % 1000 ? (end / 1000).toFixed(2) : end / 1000}`,
      eles.length ? `${Math.round(from)} → ${Math.round(to)} m` : '—',
      `+${Math.round(gain)} m`,
      `−${Math.round(loss)} m`,
      eles.length ? `${to >= from ? '+' : ''}${(((to - from) / (end - start)) * 100).toFixed(1)} %` : '—',
    ]);
  }
  return rows;
}

function currentRoute(): string {
  let saved: { waypoints: LngLat[]; segments: Segment[] } | null = null;
  let name = '';
  try {
    const raw = localStorage.getItem(ROUTE_KEY);
    saved = raw ? JSON.parse(raw) : null;
    name = JSON.parse(localStorage.getItem(NAME_KEY) ?? '""') ?? '';
  } catch {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.waypoints) || !Array.isArray(saved.segments)) {
    return 'The route editor is empty. Ask the athlete to open the course GPX (or draw it) in Routes.';
  }
  const state = new RouteState();
  state.load(saved.waypoints, saved.segments);
  const track = state.track();
  if (track.length < 2) return 'The route editor is empty. Ask the athlete to open the course GPX (or draw it) in Routes.';
  const distance = trackDistance(track);
  const ele = elevationGainLoss(track);
  const lines = [`Route "${clip(String(name), 100) || 'unnamed'}": ${km(distance)}.`];
  if (!ele.hasElevation) {
    lines.push('It has no elevation data.');
    return lines.join('\n');
  }
  const eles = track.map((c) => c[2]).filter((e): e is number => e !== undefined);
  lines.push(
    `Total climb +${Math.round(ele.gain)} m, descent −${Math.round(ele.loss)} m; elevation from ${Math.round(Math.min(...eles))} to ${Math.round(Math.max(...eles))} m.`,
    `Start ${Math.round(eles[0])} m, finish ${Math.round(eles[eles.length - 1])} m.`,
    '',
    table(['km', 'elevation', 'gain', 'loss', 'avg grade'], routeProfile(track)),
  );
  return lines.join('\n');
}

// ---- Dispatcher ----

/** Runs one tool call by name. Never throws: failures become error results. */
export async function runTool(name: string, input: unknown, today = localDateOf(Date.now())): Promise<ToolResult> {
  try {
    if (!isObject(input)) throw new ToolInputError('Input must be an object.');
    switch (name) {
      case 'list_runs':
        return { content: await listRuns(input, today) };
      case 'get_run_details':
        return { content: await runDetails(input, await getSettings()) };
      case 'get_training_plan':
        return { content: await trainingPlan(input, today) };
      case 'get_current_route':
        return { content: currentRoute() };
      default:
        return { content: `Unknown tool ${name}.`, isError: true };
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { content: err.message, isError: true };
    console.error(`Coach tool ${name} failed`, err);
    return { content: `The tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

