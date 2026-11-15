import Anthropic from '@anthropic-ai/sdk';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildParams,
  createCoachHandler,
  DEFAULT_CONFIG,
  errorCode,
  parseChatRequest,
  RequestError,
  type CoachConfig,
  type CoachStream,
  type StreamParams,
} from '../coach/app';
import { COACH_TOOLS } from '../coach/prompt';

const question = { role: 'user', content: 'Como foi minha semana?' };

/** A fake SDK stream: emits the given text pieces, then resolves with `message`. */
function fakeStream(texts: string[], message: Partial<Anthropic.Beta.BetaMessage>, fail?: Error): CoachStream {
  const handlers: { text: ((t: string) => void)[]; streamEvent: ((e: Anthropic.Beta.BetaRawMessageStreamEvent) => void)[] } = {
    text: [],
    streamEvent: [],
  };
  return {
    on(event: 'text' | 'streamEvent', fn: never) {
      handlers[event].push(fn);
      return this;
    },
    async finalMessage() {
      await Promise.resolve();
      for (const t of texts) handlers.text.forEach((fn) => fn(t));
      for (const block of message.content ?? []) {
        if (block.type === 'tool_use') {
          handlers.streamEvent.forEach((fn) =>
            fn({ type: 'content_block_start', index: 0, content_block: block } as Anthropic.Beta.BetaRawMessageStreamEvent),
          );
        }
      }
      if (fail) throw fail;
      return { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {}, ...message } as Anthropic.Beta.BetaMessage;
    },
  } as CoachStream;
}

let server: Server | undefined;

async function start(config: Partial<CoachConfig>): Promise<string> {
  const handle = createCoachHandler({ ...DEFAULT_CONFIG, ...config });
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/coach/chat`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

const lines = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('parseChatRequest', () => {
  it('accepts a conversation that starts and ends with the athlete', () => {
    const req = parseChatRequest({ messages: [question], context: 'snapshot', lang: 'en' });
    expect(req).toEqual({ messages: [question], context: 'snapshot', lang: 'en' });
    expect(parseChatRequest({ messages: [question] })).toMatchObject({ context: '', lang: 'pt-BR' });
  });

  it('rejects malformed requests', () => {
    const bad = [
      null,
      [],
      { messages: [] },
      { messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user' }] },
      { messages: [{ role: 'assistant', content: 'x' }] },
      { messages: [question, { role: 'assistant', content: 'x' }] },
      { messages: [question], context: 42 },
      { messages: [question], lang: 'fr' },
    ];
    for (const body of bad) expect(() => parseChatRequest(body), JSON.stringify(body)).toThrow(RequestError);
  });
});

describe('buildParams', () => {
  it('fixes model, thinking, effort, tools and puts the snapshot after the instructions', () => {
    const params = buildParams({ messages: [question] as never, context: 'Today: 2026-11-15', lang: 'pt-BR' }, {
      ...DEFAULT_CONFIG,
    });
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.tools).toBe(COACH_TOOLS);
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
    const system = params.system as { text: string }[];
    expect(system).toHaveLength(2);
    expect(system[1].text).toContain('Brazilian Portuguese');
    expect(system[1].text).toContain('Today: 2026-11-15');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect((params as StreamParams & { fallbacks?: unknown }).fallbacks).toBe('default');
  });

  it('leaves fallbacks out when disabled', () => {
    const params = buildParams({ messages: [question] as never, context: '', lang: 'en' }, { ...DEFAULT_CONFIG, fallbacks: false });
    expect(params.betas).toBeUndefined();
    expect(params.system).toEqual([expect.anything(), expect.objectContaining({ text: expect.stringContaining('No data') })]);
  });

  it('declares tools with strict-enough schemas', () => {
    expect(COACH_TOOLS.map((t) => t.name)).toEqual(['list_runs', 'get_run_details', 'get_training_plan', 'get_current_route']);
    for (const tool of COACH_TOOLS) expect(tool.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
  });
});

describe('errorCode', () => {
  it('maps SDK errors to short codes', () => {
    const headers = new Headers();
    expect(errorCode(new Anthropic.AuthenticationError(401, undefined, 'bad key', headers)).code).toBe('auth');
    expect(errorCode(new Anthropic.RateLimitError(429, undefined, 'slow down', headers)).code).toBe('rate_limit');
    expect(errorCode(new Anthropic.InternalServerError(529, undefined, 'overloaded', headers)).code).toBe('overloaded');
    expect(errorCode(new Anthropic.APIConnectionError({ message: 'offline' })).code).toBe('network');
    expect(errorCode(new Error('boom'))).toEqual({ code: 'api', message: 'boom' });
    const noWorkspace = new Anthropic.BadRequestError(400, undefined, 'must include the anthropic-workspace-id header', headers);
    expect(errorCode(noWorkspace).code).toBe('workspace');
    expect(errorCode(new Anthropic.BadRequestError(400, undefined, 'bad tool', headers)).code).toBe('bad_request');
  });
});

describe('coach HTTP server', () => {
  it('reports status and health', async () => {
    const base = await start({});
    expect(await (await fetch(`${base}/api/coach/status`)).json()).toEqual({
      app: 'lapwing-coach',
      configured: false,
      model: 'claude-opus-5-5',
    });
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok\n');
    expect((await fetch(`${base}/api/other`)).status).toBe(404);
    expect((await fetch(`${base}/api/coach/chat`)).status).toBe(405);
  });

  it('answers 503 without an API key', async () => {
    const base = await start({});
    const res = await post(base, { messages: [question] });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not_configured' });
  });

  it('streams text, tool calls and the final message as NDJSON', async () => {
    let seen: StreamParams | undefined;
    const toolUse = { type: 'tool_use', id: 'tu_1', name: 'list_runs', input: {} } as Anthropic.Beta.BetaToolUseBlock;
    const base = await start({
      startStream: (params) => {
        seen = params;
        return fakeStream(['Vou ', 'olhar.'], { content: [toolUse], stop_reason: 'tool_use' });
      },
    });
    const res = await post(base, { messages: [question], context: 'snap', lang: 'pt-BR' });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const events = await lines(res);
    expect(events.slice(0, 3)).toEqual([
      { t: 'text', text: 'Vou ' },
      { t: 'text', text: 'olhar.' },
      { t: 'tool', name: 'list_runs' },
    ]);
    expect(events[3]).toMatchObject({ t: 'done', message: { content: [toolUse], stop_reason: 'tool_use' } });
    expect(seen?.messages).toEqual([question]);
  });

  it('reports API failures as an error line', async () => {
    const base = await start({
      startStream: () => fakeStream([], {}, new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers())),
    });
    const events = await lines(await post(base, { messages: [question] }));
    expect(events).toEqual([{ t: 'error', code: 'auth', message: expect.stringContaining('invalid x-api-key') }]);
  });

  it('rejects bad JSON, bad shapes and bodies over the limit', async () => {
    const base = await start({ startStream: () => fakeStream([], { content: [] }), maxBodyBytes: 200 });
    expect((await post(base, '{nope')).status).toBe(400);
    expect((await post(base, { messages: [] })).status).toBe(400);
    const big = await post(base, { messages: [{ role: 'user', content: 'x'.repeat(500) }] });
    expect(big.status).toBe(413);
  });

  it('limits requests per minute', async () => {
    const base = await start({ startStream: () => fakeStream(['ok'], { content: [] }), ratePerMinute: 2 });
    expect((await post(base, { messages: [question] })).status).toBe(200);
    expect((await post(base, { messages: [question] })).status).toBe(200);
    const third = await post(base, { messages: [question] });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: 'busy' });
  });
});
