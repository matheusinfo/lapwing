import { defineConfig } from 'vitest/config';

// Optional sync server for `npm run dev` / `npm run preview`:
//   python3 sync/server.py  (SYNC_DB=/tmp/lapwing.db SYNC_PORT=8787)
//   LAPWING_SYNC_URL=http://127.0.0.1:8787 npm run dev
const syncUrl = process.env.LAPWING_SYNC_URL;
const proxy = syncUrl ? { '/api/sync': { target: syncUrl, changeOrigin: true } } : undefined;

export default defineConfig({
  server: { proxy },
  preview: { proxy },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
