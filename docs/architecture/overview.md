<!-- docs-tree: docs/architecture/overview.md | parent: docs/architecture/README.md -->
# Visão geral da arquitetura

> **Árvore:** [docs](../README.md) › [architecture](README.md) › overview
> **Resumo:** Shell da aplicação, roteador por hash, telas carregadas sob demanda, contrato `ScreenMount`, notificações entre telas e mapa de módulos.
> **Código:** `src/main.ts`, `src/app/router.ts`, `src/app/screen.ts`, `src/data/db.ts`

## Shell (`index.html` + `src/main.ts`)

`index.html` contém o esqueleto fixo:

| Elemento | Papel |
|---|---|
| `nav#app-nav` | Menu lateral/inferior; `.nav-items` é preenchido por `renderNav()` a partir de `NAV_ITEMS` |
| `button#theme-toggle` | Alterna o tema em ciclo `system → light → dark` |
| `select#lang` | Idioma (`en` / `pt-BR`), chama `setLang()` |
| `main#app-main` | Recebe a tela ativa dentro de um `div.screen` |
| `div#toast` | Alvo de `showToast()` |
| `<script>` inline | Aplica o tema salvo antes da primeira pintura (ver [theming.md](theming.md)) |

Ordem de inicialização em `main.ts`:

1. `import './style.css'`.
2. `import './app/legacy-storage'` — **precisa** vir antes de qualquer módulo que leia configurações (migra `route-maker:*` → `lapwing:*`).
3. Importa router, i18n, `dismissConfirms` e tema; renderiza o menu e o botão de tema.
4. Registra `hashchange` → `show()` e `onThemeChange` → remonta a tela.
5. Se `location.search` tem `state`, importa `data/strava` e chama `captureStravaRedirect()` antes do primeiro `show()`.

## Roteador por hash (`src/app/router.ts`)

URLs têm a forma `#/<caminho>?<query>`. `:nome` captura um segmento (decodificado com `decodeURIComponent`).

| Caminho | Item do menu (`nav`) | Módulo |
|---|---|---|
| `/routes` (padrão, `DEFAULT_PATH`) | `routes` | `screens/routes` |
| `/activity` | `activity` | `screens/activity` (importação + lista) |
| `/activity/:id` | `activity` | `screens/activity` (relatório) |
| `/training` | `training` | `screens/training` |
| `/history` | `history` | `screens/history` |
| `/compare`, `/compare/:a`, `/compare/:a/:b` | `history` | `screens/compare` |
| `/insights` | `insights` | `screens/insights` |
| `/settings` | `settings` | `screens/settings` |

`NavId = 'routes' | 'activity' | 'training' | 'history' | 'insights' | 'settings'`. Caminhos desconhecidos (inclusive o antigo `/gear`) redirecionam para `/routes`.

API exportada:

| Função | Descrição |
|---|---|
| `navigate(path)` | `location.hash = '#' + path` |
| `currentPath()` | Caminho sem query; `DEFAULT_PATH` se vazio |
| `currentQuery()` | `URLSearchParams` do que vem após `?` no hash |
| `matchRoute(path)` | `{ route, params }` ou `null` (número de segmentos precisa bater) |
| `NAV_ITEMS` | `{ id, path, label: MessageKey, icon }[]` do menu |
| `ROUTES` | `RouteDef[]` com `path`, `nav`, `load()` |

### Ciclo de `show()`

1. Sem rota correspondente → `navigate(DEFAULT_PATH)`.
2. **Mesma rota e mesmos params** (`JSON.stringify(params)`) → não faz nada. Mudar só a query (ex.: filtros em `#/history?q=…`) **não remonta** a tela; a própria tela escuta `hashchange` se precisar reagir.
3. Marca o item ativo do menu (`.nav-item.active`).
4. Incrementa `loadId`, chama `dismissConfirms()`, executa o cleanup da tela anterior e limpa `main`.
5. Mostra `t('loadingScreen')`, aguarda `route.load()` (import dinâmico → chunk separado no build).
6. Se `loadId` mudou nesse meio tempo, descarta. Senão chama `mod.mount(root, params)` e guarda o cleanup.
7. Erro de carregamento → `console.error` + `t('screenError')`.

Mudança de tema zera `currentRoute` e chama `show()`, forçando remontagem (gráficos e mapas leem cores na criação).

## Contrato `ScreenMount` (`src/app/screen.ts`)

```ts
export type ScreenMount = (root: HTMLElement, params: Record<string, string>) => void | (() => void);
```

- `root` é um `div.screen` vazio; `params` vêm do padrão da rota.
- O retorno é a função de cleanup, chamada na navegação. Ela deve liberar:
  - mapas (`map.remove()`), gráficos (`chart.destroy()`);
  - listeners em `window`/`document`, timers;
  - assinaturas `onLangChange` / `onDataChange` / `onThemePrefChange`;
  - classes adicionadas ao `root` (ex.: `root.classList.remove('his-root')`).
- Trabalho assíncrono deve checar um flag (`disposed`), um `AbortController` (`lifetime.signal`) ou um `loadId` antes de tocar no DOM.

Padrões usados nas telas:

| Padrão | Exemplo |
|---|---|
| Lista de `cleanups` + `AbortController` | `screens/routes/index.ts` |
| `disposed` + `loadId` | `screens/history/index.ts` (`reload()`) |
| Sub-montagens que retornam cleanup | `screens/settings/index.ts` (seções), `screens/activity/index.ts` (import vs. relatório) |

## Notificações entre telas e abas

`src/data/db.ts` emite um evento por store após cada escrita (`put`, `putMany`, `remove`, `saveActivity`, `deleteActivity`, `bulkWrite`).

- `onDataChange(fn: (store: StoreName) => void)` → retorna a função que cancela.
- O evento vai aos listeners locais **e** para um `BroadcastChannel('lapwing-db')`, então outras abas abertas recebem o mesmo nome de store.
- `saveActivity`/`deleteActivity` notificam apenas `'activities'` (não `'tracks'`).

Stores que cada tela observa:

| Tela | Recarrega quando muda |
|---|---|
| activity (lista) | `activities` |
| training | `activities`, `plans`, `workouts` |
| history | `activities`, `settings` (recarga total); `plans`, `workouts` (extras) |
| compare | `activities`, `tracks`, `settings` |
| insights | `goals` (só metas); `activities`, `settings` (recarga total) |
| settings/backup | qualquer store (recontagem) |
| settings/zones | `settings` (só sem edição pendente nem cálculo em andamento) |
| settings/strava | `settings` (fora de carregamento/conexão/sincronização) |

## Mapa de dependências

```
                   index.html
                       │
                   src/main.ts ──► app/legacy-storage (efeito colateral)
                       │
          ┌────────────┼──────────────┬──────────────┐
     app/router     i18n/index     ui/theme      ui/confirm
          │ import() dinâmico
          ▼
   screens/<tela>/index.ts  (mount)
      │        │         │            │
      │        │         │            └─► ui/{toast,confirm,chart-theme} ─► chart.js
      │        │         └─► map/base ─► maplibre-gl, ui/theme
      │        └─► i18n (defineMessages), format.ts
      ▼
   data/ ─────────────► gpx/parse (GpxError), geo.ts
   (db, types, analysis, metrics, import, parse-activity, parse-fit, parse-tcx,
    strava-archive, zip, gzip, shoes, strava, backup)

Dependências entre telas (só módulos puros):
   compare  ──► activity/{calc,charts,dom}
   history  ──► training/{dates,matching,types}
   insights ──► history/{aggregate,efforts}
```

Regras: `data/` não importa telas; telas não importam `main.ts`; `src/types.ts` (`LngLat`, `Coord`) é usado por `geo.ts`, `gpx/` e pelo editor de rotas.

## Árvore de `src/`

```
src/
├── main.ts                 shell: menu, idioma, botão de tema, show() e retorno do Strava
├── style.css               tokens de cor, shell e blocos CSS compartilhados
├── types.ts                LngLat [lon, lat] e Coord [lon, lat, ele?]
├── geo.ts                  haversine, distância, ganho/perda de altitude, bounds, ponto mais próximo
├── format.ts               formatação de distância, duração, pace, número, data (Intl)
├── vite-env.d.ts           tipos do Vite
├── app/
│   ├── router.ts           ROUTES, NAV_ITEMS, navigate, currentPath, currentQuery, matchRoute
│   ├── screen.ts           tipo ScreenMount
│   └── legacy-storage.ts   migra chaves route-maker: → lapwing:
├── data/
│   ├── types.ts            TrackPoint, Activity, ActivitySummary, Shoe, AthleteSettings
│   ├── db.ts               IndexedDB, onDataChange, acesso genérico e em lote, migração do DB antigo
│   ├── parse-activity.ts   GPX de atividade (hr, cad, temp, power)
│   ├── parse-fit.ts        FIT de atividade (decodificador próprio); dropAltitudePlaceholders
│   ├── parse-tcx.ts        TCX de atividade
│   ├── analysis.ts         distância/tempo em movimento cumulativos, bestEffort, computeSummary
│   ├── metrics.ts          zonas de FC, TRIMP
│   ├── zones.ts            zonas de FC e de pace (bpm/s por km), zonas de Friel, tempo em cada zona
│   ├── import.ts           importActivityFiles: GPX/FIT/TCX (+ .gz) e ZIP; detecção de formato e de duplicatas
│   ├── strava-archive.ts   .zip de exportação da conta do Strava (activities.csv + activities/); carregado sob demanda
│   ├── zip.ts              leitor de ZIP por fatias do Blob (stored/deflate, ZIP64, CRC-32)
│   ├── gzip.ts             gunzip/deflate-raw com DecompressionStream
│   ├── shoes.ts            tênis: CRUD, estatísticas, defaultShoeId() (UI desativada; ainda usado pela importação)
│   ├── strava.ts           OAuth e sincronização com o Strava
│   └── backup.ts           backup/restauração JSON (+ gzip)
├── gpx/
│   ├── parse.ts            GPX de rota → Coord[]; GpxError('invalid' | 'empty')
│   └── export.ts           Coord[] → GPX 1.1; fileNameFor, downloadGpx
├── i18n/
│   ├── index.ts            t, defineMessages, setLang, onLangChange, translateDom
│   ├── en.ts               dicionário global (MessageKey)
│   └── pt-BR.ts            dicionário global em português
├── map/base.ts             worker do MapLibre, createBaseMap, whenLoaded, estilos OpenFreeMap
├── ui/
│   ├── theme.ts            preferência de tema, data-theme, cssVar
│   ├── chart-theme.ts      Chart.js registrado + cores dos tokens
│   ├── confirm.ts          confirmDialog, dismissConfirms
│   └── toast.ts            showToast
└── screens/
    ├── routes/             editor de rotas (prefixo CSS rm-); route/{state,editor,router}.ts
    ├── activity/           importação e relatório de corrida (act-)
    ├── training/           planos, treinos estruturados, exportações (trn-)
    ├── history/            tendências, recordes, filtros na URL (his-)
    ├── compare/            duas corridas lado a lado (cmp-)
    ├── insights/           metas, previsões, alertas de sobrecarga (ins-)
    ├── gear/               tela de tênis desativada (código mantido, fora do roteador)
    └── settings/           aparência (ap-), zonas de treino (zn-), Strava (strava), backup (bk-), página (set-)
```

## Veja também

- [Modelo de dados](data-model.md)
- [Componentes de UI](ui-components.md)
- [Como adicionar uma tela](../development/adding-a-screen.md)
- [Convenções](../development/conventions.md)
