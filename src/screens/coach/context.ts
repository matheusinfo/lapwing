/**
 * The athlete snapshot sent with every question of a conversation: profile,
 * zones, recent volume, recent runs, predictions, form, the active plan and
 * goals. Taken once when the conversation starts (so the prompt stays the
 * same and cached); the tools in tools.ts give the coach anything newer or
 * more detailed. Pure: no DOM, no database.
 */
import type { Activity, AthleteSettings } from '../../data/types';
import { hrStarts, paceStarts } from '../../data/zones';
import { summaryRecords, type Efforts } from '../history/aggregate';
import type { Goal } from '../insights/goals';
import { bestVdot, collectEfforts, DEFAULT_WINDOW_DAYS, predictRaces, predictionRuns } from '../insights/predictions';
import { formToday, goalsToday, planDay, readiness } from '../today/calc';
import { addDays, localDateOf, weekStart, weekday } from '../training/dates';
import { matchWorkouts } from '../training/matching';
import { computeProgress } from '../training/progress';
import type { PlannedWorkout, TrainingPlan } from '../training/types';
import { ACTIVITY_HEADER, activityRow, clip, dur, km, pace, round, table, when, workoutLine } from './text';

export interface CoachData {
  activities: Activity[];
  settings: AthleteSettings;
  plans: TrainingPlan[];
  workouts: PlannedWorkout[];
  goals: Goal[];
  /** Best efforts of the runs used for predictions (see `predictionWindowStart`). */
  efforts: Map<string, Efforts>;
  activePlanId: string | null;
}

export const RECENT_RUNS = 15;
export const WEEKS = 12;
const DAY = 86_400_000;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RUN_TYPES = new Set(['run', 'trail-run']);
const isRun = (a: Activity) => RUN_TYPES.has(a.type);

/** Start of the window whose runs feed race predictions (same as Insights' default). */
export const predictionWindowStart = (now: number) => now - DEFAULT_WINDOW_DAYS * DAY;

function athlete(s: AthleteSettings): string {
  const lines: string[] = [];
  const profile = [`max HR ${s.maxHr} bpm`, `resting HR ${s.restingHr} bpm`];
  if (s.lthr) profile.push(`lactate threshold HR ${s.lthr} bpm`);
  if (s.thresholdPace) profile.push(`threshold pace ${pace(s.thresholdPace)}`);
  if (s.weight) profile.push(`weight ${s.weight} kg`);
  lines.push(`- ${profile.join(', ')}`);
  const hr = hrStarts(s);
  lines.push(
    `- Heart-rate zones: Z1 < ${hr[0]}, Z2 ${hr[0]}–${hr[1] - 1}, Z3 ${hr[1]}–${hr[2] - 1}, Z4 ${hr[2]}–${hr[3] - 1}, Z5 ≥ ${hr[3]} bpm`,
  );
  const p = paceStarts(s);
  lines.push(
    p
      ? `- Pace zones: Z1 slower than ${pace(p[0])}, Z2 ${pace(p[0])}–${pace(p[1])}, Z3 ${pace(p[1])}–${pace(p[2])}, Z4 ${pace(p[2])}–${pace(p[3])}, Z5 faster than ${pace(p[3])}`
      : '- Pace zones: not set',
  );
  return lines.join('\n');
}

function weeklyVolume(runs: Activity[], today: string): string {
  const rows: string[][] = [];
  const thisWeek = weekStart(today);
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 6);
    const week = runs.filter((a) => {
      const d = localDateOf(a.startTime);
      return d >= start && d <= end;
    });
    const distance = week.reduce((sum, a) => sum + a.summary.distance, 0);
    const time = week.reduce((sum, a) => sum + a.summary.movingTime, 0);
    const longest = week.reduce((max, a) => Math.max(max, a.summary.distance), 0);
    const climb = week.reduce((sum, a) => sum + a.summary.elevationGain, 0);
    rows.push([
      i === 0 ? `${start} (this week, so far)` : start,
      km(distance, 1),
      String(week.length),
      time ? dur(time) : '—',
      longest ? km(longest, 1) : '—',
      `+${Math.round(climb)} m`,
    ]);
  }
  return table(['week (Mon)', 'distance', 'runs', 'time', 'longest', 'climb'], rows);
}

function performance(data: CoachData, now: number): string {
  const lines: string[] = [];
  const runs = predictionRuns(data.activities, predictionWindowStart(now));
  const efforts = collectEfforts(runs, data.efforts);
  const segments = efforts.filter((e) => !e.wholeRun);
  if (segments.length) {
    const best = new Map<number, (typeof segments)[number]>();
    for (const e of segments) {
      const b = best.get(e.distance);
      if (!b || e.time < b.time) best.set(e.distance, e);
    }
    const label = (d: number) => (d === 21097.5 ? 'half marathon' : km(d, d < 1000 ? 1 : 0));
    lines.push(
      `- Best efforts in the last ${DEFAULT_WINDOW_DAYS} days (fastest segment inside a run): ` +
        [...best.values()]
          .sort((a, b) => a.distance - b.distance)
          .map((e) => `${label(e.distance)} ${dur(e.time)} (${pace(e.time / (e.distance / 1000))}, run ${e.activity.id} on ${localDateOf(e.activity.startTime)})`)
          .join('; '),
    );
  }
  const predictions = predictRaces(efforts, runs);
  if (predictions.length) {
    const name: Record<number, string> = { 5000: '5K', 10000: '10K', 21097.5: 'half marathon', 42195: 'marathon' };
    lines.push(
      `- Race predictions (Riegel, from the last ${DEFAULT_WINDOW_DAYS} days): ` +
        predictions
          .map((p) => `${name[p.distance]} ${dur(p.time)} (${pace(p.pace)})${p.caveats.length ? ` [caveats: ${p.caveats.join(', ')}]` : ''}`)
          .join('; '),
    );
  }
  const v = bestVdot(efforts);
  if (v) {
    const p = v.paces;
    lines.push(
      `- VDOT ${v.value.toFixed(1)} (from ${km(v.source.distance)} in ${dur(v.source.time)} on ${localDateOf(v.source.activity.startTime)}). ` +
        `Training paces: easy ${pace(p.easy[0])}–${pace(p.easy[1])}, marathon ${pace(p.marathon)}, threshold ${pace(p.threshold)}, interval ${pace(p.interval)}, repetition ${pace(p.repetition)}`,
    );
  }
  const records = summaryRecords(data.activities.filter(isRun));
  const rec: string[] = [];
  if (records.longest) rec.push(`longest run ${km(records.longest.summary.distance)} on ${localDateOf(records.longest.startTime)}`);
  if (records.fastestPace) {
    const a = records.fastestPace;
    rec.push(`fastest average pace over 5 km+ ${pace(a.summary.avgPace)} (${km(a.summary.distance)} on ${localDateOf(a.startTime)})`);
  }
  if (records.biggestClimb) {
    rec.push(`biggest climb +${Math.round(records.biggestClimb.summary.elevationGain)} m on ${localDateOf(records.biggestClimb.startTime)}`);
  }
  if (rec.length) lines.push(`- All-time: ${rec.join('; ')}`);
  return lines.length ? lines.join('\n') : '- Not enough timed runs for best efforts or predictions.';
}

function load(data: CoachData, now: number): string {
  const r = readiness(data.activities, data.settings, now);
  const s = r.stats;
  const lines: string[] = [];
  const form = formToday(data.activities, data.settings, now);
  lines.push(
    form
      ? `- Form (fitness 42 d − fatigue 7 d, from heart-rate TRIMP): ${form.value.toFixed(1)} (${form.state}; above +5 fresh, below −10 tired)`
      : '- Form: no heart-rate load in the last 42 days',
  );
  lines.push(
    `- Last 7 days ${km(s.acuteDistance, 1)}; average ${km(s.chronicDistance, 1)}/week over 28 days` +
      (s.acwrDistance !== undefined ? ` (acute:chronic ${s.acwrDistance.toFixed(2)})` : '') +
      (s.weeklyChange !== undefined ? `; change vs previous weeks ${(s.weeklyChange * 100).toFixed(0)} %` : ''),
  );
  if (s.loadReliable && s.acwrLoad !== undefined) lines.push(`- Load (TRIMP) acute:chronic ${s.acwrLoad.toFixed(2)}`);
  lines.push(
    `- Training streak ${s.streak} days; rest days ${s.restDays7} in 7 d and ${s.restDays14} in 14 d; hard sessions in 7 d: ${s.hardSessions7}`,
  );
  if (r.alerts.length) {
    lines.push(
      `- Overload alerts (distances in metres, times in seconds, loads in TRIMP): ${r.alerts
        .map((a) => `${a.kind} (${a.severity}: ${Object.entries(a.data).map(([k, v]) => `${k}=${round(v, 2)}`).join(', ')})`)
        .join('; ')}`,
    );
  } else if (r.hasTraining) lines.push('- No overload alerts');
  return lines.join('\n');
}

function plan(data: CoachData, today: string): string {
  const day = planDay(data.plans, data.activePlanId, data.workouts, data.activities, today);
  if (!day) return 'No training plan.';
  const p = day.plan;
  const workouts = data.workouts.filter((w) => w.planId === p.id).sort((a, b) => a.date.localeCompare(b.date));
  const match = matchWorkouts(workouts, data.activities, today);
  const progress = computeProgress(p, workouts, data.activities, match, today);
  const lines = [
    `Active plan "${clip(p.name, 80)}" (id ${p.id}), goal ${p.goal}` +
      (p.raceDate ? `, race on ${p.raceDate}${day.daysToRace !== undefined ? ` (${day.daysToRace} days from today)` : ' (already passed)'}` : ', no race date'),
    `- Progress: ${progress.done} done, ${progress.partial} partial, ${progress.missed} missed, ${progress.skipped} skipped, ${progress.upcoming} to go (of ${progress.total} workouts)` +
      (progress.consistency !== undefined ? `; consistency ${(progress.consistency * 100).toFixed(0)} %` : '') +
      `; ${km(progress.doneTotal, 1)} of ${km(progress.plannedTotal, 1)} planned`,
    `- This week (from ${day.week.start}): ${km(day.week.run, 1)} run of ${km(day.week.planned, 1)} planned; ${day.week.done}/${day.week.total} workouts done`,
  ];
  const result = (w: PlannedWorkout) => match.byWorkout.get(w.id)!;
  const recent = workouts.filter((w) => w.date >= addDays(today, -7) && w.date < today);
  if (recent.length) {
    lines.push('- Last 7 days of the plan:');
    for (const w of recent) lines.push(`  - ${workoutLine(w, result(w).status, result(w).activity)}`);
  }
  for (const r of day.today) lines.push(`- Today: ${workoutLine(r.workout, r.status, r.activity)}`);
  const next = workouts.filter((w) => w.date > today).slice(0, 7);
  if (next.length) {
    lines.push('- Next workouts:');
    for (const w of next) lines.push(`  - ${workoutLine(w)}`);
  }
  const others = data.plans.filter((x) => x.id !== p.id);
  if (others.length) {
    lines.push(`- Other plans: ${others.map((x) => `"${clip(x.name, 60)}" (id ${x.id}, goal ${x.goal}${x.raceDate ? `, race ${x.raceDate}` : ''})`).join('; ')}`);
  }
  lines.push('Use get_training_plan for every workout of a plan.');
  return lines.join('\n');
}

function goals(data: CoachData, now: number): string {
  if (!data.goals.length) return 'No goals.';
  return goalsToday(data.goals, data.activities, now)
    .map(({ goal, progress }) => {
      const value = (n: number) =>
        goal.metric === 'distance' ? km(n, 1) : goal.metric === 'time' ? dur(n) : `${n} runs`;
      return `- ${goal.period}ly ${goal.metric} goal ${value(goal.target)} (${(goal.activityTypes ?? ['run', 'trail-run']).join('/')}): ` +
        `${value(progress.value)} so far (${progress.pct.toFixed(0)} %), ${progress.daysLeft} days left, ${progress.status}`;
    })
    .join('\n');
}

/** The snapshot as Markdown-like text. */
export function buildSnapshot(data: CoachData, now: number, today = localDateOf(now)): string {
  const runs = data.activities.filter(isRun);
  const sorted = [...data.activities].sort((a, b) => b.startTime - a.startTime);
  const first = sorted[sorted.length - 1];
  const sections = [
    `Today: ${today} (${WEEKDAY_NAMES[weekday(today)]}), local time ${when(now).slice(-5)}. Snapshot taken now; use the tools for anything after it or in more detail.`,
    `## Athlete\n${athlete(data.settings)}`,
  ];
  if (!data.activities.length) {
    sections.push('## Activities\nNo activities imported yet.');
  } else {
    sections.push(
      `## Activities\n${data.activities.length} activities (${runs.length} runs) since ${localDateOf(first.startTime)}.`,
      `## Weekly running volume (last ${WEEKS} weeks)\n${weeklyVolume(runs, today)}`,
      `## Latest ${Math.min(RECENT_RUNS, sorted.length)} activities (newest first)\n${table(ACTIVITY_HEADER, sorted.slice(0, RECENT_RUNS).map(activityRow))}`,
      `## Performance\n${performance(data, now)}`,
      `## Load and form\n${load(data, now)}`,
    );
  }
  sections.push(`## Training plan\n${plan(data, today)}`, `## Goals\n${goals(data, now)}`);
  return sections.join('\n\n');
}
