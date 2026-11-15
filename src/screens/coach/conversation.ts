/**
 * The conversation with the coach: stored in this browser only, sent whole to
 * the coach server on each question (the API is stateless). Messages are kept
 * exactly as the API returned them (thinking blocks included) and only ever
 * appended to, which is what the model needs to keep its reasoning across turns.
 */
import type { CoachMessage, CoachReply } from './api';
import type { ToolResult } from './tools';

/** Outside `lapwing:` on purpose: conversations don't go into backups. */
export const STORAGE_KEY = 'lapwing-coach:conversation';
/** Tool rounds allowed for one question before giving up. */
export const MAX_STEPS = 8;

export interface Conversation {
  version: 1;
  /** Athlete snapshot sent with every request of this conversation. */
  context: string;
  createdAt: number;
  messages: CoachMessage[];
}

export function loadConversation(): Conversation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Conversation;
    return c?.version === 1 && Array.isArray(c.messages) && typeof c.context === 'string' ? c : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store it (quota, private mode). */
export function saveConversation(c: Conversation): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export function clearConversation(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}

// ---- What the screen shows ----

export interface Turn {
  role: 'user' | 'coach';
  text: string;
  /** Tools the coach used in this turn, in order. */
  tools: string[];
}

const textOf = (content: CoachMessage['content']): string =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((b) => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n\n');

const isToolResults = (m: CoachMessage) =>
  Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === 'tool_result');

/**
 * The messages as chat bubbles: the athlete's questions, and one coach
 * bubble per answer (its text across tool rounds, plus which tools it used).
 * Thinking blocks and tool results are not shown.
 */
export function displayTurns(messages: CoachMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (isToolResults(m)) continue;
      turns.push({ role: 'user', text: textOf(m.content), tools: [] });
      continue;
    }
    let turn = turns[turns.length - 1];
    if (!turn || turn.role !== 'coach') {
      turn = { role: 'coach', text: '', tools: [] };
      turns.push(turn);
    }
    const text = textOf(m.content);
    if (text) turn.text = turn.text ? `${turn.text}\n\n${text}` : text;
    if (Array.isArray(m.content)) {
      for (const b of m.content) if (b.type === 'tool_use') turn.tools.push(b.name);
    }
  }
  return turns;
}

// ---- One question, with its tool rounds ----

export type TurnOutcome = 'done' | 'refused' | 'truncated' | 'too_many_steps';

export interface TurnDeps {
  /** Sends the conversation and returns the coach's message (streams text on the side). */
  send: (messages: CoachMessage[], signal?: AbortSignal) => Promise<CoachReply>;
  runTool: (name: string, input: unknown) => Promise<ToolResult>;
  /** Called after each round with the messages so far (to save them). */
  onStep?: (messages: CoachMessage[]) => void;
}

/**
 * Asks until the coach stops calling tools. `messages` must end with the
 * athlete's question. Returns the new messages (the input plus everything
 * appended). Throws what `send` throws; the caller then keeps the old messages.
 */
export async function runTurn(
  messages: CoachMessage[],
  deps: TurnDeps,
  signal?: AbortSignal,
  maxSteps = MAX_STEPS,
): Promise<{ messages: CoachMessage[]; outcome: TurnOutcome }> {
  let current = messages;
  for (let step = 0; step < maxSteps; step++) {
    const reply = await deps.send(current, signal);
    current = [...current, { role: 'assistant', content: reply.content }];
    if (reply.stop_reason === 'tool_use') {
      const calls = reply.content.filter((b) => b.type === 'tool_use');
      const results = await Promise.all(
        calls.map(async (call) => {
          const r = await deps.runTool(call.name, call.input);
          return {
            type: 'tool_result' as const,
            tool_use_id: call.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          };
        }),
      );
      signal?.throwIfAborted();
      current = [...current, { role: 'user', content: results }];
      deps.onStep?.(current);
      continue;
    }
    if (reply.stop_reason === 'pause_turn') {
      deps.onStep?.(current);
      continue;
    }
    const outcome: TurnOutcome =
      reply.stop_reason === 'refusal' ? 'refused' : reply.stop_reason === 'max_tokens' ? 'truncated' : 'done';
    return { messages: current, outcome };
  }
  return { messages: current, outcome: 'too_many_steps' };
}
