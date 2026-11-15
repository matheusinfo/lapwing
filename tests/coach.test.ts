import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Activity } from '../src/data/types';
import type { CoachMessage, CoachReply } from '../src/screens/coach/api';
import { buildSnapshot, type CoachData } from '../src/screens/coach/context';
import { displayTurns, runTurn } from '../src/screens/coach/conversation';
import { renderMarkdown } from '../src/screens/coach/markdown';
import { routeProfile } from '../src/screens/coach/tools';
import type { PlannedWorkout, TrainingPlan } from '../src/screens/training/types';
import type { Coord } from '../src/types';

// ---- Markdown ----

describe('renderMarkdown', () => {
  it('escapes HTML in the text', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> & **<b>bold</b>**');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>');
  });

  it('renders headings, lists, emphasis, code and safe links only', () => {
    const html = renderMarkdown(
      '## Plano\n\n- **5 km** leve\n- *tiros* `6x400`\n  - detalhe\n\n1. um\n2. dois\n\n[site](https://example.com) [x](javascript:alert(1))',
    );
    expect(html).toContain('<h4>Plano</h4>');
    expect(html).toContain('<ul><li><strong>5 km</strong> leve</li><li><em>tiros</em> <code>6x400</code><ul><li>detalhe</li></ul></li></ul>');
    expect(html).toContain('<ol><li>um</li><li>dois</li></ol>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
    expect(html).not.toContain('href="javascript');
  });

  it('renders tables, also while the last row is still streaming', () => {
    const html = renderMarkdown('| km | pace |\n|---|---:|\n| 1 | 5:30 |\n| 2 | 5:2');
    expect(html).toContain('<thead><tr><th>km</th><th style="text-align:right">pace</th></tr></thead>');
    expect(html).toContain('<tr><td>1</td><td style="text-align:right">5:30</td></tr>');
    expect(html).toContain('<td style="text-align:right">5:2</td>');
  });

  it('keeps line breaks inside a paragraph and closes an open code fence', () => {
    expect(renderMarkdown('linha 1\nlinha 2')).toBe('<p>linha 1<br>linha 2</p>');
    expect(renderMarkdown('```\nconst a = 1;')).toBe('<pre><code>const a = 1;</code></pre>');
  });
});

// ---- Conversation ----

const assistant = (content: CoachReply['content']): CoachMessage => ({ role: 'assistant', content });
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as CoachReply['content'][number];
const thinking = { type: 'thinking', thinking: '', signature: 'sig' } as CoachReply['content'][number];
const toolUse = (id: string, name: string, input: unknown = {}) =>
  ({ type: 'tool_use', id, name, input }) as CoachReply['content'][number];

describe('displayTurns', () => {
  it('groups an answer across tool rounds and hides thinking and tool results', () => {
    const messages: CoachMessage[] = [
      { role: 'user', content: 'Como foi minha semana?' },
      assistant([thinking, text('Vou olhar.'), toolUse('t1', 'list_runs')]),
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '3 runs' }] },
      assistant([thinking, text('Foi boa.')]),
      { role: 'user', content: 'E hoje?' },
    ];
    expect(displayTurns(messages)).toEqual([
      { role: 'user', text: 'Como foi minha semana?', tools: [] },
      { role: 'coach', text: 'Vou olhar.\n\nFoi boa.', tools: ['list_runs'] },
      { role: 'user', text: 'E hoje?', tools: [] },
    ]);
  });
});

describe('runTurn', () => {
  const question: CoachMessage[] = [{ role: 'user', content: 'Simule minha prova' }];

  it('runs tools until the coach answers, appending every message', async () => {
    const replies: CoachReply[] = [
      { content: [thinking, toolUse('a', 'get_current_route'), toolUse('b', 'list_runs', { limit: 5 })], stop_reason: 'tool_use' },
      { content: [thinking, text('Tempo previsto: 1:52.')], stop_reason: 'end_turn' },
    ];
    const sent: CoachMessage[][] = [];
    const calls: [string, unknown][] = [];
    const steps: number[] = [];
    const result = await runTurn(question, {
      send: async (m) => {
        sent.push(m);
        return replies.shift()!;
      },
      runTool: async (name, input) => {
        calls.push([name, input]);
        return name === 'list_runs' ? { content: 'bad', isError: true } : { content: 'route' };
      },
      onStep: (m) => steps.push(m.length),
    });
    expect(result.outcome).toBe('done');
    expect(calls).toEqual([
      ['get_current_route', {}],
      ['list_runs', { limit: 5 }],
    ]);
    expect(result.messages).toHaveLength(4);
    // Both results go back in one user message, errors flagged.
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'route' },
        { type: 'tool_result', tool_use_id: 'b', content: 'bad', is_error: true },
      ],
    });
    // The assistant content is kept exactly as returned (thinking included).
    expect((result.messages[1].content as unknown[])[0]).toBe(thinking);
    expect(sent[0]).toBe(question);
    expect(sent[1]).toEqual(result.messages.slice(0, 3));
    expect(steps).toEqual([3]);
  });

  it('reports refusals, cut answers and too many tool rounds', async () => {
    const once = (reply: CoachReply) => ({ send: async () => reply, runTool: async () => ({ content: '' }) });
    expect((await runTurn(question, once({ content: [], stop_reason: 'refusal' }))).outcome).toBe('refused');
    expect((await runTurn(question, once({ content: [text('a')], stop_reason: 'max_tokens' }))).outcome).toBe('truncated');
    const loop = await runTurn(question, once({ content: [toolUse('x', 'list_runs')], stop_reason: 'tool_use' }), undefined, 3);
    expect(loop.outcome).toBe('too_many_steps');
    expect(loop.messages).toHaveLength(7);
  });

  it('does not run tools when the answer was cut in the middle of a call', async () => {
    let ran = false;
    const result = await runTurn(question, {
      send: async () => ({ content: [toolUse('x', 'list_runs')], stop_reason: 'max_tokens' }),
      runTool: async () => {
        ran = true;
        return { content: '' };
      },
    });
    expect(ran).toBe(false);
    expect(result.outcome).toBe('truncated');
  });

  it('lets errors through so the caller keeps the old messages', async () => {
    await expect(
      runTurn(question, {
        send: async () => {
          throw new Error('offline');
        },
        runTool: async () => ({ content: '' }),
      }),
    ).rejects.toThrow('offline');
  });
});

// ---- Route profile ----

describe('routeProfile', () => {
  // ~111 m per 0.001° of latitude: a straight line north.
  const line = (eles: number[], stepDeg = 0.001): Coord[] => eles.map((e, i) => [0, i * stepDeg, e]);

  it('gives one row per km with elevation, climb, descent and grade', () => {
    // 28 steps of ~111 m ≈ 3.11 km: climb 50 m in the first km, flat, then down.
    const eles = Array.from({ length: 29 }, (_, i) => (i <= 9 ? 500 + (i * 50) / 9 : i <= 18 ? 550 : 550 - (i - 18) * 3));
    const rows = routeProfile(line(eles));
    expect(rows).toHaveLength(4);
    expect(rows[0][0]).toBe('0–1');
    expect(rows[0][1]).toMatch(/^500 → 5\d\d m$/);
    expect(rows[0][2]).toMatch(/^\+\d+ m$/);
    expect(Number.parseInt(rows[0][2].slice(1), 10)).toBeGreaterThan(40);
    expect(rows[1][4]).toMatch(/^\+[0-9.]+ %$/);
    expect(rows[2][3]).toMatch(/^−\d+ m$/);
    expect(rows[3][0]).toMatch(/^3–3\.\d\d$/);
    expect(rows[3][4].startsWith('-')).toBe(true);
  });

  it('copes with a route without elevation', () => {
    const rows = routeProfile([
      [0, 0],
      [0, 0.02],
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].slice(1)).toEqual(['—', '+0 m', '−0 m', '—']);
  });
});

// ---- Snapshot ----

const at = (date: string, hour = 7) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const TODAY = '2026-11-11';
const NOW = at(TODAY, 18);

let n = 0;
function act(date: string, km: number, extra: Partial<Activity> = {}): Activity {
  const movingTime = km * 330;
  return {
    id: `a${++n}`,
    name: `Run | ${n}`,
    type: 'run',
    startTime: at(date),
    hasStartTime: true,
    fileName: 'x.gpx',
    importedAt: 0,
    summary: {
      distance: km * 1000,
      elapsedTime: movingTime,
      movingTime,
      avgPace: 330,
      elevationGain: 40,
      elevationLoss: 40,
      avgHr: 150,
      maxHr: 170,
      has: { time: true, ele: true, hr: true, cad: false, temp: false, power: false },
      bounds: [
        [0, 0],
        [0, 0],
      ],
    },
    ...extra,
  };
}

function data(extra: Partial<CoachData> = {}): CoachData {
  return {
    activities: [],
    settings: { ...DEFAULT_SETTINGS, paceZoneStarts: [390, 345, 315, 290] },
    plans: [],
    workouts: [],
    goals: [],
    efforts: new Map(),
    activePlanId: null,
    ...extra,
  };
}

describe('buildSnapshot', () => {
  it('says what is missing when there is no data', () => {
    const s = buildSnapshot(data(), NOW, TODAY);
    expect(s).toContain('Today: 2026-11-11 (Wednesday)');
    expect(s).toContain('No activities imported yet.');
    expect(s).toContain('No training plan.');
    expect(s).toContain('No goals.');
    expect(s).toContain('Pace zones: Z1 slower than 6:30/km');
  });

  it('sums up runs, weeks, predictions, the plan and goals', () => {
    const activities = [act('2026-11-10', 10), act('2026-11-08', 21.1), act('2026-11-04', 5), act('2026-10-01', 8)];
    const plan: TrainingPlan = { id: 'p1', name: 'Meia', goal: 'half', raceDate: '2026-12-06', createdAt: 0 };
    const workouts: PlannedWorkout[] = [
      { id: 'w1', planId: 'p1', date: '2026-11-10', kind: 'easy', title: '', distance: 10000 },
      { id: 'w2', planId: 'p1', date: '2026-11-12', kind: 'tempo', title: 'Limiar', distance: 8000, pace: 290 },
    ];
    const efforts = new Map([[activities[0].id, { 1000: 280, 5000: 1500, 10000: 3200 }]]);
    const s = buildSnapshot(
      data({
        activities,
        plans: [plan],
        workouts,
        efforts,
        goals: [{ id: 'g1', period: 'week', metric: 'distance', target: 30000, createdAt: 0 }],
      }),
      NOW,
      TODAY,
    );
    expect(s).toContain('4 activities (4 runs) since 2026-10-01');
    expect(s).toContain('| 2026-11-09 (this week, so far) | 10.0 km | 1 |');
    // Pipes in names can't break the table.
    expect(s).toContain('Run / 1');
    expect(s).toMatch(/Race predictions .*5K/);
    expect(s).toMatch(/VDOT \d+\.\d/);
    expect(s).toContain('Active plan "Meia" (id p1), goal half, race on 2026-12-06 (25 days from today)');
    expect(s).toContain('2026-11-12 Thu · tempo · Limiar · 8.00 km @ 4:50/km');
    expect(s).toContain('2026-11-10 Tue · easy · 10.00 km · done');
    expect(s).toMatch(/weekly distance goal 30\.0 km .*: 10\.0 km so far/);
    expect(s).toContain('longest run 21.10 km on 2026-11-08');
  });
});
