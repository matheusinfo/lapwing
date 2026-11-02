<!-- docs-tree: docs/architecture/data-model.md | parent: docs/architecture/README.md -->
# Modelo de dados

> **Árvore:** [docs](../README.md) › [architecture](README.md) › data-model
> **Resumo:** Stores do IndexedDB, todos os tipos persistidos, unidades internas e versionamento do banco.
> **Código:** `src/data/types.ts`, `src/data/db.ts`, `src/data/strava.ts`, `src/data/import.ts`, `src/data/strava-archive.ts`, `src/screens/training/types.ts`, `src/screens/insights/goals.ts`, `src/types.ts`

## Unidades internas

| Grandeza | Unidade | Observação |
|---|---|---|
| Distância, altitude | metros | UI mostra km com `formatDistance` |
| Duração | segundos | UI usa `h:mm:ss` / `m:ss` (`formatDuration`) |
| Pace | segundos por km | UI usa `m:ss /km` (`formatPace`, `parsePace`) |
| Timestamps | epoch ms | Exceções: `StravaSettings.expiresAt` e `syncCursor` em epoch **segundos** |
| Datas de calendário | `"YYYY-MM-DD"` local | Treinos, planos, filtros |
| Coordenadas | `[lon, lat]` | `LngLat = [number, number]`, `Coord = [number, number, number?]` (altitude opcional) |
| Exceção | `TrackPoint` usa `{ lat, lon }` | Objeto nomeado, não tupla |
| Cadência | passos/min (dois pés) | GPX/FIT/TCX/Strava trazem passadas/min; os parsers dobram valores < 130 (só para corrida/caminhada) |
| FC | bpm | |

## Banco IndexedDB

- Nome: `lapwing` (`DB_NAME`). Antigo: `route-maker` (copiado uma vez, ver [storage-and-migration.md](storage-and-migration.md)).
- `DB_VERSION = 2`; exportado também como `SCHEMA_VERSION` (gravado em backups como `dbVersion`).
- Todas as stores usam `keyPath: 'id'`, sem índices.
- Upgrade (`onupgradeneeded`): cria toda store de `STORES` que ainda não existe. Não há migração de registros entre versões. Para adicionar uma store: inclua em `StoreName` e `STORES` e incremente `DB_VERSION`.

| Store | Registro | Dono do formato |
|---|---|---|
| `activities` | `Activity` (só resumo, barato de listar) | `data/types.ts` |
| `tracks` | `{ id, points: TrackPoint[] }` (mesmo `id` da atividade) | `data/types.ts` |
| `plans` | `TrainingPlan` | `screens/training/types.ts` |
| `workouts` | `PlannedWorkout` | `screens/training/types.ts` |
| `settings` | `{ id: 'athlete', ...AthleteSettings }`, `StravaSettings` (`id: 'strava'`) | `data/types.ts`, `data/strava.ts` |
| `shoes` | `Shoe` (UI de tênis desativada; store mantida) | `data/types.ts` |
| `goals` | `Goal` | `screens/insights/goals.ts` |

### API de `db.ts`

| Função | Uso |
|---|---|
| `getAll<T>(store)`, `get<T>(store, id)` | Leitura genérica |
| `put(store, value)`, `putMany(store, values)`, `remove(store, id)` | Escrita genérica + `notify(store)` |
| `listActivities()` | Todas as atividades, mais recentes primeiro |
| `getActivity(id)`, `getTrack(id)` | `getTrack` devolve `[]` se não houver |
| `saveActivity(activity, points?)` | Uma transação em `activities` (+ `tracks` se `points`) |
| `deleteActivity(id)` | Apaga de `activities` e `tracks` |
| `getSettings()`, `saveSettings(s)` | Perfil do atleta mesclado com `DEFAULT_SETTINGS` |
| `newId()` | `crypto.randomUUID()` ou fallback base36 |
| `readStores`, `countStores`, `bulkWrite`, `clearStores` | Backup/restauração (transação única) |
| `onDataChange(fn)` | Ver [overview.md](overview.md#notificações-entre-telas-e-abas) |

## Tipos de atividade (`src/data/types.ts`)

### `TrackPoint`

| Campo | Tipo | Unidade |
|---|---|---|
| `lat`, `lon` | `number` | graus |
| `ele?` | `number` | m |
| `time?` | `number` | epoch ms |
| `hr?` | `number` | bpm |
| `cad?` | `number` | passos/min |
| `temp?` | `number` | °C |
| `power?` | `number` | W |

### `ActivitySummary`

| Campo | Descrição |
|---|---|
| `distance` | m |
| `elapsedTime` | s do primeiro ao último timestamp (0 sem timestamps) |
| `movingTime` | s sem paradas; igual a `elapsedTime` sem timestamps |
| `avgPace?` | s/km sobre o tempo em movimento |
| `bestPace?` | 1 km mais rápido (s/km) |
| `elevationGain`, `elevationLoss` | m (limiar de 2 m) |
| `minEle?`, `maxEle?` | m |
| `avgHr?`, `maxHr?` | bpm (média ponderada pelo tempo) |
| `avgCadence?`, `maxCadence?` | passos/min |
| `avgTemp?`, `avgPower?`, `maxPower?` | °C, W |
| `has` | `{ time, ele, hr, cad, temp, power }` booleanos |
| `bounds` | `[[west, south], [east, north]]` |

### `Activity`

| Campo | Descrição |
|---|---|
| `id` | `newId()` |
| `name` | Do arquivo (GPX `<name>`, FIT `sport.name`) ou nome do arquivo sem pastas, `.gz` e extensão; Strava (API ou `activities.csv` do `.zip`): nome da atividade |
| `type` | `ActivityType = 'run' \| 'trail-run' \| 'walk' \| 'other'` |
| `startTime` | epoch ms (primeiro timestamp ou hora da importação) |
| `hasStartTime` | se `startTime` veio do arquivo |
| `fileName`, `importedAt` | Nome do arquivo importado; no `.zip`, o caminho dentro dele (`activities/<upload>.fit.gz`); sincronização do Strava usa `strava-<id>` |
| `summary` | `ActivitySummary` |
| `notes?`, `rpe?` | Anotações e RPE 1–10 informados pelo usuário; o `.zip` do Strava preenche `notes` com a descrição da atividade |
| `shoeId?` | id em `shoes` (ainda gravado na importação se houver tênis padrão; UI desativada) |
| `source?` | `'gpx' \| 'strava'`; ausente = importado de arquivo (GPX, FIT ou TCX); `'strava'` = sincronização pela API ou `.zip` de exportação do Strava |
| `stravaId?` | id da atividade no Strava (API ou coluna 0 do `activities.csv`); usado por `findDuplicate`/`isDuplicate` para pular repetidas |

### `AthleteSettings` e `DEFAULT_SETTINGS`

| Campo | Padrão | Descrição |
|---|---|---|
| `maxHr` | 190 | bpm |
| `restingHr` | 60 | bpm |
| `hrZoneBounds` | `[0.6, 0.7, 0.8, 0.9]` | limite superior das zonas 1–4 como fração de `maxHr`; zona 5 é o resto |
| `weight?` | — | kg |

### `Shoe`

> **Nota:** a interface de tênis está desativada (`src/screens/gear/` fora do roteador, sem seletor no relatório nem filtro no histórico). Tipo, store `shoes`, `Activity.shoeId` e `src/data/shoes.ts` continuam existindo para que dados salvos e backups funcionem; `defaultShoeId()` não retorna nada quando não há tênis.

| Campo | Descrição |
|---|---|
| `id`, `name`, `brand?`, `model?`, `notes?`, `createdAt` | |
| `startDistance` | m já rodados antes de entrar no app |
| `retireDistance` | m para aposentar (`DEFAULT_RETIRE_DISTANCE = 700_000`) |
| `isDefault?` | no máximo um tênis; aplicado a corridas importadas (`run`/`trail-run`) |
| `retiredAt?` | epoch ms; aposentado nunca é padrão |

## Treinos (`src/screens/training/types.ts`)

### `TrainingPlan`

`{ id, name, goal: PlanGoal, raceDate?: 'YYYY-MM-DD', createdAt }` com `PlanGoal = '5k' | '10k' | 'half' | 'marathon' | 'other'`.

### `PlannedWorkout`

| Campo | Descrição |
|---|---|
| `id`, `planId` | |
| `date` | `'YYYY-MM-DD'` local |
| `kind` | `WorkoutKind`: `easy`, `long`, `tempo`, `intervals`, `recovery`, `race`, `rest`, `cross` |
| `title` | pode ser vazio (mostra o nome do tipo) |
| `distance?`, `duration?`, `pace?` | m, s, s/km |
| `description?` | |
| `status?` | `'done' \| 'skipped'` (override manual) |
| `linkedActivityId?` | vínculo manual; vence o casamento automático |
| `unlinked?` | nunca casar automaticamente |
| `steps?` | `WorkoutStep[]`; com passos, `distance`/`duration` costumam ser estimativas |

`WorkoutDraft = Omit<PlannedWorkout, 'id' | 'planId'>`. Status calculado (`WorkoutStatus`): `done`, `partial`, `missed`, `upcoming`, `rest`, `skipped`.

### `WorkoutStep`

```ts
type StepKind = 'warmup' | 'active' | 'recovery' | 'cooldown' | 'rest';
type StepDuration = { type: 'distance'; meters } | { type: 'time'; seconds } | { type: 'open' };
type StepTarget = { type: 'pace'; min; max }          // s/km, min ≤ max (min = mais rápido)
                | { type: 'hr'; zone }                 // 1–5
                | { type: 'hr'; min; max };            // bpm
interface SimpleStep { type: 'step'; id; kind; duration; target?; note? }
interface RepeatStep { type: 'repeat'; id; times; steps: SimpleStep[] } // um nível de aninhamento
type WorkoutStep = SimpleStep | RepeatStep;
```

Limites de validação (`LIMITS` em `structure.ts`): distância ≤ 100 000 m, tempo ≤ 86 400 s, pace 120–1200 s/km, FC 30–250 bpm, repetições ≤ 99.

## Metas (`src/screens/insights/goals.ts`)

| Campo | Descrição |
|---|---|
| `id`, `createdAt` | |
| `period` | `'week' \| 'month'` (semana começa na segunda) |
| `metric` | `'distance' \| 'time' \| 'runs'` |
| `target` | m, s de tempo em movimento, ou contagem |
| `activityTypes?` | padrão `DEFAULT_GOAL_TYPES = ['run', 'trail-run']` |

## Registro do Strava (`StravaSettings`, `src/data/strava.ts`)

| Campo | Descrição |
|---|---|
| `id` | `'strava'` |
| `clientId` | da aplicação API do próprio usuário |
| `clientSecret?`, `accessToken?`, `refreshToken?` | sensíveis; removidos de backups sem segredos |
| `expiresAt?` | epoch **segundos** |
| `athlete?` | `{ id, name }` |
| `scope?` | ex.: `"read,activity:read_all"` |
| `lastSyncAt?` | epoch ms |
| `syncCursor?` | início (epoch s) da atividade mais nova já tratada |

"Conectado" (`isConnected`) exige `accessToken`, `refreshToken` e `clientSecret`.

## Veja também

- [Armazenamento e migração](storage-and-migration.md)
- [Análise e métricas](analysis-and-metrics.md)
- [Formatos de arquivo](../reference/file-formats.md)
- [Glossário](../reference/glossary.md)
