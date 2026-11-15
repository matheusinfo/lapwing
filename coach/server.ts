/**
 * Lapwing coach server: a small Node HTTP server that talks to Claude for the
 * Coach screen, so the API key never reaches the browser.
 *
 *   npm run coach            # development: reads .env, listens on 127.0.0.1:8001
 *   npm run build:coach      # bundles it into coach/dist/server.mjs (no node_modules needed)
 *   node coach/dist/server.mjs
 *
 * Environment:
 *   ANTHROPIC_API_KEY  required for the coach to answer (without it /status says configured: false)
 *   ANTHROPIC_AUTH_TOKEN  alternative to the key, sent as a Bearer token
 *   COACH_PORT         default 8001          COACH_HOST   default 127.0.0.1 (0.0.0.0 in Docker)
 *   COACH_MODEL        default claude-opus-5-5
 *   COACH_EFFORT       low | medium | high | xhigh | max (default medium)
 *   COACH_MAX_TOKENS   default 64000         COACH_RATE_PER_MIN  default 20
 *   COACH_FALLBACKS    "off" disables the server-side fallback model
 *
 * It has no login of its own: serve it only behind the app's web server, under
 * /api/coach/, and behind something that authenticates (e.g. Cloudflare
 * Access). Anyone who can reach it can spend the API key.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { createCoachHandler, DEFAULT_CONFIG, type CoachConfig, type Effort } from './app';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
const effortEnv = process.env.COACH_EFFORT as Effort | undefined;
const client = apiKey || authToken ? new Anthropic({ apiKey: apiKey || null, authToken: authToken || null }) : undefined;

const config: CoachConfig = {
  ...DEFAULT_CONFIG,
  model: process.env.COACH_MODEL?.trim() || DEFAULT_CONFIG.model,
  effort: effortEnv && EFFORTS.includes(effortEnv) ? effortEnv : DEFAULT_CONFIG.effort,
  maxTokens: intEnv('COACH_MAX_TOKENS', DEFAULT_CONFIG.maxTokens),
  ratePerMinute: intEnv('COACH_RATE_PER_MIN', DEFAULT_CONFIG.ratePerMinute),
  fallbacks: process.env.COACH_FALLBACKS !== 'off',
  startStream: client ? (params, signal) => client.beta.messages.stream(params, { signal }) : undefined,
};

const port = intEnv('COACH_PORT', 8001);
const host = process.env.COACH_HOST || '127.0.0.1';
const handle = createCoachHandler(config);
const server = createServer((req, res) => void handle(req, res));
server.listen(port, host, () => {
  console.log(
    `Lapwing coach on http://${host}:${port} (model ${config.model}, effort ${config.effort}${
      client ? '' : ', NO API KEY: set ANTHROPIC_API_KEY'
    })`,
  );
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
