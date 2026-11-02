# Lapwing Copilot Instructions

## Commands

- `npm run dev` starts the Vite development server.
- `npm run build` type-checks application and test code, then creates a production build.
- `npm run typecheck` runs only the application and test TypeScript checks.
- `npm test` runs the full Vitest suite once.
- `npm test -- tests/geo.test.ts` runs one test file.
- `npm test -- tests/training-screen.test.ts -t "matches a run"` runs a named test.
- `npm run fixtures -- 2026-10-31` regenerates deterministic GPX fixtures through that end date. The date argument is optional.

There is no lint script configured.

- `docker compose up -d --build` builds the Docker image (`Dockerfile`: Node build stage → unprivileged nginx serving `dist/` with `docker/nginx.conf`) and serves the app on port 8080. See `docs/getting-started/docker.md`.

## Documentation

The full documentation is a tree under `docs/` (Brazilian Portuguese), indexed by `docs/README.md`; `llms.txt` at the repository root is a short entry point. Every page starts with a `<!-- docs-tree: <path> | parent: <index> -->` header. When a change alters behaviour, formats, storage keys or commands, update the matching page (and its folder `README.md` index if you add or remove a page).

## Architecture

Lapwing is a static, browser-only TypeScript/Vite application for creating GPX routes, importing and analyzing activities, managing training plans, and viewing history. `src/main.ts` owns the application shell and hash-based navigation. Routes in `src/app/router.ts` lazy-load their screen modules:

- `screens/routes` edits routes on MapLibre maps and imports/exports GPX. Every new segment is routed by BRouter (`shortest` profile); the routing queue keeps a straight line when the path is almost the same and snaps waypoints onto the path. Right-clicking a line forces it straight.
- `screens/activity` imports activity files, persists them, and renders reports with maps and Chart.js charts. The import page calls `importActivityFiles` (`data/import.ts`), which accepts GPX, FIT and TCX (each optionally `.gz`) and `.zip` archives. A ZIP goes to `data/strava-archive.ts` (lazy-loaded), which reads the Strava account export: `activities.csv` (localized headers, columns found by label or position) plus one file per activity under `activities/`. Only runs, trail runs and walks are imported; every outcome has an `ImportErrorCode` (`duplicate`, `no-gps`, `manual`, `ignored-type`, `invalid`, `read`, `unsupported`, `save`). Activities are saved one at a time, so an `AbortSignal` cancel keeps what was saved.
- `screens/training` stores plans/workouts (optionally structured into steps and repeats), matches imported runs against them, and exports plans as ICS, Garmin TCX, FIT, CSV and JSON.
- `screens/history` aggregates imported activities into trends, records, and charts, with advanced filters kept in the URL query.
- `screens/compare` (`/compare/:a/:b`) compares two runs side by side.
- `screens/insights` holds weekly/monthly goals (store `goals`), race predictions from best efforts, and overload alerts.
- `screens/gear` (shoe tracking) is disabled: it has no route or menu entry, but its code, `data/shoes.ts`, the `shoes` store and `Activity.shoeId` are kept so stored data and backups keep working. Re-enable it by adding the nav item and route in `src/app/router.ts`.
- `screens/settings` holds the optional Strava sync (`data/strava.ts`, OAuth with the user's own Strava API app; creating one requires a paid Strava subscription) and backup/restore to a file (`data/backup.ts`).

The shared domain layer is deliberately separated from screens:

- `src/data/` owns IndexedDB access, activity types, activity parsing (`parse-activity.ts` GPX, `parse-fit.ts` FIT, `parse-tcx.ts` TCX, all returning `ParsedActivity`), ZIP/gzip reading (`zip.ts` reads by `Blob.slice`, `gzip.ts` uses `DecompressionStream`; no dependencies), summaries, and metrics. Activities are stored separately from track points: `activities` holds summaries and `tracks` holds `{ id, points }`.
- `src/gpx/` parses and exports route GPX; `src/geo.ts` and `src/format.ts` contain reusable coordinate, distance, elevation, and display logic.
- `src/map/base.ts` centralizes MapLibre worker setup, map creation, and the OpenFreeMap style.
- The app was called Route Maker before. `src/app/legacy-storage.ts` moves old `route-maker:` storage keys to `lapwing:`, and `data/db.ts` copies the old `route-maker` IndexedDB database into `lapwing` once. Keep new keys under the `lapwing:` prefix.
- `src/i18n/` provides global translations; each feature screen keeps its own typed English and Brazilian Portuguese dictionaries beside the screen code.

All user data remains in IndexedDB/localStorage. `onDataChange` in `src/data/db.ts` is the cross-screen and cross-tab notification mechanism; reload derived screen data when its relevant stores change.

## Repository Conventions

- Screen modules export `mount(root, params)`. They must return cleanup for maps, charts, timers, window/document listeners, and `onLangChange`/`onDataChange` subscriptions. The root router calls this cleanup on navigation. For asynchronous screen work, guard against unmounting with an abort/disposed flag or load ID before updating the DOM.
- Screen UI is rendered with DOM templates and event delegation rather than a UI framework. When interpolating user-controlled text into `innerHTML`, escape it with the feature's `esc` helper; prefer `textContent` for direct text updates.
- Coordinates use longitude first: `LngLat` is `[lon, lat]` and `Coord` is `[lon, lat, elevation?]`. Distances are metres, durations are seconds, timestamps are epoch milliseconds, and paces are seconds per kilometre. Keep those internal units even when UI input/output uses kilometres or `m:ss`.
- Route editing depends on the `RouteState` invariant that `segments[i]` connects `waypoints[i]` to `waypoints[i + 1]`. Mutations must use `state.change()` to preserve undo/redo and notifications. Routed segments are asynchronous placeholders; let `RoutingQueue.sync()` own their BRouter requests and cancellation.
- Reuse `createBaseMap()` and wait for `whenLoaded()` before adding map sources/layers. Always remove the map during unmount. BRouter routing has a 15-second timeout and falls back to a failed straight segment; do not make route editing depend on routing success.
- GPX parsing is namespace-agnostic and accepts either track points or route points. Keep activity parsing (GPX, FIT, TCX) tolerant of vendor extensions and preserve the existing validation errors (`invalid` and `empty`, reported as `no-gps` by the import). Format detection lives in `parseActivityBytes`/`sniffFormat`; duplicates use `findDuplicate` (same `stravaId`, or start within 60 s and distance within 50 m, the same rule as the Strava sync). The FIT parser drops `-1 m` altitude placeholders (`dropAltitudePlaceholders`).
- Add user-visible text to both `en` and `pt-BR` dictionaries. Global shell/route-editor strings live in `src/i18n/en.ts` and `src/i18n/pt-BR.ts`; feature strings use `defineMessages` in that feature's `i18n.ts`. Subscribe to `onLangChange` when a mounted screen needs to rerender translated content.
- Tests live in `tests/**/*.test.ts`. Pure logic tests use Vitest directly; DOM-dependent tests declare `// @vitest-environment jsdom`. Reuse `tests/fixtures/runs` for realistic GPX activity coverage; build synthetic FIT files with `tests/helpers/fit-builder.ts` and ZIP/gzip files with `tests/helpers/make-zip.ts`. Never commit a real export archive (it holds personal data).
