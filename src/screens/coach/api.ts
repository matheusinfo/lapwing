/**
 * Client of the coach server (coach/app.ts), served by this site under
 * /api/coach/. Static hosts don't have it: `coachStatus` then says
 * `available: false`.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type CoachMessage = Anthropic.Beta.BetaMessageParam;
export type CoachBlock = Anthropic.Beta.BetaContentBlock;

/** The final assistant message of one request. */
export interface CoachReply {
  content: CoachBlock[];
  stop_reason: Anthropic.Beta.BetaStopReason | null;
}

export interface CoachStatus {
  /** A coach server answered. */
  available: boolean;
  /** It has an API key. */
  configured: boolean;
}

export class CoachError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Relative to the page, so it also works when the app lives in a subfolder. */
const url = (path: string) => `api/coach/${path}`;

export async function coachStatus(signal?: AbortSignal): Promise<CoachStatus> {
  try {
    const res = await fetch(url('status'), { signal, cache: 'no-store' });
    if (!res.ok) return { available: false, configured: false };
    const body = (await res.json()) as { app?: string; configured?: boolean };
    if (body.app !== 'lapwing-coach') return { available: false, configured: false };
    return { available: true, configured: Boolean(body.configured) };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { available: false, configured: false };
  }
}

export interface StreamHandlers {
  /** A piece of the answer text. */
  onText?: (text: string) => void;
  /** The model started calling a tool. */
  onTool?: (name: string) => void;
}

type Line =
  | { t: 'text'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; message: CoachReply }
  | { t: 'error'; code: string; message: string };

/**
 * Sends one request and reads the NDJSON stream until the final message.
 * Throws CoachError (or the AbortError of `signal`).
 */
export async function streamChat(
  body: { messages: CoachMessage[]; context: string; lang: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<CoachReply> {
  let res: Response;
  try {
    res = await fetch(url('chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new CoachError('network', String(err));
  }
  if (!res.ok || !res.body) {
    let code = res.status === 404 ? 'not_configured' : 'api';
    let message = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { code?: string; message?: string };
      code = err.code ?? code;
      message = err.message ?? message;
    } catch {
      // Not JSON (e.g. a proxy error page).
    }
    throw new CoachError(code, message);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let reply: CoachReply | undefined;
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const line = JSON.parse(raw) as Line;
    if (line.t === 'text') handlers.onText?.(line.text);
    else if (line.t === 'tool') handlers.onTool?.(line.name);
    else if (line.t === 'done') reply = line.message;
    else if (line.t === 'error') throw new CoachError(line.code, line.message);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer);
  } catch (err) {
    if (signal?.aborted || err instanceof CoachError) throw err;
    throw new CoachError('network', String(err));
  }
  if (!reply) throw new CoachError('network', 'The answer ended before it was complete.');
  return reply;
}
