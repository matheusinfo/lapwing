/**
 * HTTP handler of the coach server (see server.ts for the entry point).
 *
 * The browser owns the conversation: it sends the whole message history plus
 * a snapshot of the athlete's data, runs the tools itself and calls again with
 * the results. This server holds the API key, fixes the model, instructions
 * and tools, enforces limits and streams the answer back as NDJSON:
 *
 *   GET  /api/coach/status  -> {app, configured, model}
 *   POST /api/coach/chat    {messages, context, lang} -> NDJSON lines:
 *        {"t":"text","text":"…"}          answer text as it is written
 *        {"t":"tool","name":"list_runs"}  the model started a tool call
 *        {"t":"done","message":{…}}       final message (content, stop_reason, usage)
 *        {"t":"error","code":"…","message":"…"}
 *   GET  /healthz           -> ok
 */
import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COACH_INSTRUCTIONS, COACH_TOOLS } from './prompt';

export const PREFIX = '/api/coach';
export const APP = 'lapwing-coach';

export type Effort = NonNullable<Anthropic.Beta.BetaOutputConfig['effort']>;
export type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

/** The part of the SDK's message stream this server uses (easy to fake in tests). */
export interface CoachStream {
  on(event: 'text', fn: (delta: string) => void): unknown;
  on(event: 'streamEvent', fn: (event: Anthropic.Beta.BetaRawMessageStreamEvent) => void): unknown;
  finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
}

export interface CoachConfig {
  /** Starts one streamed request; undefined when no API key is configured. */
  startStream?: (params: StreamParams, signal: AbortSignal) => CoachStream;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Server-side fallback to another model when this one declines a request. */
  fallbacks: boolean;
  /** Chat requests accepted per minute (all clients together). */
  ratePerMinute: number;
  /** Chat requests running at the same time. */
  maxConcurrent: number;
  maxBodyBytes: number;
}

export const DEFAULT_CONFIG: Omit<CoachConfig, 'startStream'> = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  maxTokens: 64000,
  fallbacks: true,
  ratePerMinute: 20,
  maxConcurrent: 3,
  maxBodyBytes: 4 * 1024 * 1024,
};

const MAX_MESSAGES = 400;
const MAX_CONTEXT_CHARS = 200_000;
const LANGS = new Set(['pt-BR', 'en']);

export interface ChatRequest {
  messages: Anthropic.Beta.BetaMessageParam[];
  context: string;
  lang: string;
}

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks the shape of a chat request. Message contents are passed through as
 * they are (the API validates them); the history must start and end with the
 * athlete (`user`).
 */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!isObject(body)) throw new RequestError(400, 'bad_request', 'Body must be a JSON object.');
  const { messages, context, lang } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new RequestError(400, 'bad_request', `messages must hold 1–${MAX_MESSAGES} items.`);
  }
  for (const m of messages) {
    if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant')) {
      throw new RequestError(400, 'bad_request', 'Each message needs role "user" or "assistant".');
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      throw new RequestError(400, 'bad_request', 'Each message needs content (text or blocks).');
    }
  }
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    throw new RequestError(400, 'bad_request', 'The conversation must start and end with a user message.');
  }
  if (context !== undefined && (typeof context !== 'string' || context.length > MAX_CONTEXT_CHARS)) {
    throw new RequestError(400, 'bad_request', `context must be text up to ${MAX_CONTEXT_CHARS} characters.`);
  }
  if (lang !== undefined && (typeof lang !== 'string' || !LANGS.has(lang))) {
    throw new RequestError(400, 'bad_request', 'lang must be "pt-BR" or "en".');
  }
  return {
    messages: messages as Anthropic.Beta.BetaMessageParam[],
    context: (context as string | undefined) ?? '',
    lang: (lang as string | undefined) ?? 'pt-BR',
  };
}

/** The API request for one turn: fixed instructions and tools, then the snapshot. */
export function buildParams(req: ChatRequest, config: CoachConfig): StreamParams {
  const language = req.lang === 'en' ? 'English' : 'Brazilian Portuguese (pt-BR)';
  const snapshot = `# Athlete snapshot\n\nLanguage: ${language}\n\n${req.context.trim() || '(No data was sent.)'}`;
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort },
    // Caches the conversation so far; the instructions, tools and snapshot
    // stay identical for the whole conversation.
    cache_control: { type: 'ephemeral' },
    system: [
      { type: 'text', text: COACH_INSTRUCTIONS },
      { type: 'text', text: snapshot },
    ],
    tools: COACH_TOOLS,
    messages: req.messages,
    ...(config.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}

/** Maps an SDK error to a short code the app translates. */
export function errorCode(err: unknown): { code: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { code: 'auth', message };
  }
  if (err instanceof Anthropic.RateLimitError) return { code: 'rate_limit', message };
  if (err instanceof Anthropic.APIConnectionError) return { code: 'network', message };
  if (err instanceof Anthropic.InternalServerError) return { code: 'overloaded', message };
  if (err instanceof Anthropic.BadRequestError) {
    // A user key without ANTHROPIC_WORKSPACE_ID.
    if (message.includes('anthropic-workspace-id')) return { code: 'workspace', message };
    return { code: 'bad_request', message };
  }
  return { code: 'api', message };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new RequestError(413, 'too_large', 'Request body is too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new RequestError(413, 'too_large', 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'bad_request', 'Body is not valid JSON.');
  }
}

/** Creates the request handler. `now` is injectable for the rate-limit tests. */
export function createCoachHandler(config: CoachConfig, now: () => number = Date.now) {
  const recent: number[] = [];
  let running = 0;

  function admit(): void {
    const t = now();
    while (recent.length && t - recent[0] >= 60_000) recent.shift();
    if (recent.length >= config.ratePerMinute || running >= config.maxConcurrent) {
      throw new RequestError(429, 'busy', 'Too many requests to the coach. Try again in a minute.');
    }
    recent.push(t);
  }

  async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!config.startStream) {
      throw new RequestError(503, 'not_configured', 'The coach has no API key (ANTHROPIC_API_KEY).');
    }
    const body = parseChatRequest(await readJson(req, config.maxBodyBytes));
    admit();

    running++;
    const abort = new AbortController();
    // The browser left (or pressed stop): stop paying for tokens nobody reads.
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Tell nginx not to buffer: every line goes out as soon as it is written.
      'X-Accel-Buffering': 'no',
    });
    const send = (event: Record<string, unknown>) => {
      if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
    };

    try {
      const stream = config.startStream(buildParams(body, config), abort.signal);
      stream.on('text', (text) => send({ t: 'text', text }));
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          send({ t: 'tool', name: event.content_block.name });
        }
      });
      const message = await stream.finalMessage();
      send({
        t: 'done',
        message: {
          content: message.content,
          stop_reason: message.stop_reason,
          stop_details: message.stop_details ?? null,
          model: message.model,
          usage: message.usage,
        },
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      const { code, message } = errorCode(err);
      console.error(`coach: ${code}: ${message}`);
      send({ t: 'error', code, message });
    } finally {
      running--;
      res.end();
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok\n');
      } else if (req.method === 'GET' && path === `${PREFIX}/status`) {
        sendJson(res, 200, { app: APP, configured: Boolean(config.startStream), model: config.model });
      } else if (path === `${PREFIX}/chat`) {
        if (req.method !== 'POST') throw new RequestError(405, 'method', 'Use POST.');
        await chat(req, res);
      } else {
        throw new RequestError(404, 'not_found', 'Not found.');
      }
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof RequestError) {
        sendJson(res, err.status, { code: err.code, message: err.message });
      } else {
        console.error('coach: unexpected error', err);
        sendJson(res, 500, { code: 'internal', message: 'Internal error.' });
      }
    }
  };
}
