// Bundles the coach server (coach/server.ts + the Anthropic SDK) into one
// file, coach/dist/server.mjs, that runs on plain Node 20+ without node_modules.
import { build } from 'rolldown';

await build({
  input: 'coach/server.ts',
  platform: 'node',
  logLevel: 'warn',
  output: {
    file: 'coach/dist/server.mjs',
    format: 'esm',
    codeSplitting: false,
    banner: '// Lapwing coach server, bundled by scripts/build-coach.mjs. Source: coach/.',
  },
});
console.log('coach/dist/server.mjs');
