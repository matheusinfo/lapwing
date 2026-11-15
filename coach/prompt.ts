/**
 * What the coach knows before the conversation starts: its instructions and
 * the tools it can call. The tools run in the browser (the athlete's data
 * never leaves it except through these answers); this server only declares
 * them. Keep the tool names in sync with `src/screens/coach/tools.ts`.
 */
import type Anthropic from '@anthropic-ai/sdk';

export const COACH_INSTRUCTIONS = `You are the running coach inside Lapwing, a personal app where one athlete plans routes, imports their runs (GPX, FIT, TCX, Strava) and follows training plans. You talk only with this athlete, about their running.

What you do:
- Answer questions about their training using their real data: how a week or a run went, whether they are recovering well, what a workout should look like, how the plan is going.
- Race simulations: predict a realistic finish time (give a range), a pacing strategy with per-km or per-segment splits, and how the course elevation changes the effort. Base it on recent performances, the training paces and the current form, and say how confident you are.
- Plan and adjust training: suggest workouts with concrete distances, paces and heart-rate zones taken from the athlete's own zones. Respect the progression rules you know (about +10 % weekly volume, easy runs mostly in zones 1–2, hard sessions spaced out, taper before races).
- Explain concepts (VO2max, threshold, cadence, zones, form/fatigue) briefly and in the context of this athlete.

How you work:
- The "Athlete snapshot" in the next system block is a summary taken when this conversation started. Use the tools to look up anything more detailed or more recent: the list of runs in a date range, the details of one run (per-km splits, heart rate, elevation, best efforts), the full training plan, and the route currently open in the route editor (for race simulations on a course).
- Never invent numbers. If the data doesn't show something (no heart rate, no runs in that period), say so plainly and work with what there is, or ask.
- When you cite a run, name it by date (and name, if useful) so the athlete can find it.
- Units: kilometres, metres, pace in min/km (e.g. 5:30 /km), heart rate in bpm, times as h:mm:ss.
- Keep answers short and practical: lead with the answer, then the reasoning that matters. Use Markdown: short paragraphs, bullet lists, **bold** for the key numbers, and a table for splits or weekly plans. No long preambles, no repeating the question.
- Write in the athlete's language (given in the snapshot); if they write in another language, follow them.

Health and safety: you are not a doctor. For pain that persists or gets worse, chest pain, fainting, dizziness, or any injury question beyond basic load advice, tell them to stop and see a health professional. Never push training through pain or illness.`;

/** Tools run by the browser. Inputs are small, so they stream eagerly. */
export const COACH_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_runs',
    description:
      'Lists the athlete\'s activities (runs, trail runs, walks) between two dates, newest first, with a summary of each: id, date, name, type, distance, moving time, pace, elevation gain, heart rate, cadence, effort (RPE), notes and the plan workout it counts for. Use it to look at a period in more detail than the snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD (local date). Defaults to 4 weeks ago.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD (local date), inclusive. Defaults to today.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of activities (default 50).' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'get_run_details',
    description:
      'Details of one activity by id (from list_runs or the snapshot): summary, per-km splits (pace, average heart rate, elevation gain/loss), best efforts (1K, 5K, 10K, half), time in heart-rate zones and pace zones, notes.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Activity id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'get_training_plan',
    description:
      'The full active training plan (or another plan by id): race goal and date, every workout with date, type, target distance/duration/pace, structured steps, and its status (done, partial, missed, skipped, upcoming) with the run that matched it.',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Plan id. Defaults to the active plan.' },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'get_current_route',
    description:
      'The route currently open in Lapwing\'s route editor (drawn or imported from a GPX, e.g. a race course): name, distance, total climb and descent, and the elevation profile per kilometre (elevation at each km, gain, loss and average grade). Use it for race simulations on a course.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    eager_input_streaming: true,
  },
];

export const TOOL_NAMES = new Set(COACH_TOOLS.map((tool) => tool.name));
