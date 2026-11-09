<!-- docs-tree: docs/development/conventions.md | parent: docs/development/README.md -->
# Convenções de código

> **Árvore:** [docs](../README.md) › [development](README.md) › conventions
> **Resumo:** Regras seguidas no código do Lapwing: unidades, escape, cleanup, guardas assíncronas, CSS por tela, i18n bilíngue, sem frameworks, confirmação própria e tokens de cor.
> **Código:** `.github/copilot-instructions.md`, `src/app/screen.ts`, `src/style.css`, `src/ui/confirm.ts`

## Stack

- TypeScript estrito + Vite. **Sem framework de UI**: templates em string, `innerHTML` e delegação de eventos.
- Bibliotecas: apenas `chart.js` (via `src/ui/chart-theme.ts`) e `maplibre-gl` (via `src/map/base.ts`).
- Sem backend; dados em IndexedDB (`src/data/db.ts`) e `localStorage` com prefixo `lapwing:`.
- `verbatimModuleSyntax`: tipos importados com `import type` / `type X` no import.

## Unidades internas

| Grandeza | Unidade |
|---|---|
| Distância | metros |
| Duração | segundos |
| Pace | segundos por km |
| Timestamp | epoch ms (exceção: campos `expiresAt`/`syncCursor` do Strava, em segundos) |
| Data de calendário | `"YYYY-MM-DD"` local |
| Coordenada | `[lon, lat]` (`LngLat`), `[lon, lat, ele?]` (`Coord`) |

Converta só nas bordas (inputs em km ou `m:ss`, exibição com `src/format.ts`). Comente a unidade em campos novos (`/** Metres. */`).

## Separação de camadas

- `src/data/`, `src/gpx/`, `src/geo.ts`, `src/format.ts`: domínio, sem importar telas.
- Cálculos de tela em módulos puros sem DOM (`calc.ts`, `aggregate.ts`, `overload.ts`, `matching.ts`…), testáveis no ambiente Node.
- Outras telas podem importar esses módulos puros (ex.: `insights` usa `history/aggregate`), não o `index.ts` de outra tela.
- Tipos de `src/data/types.ts` pertencem ao núcleo; telas não devem alterá-los por conta própria.

## Telas

- Exportam `mount: ScreenMount` e devolvem cleanup ([overview.md](../architecture/overview.md#contrato-screenmount-srcappscreents)).
- O cleanup remove: mapas (`map.remove()`), gráficos (`chart.destroy()`), timers, listeners em `window`/`document`, assinaturas `onLangChange`/`onDataChange`/`onThemePrefChange`, diálogos abertos e classes adicionadas ao `root`.
- Listeners em `window`: passe `{ signal }` de um `AbortController` abortado no cleanup, ou remova explicitamente.
- Recarregue dados derivados quando as stores relevantes mudarem (`onDataChange((store) => …)`), filtrando pelo nome da store.

## Guardas assíncronas

Depois de qualquer `await`, verifique se a tela ainda está montada e se a resposta ainda é a mais recente:

```ts
async function load() {
  const id = ++loadId;
  const [activities, settings] = await Promise.all([listActivities(), getSettings()]);
  if (disposed || id !== loadId) return;
  render();
}
```

Alternativas usadas: `if (signal.aborted) return;` (editor de rotas) e `AbortController` passado a trabalhos longos (`loadEfforts`, `syncStrava`).

## Escape e DOM

- Texto do usuário em `innerHTML` → sempre com o `esc` da feature ([ui-components.md](../architecture/ui-components.md#escape-de-html-esc)).
- Atualizações diretas de texto → `textContent`.
- XML/ICS gerados → `escapeXml` / `xml` / `icsEscape`.
- Eventos por delegação: um listener no contêiner, ações em `data-action`/`data-*`.

## Diálogos e mensagens

- **Nunca** `window.confirm()`: use `confirmDialog()` com `tone: 'danger'` para apagar/substituir dados. Rótulos em `dlg*` no dicionário global.
- Mensagens curtas: `showToast(msg, 'info' | 'warn' | 'error')`.
- Diálogos próprios de tela usam `<dialog class="modal">` e são fechados no cleanup.

## i18n

- Todo texto visível em **`en` e `pt-BR`**.
- Shell e editor de rotas: `src/i18n/en.ts` + `src/i18n/pt-BR.ts`. Telas: `defineMessages` no `i18n.ts` da tela (configurações usam `backup-i18n.ts` e `strava-i18n.ts`).
- Re-renderize em `onLangChange` se a tela fica montada.
- Números e datas com `src/format.ts` (usa o idioma atual).

Detalhes em [i18n.md](../architecture/i18n.md).

## CSS

- Estilos globais e tokens só em `src/style.css`. Cada tela importa seu próprio CSS (`import './history.css'`) e usa um prefixo:

| Tela | Prefixo | Escopo |
|---|---|---|
| today | `tdy-` | `.tdy-root` (cores de tipo e etapa vêm de `training.css`) |
| routes | `rm-` | `.rm-root` no `root` |
| activity | `act-` | `.act-root` |
| training | `trn-` | `.trn-root` (tokens `--trn-*`) |
| history | `his-` | `.his-root` |
| compare | `cmp-` | `.cmp-page` (sem classe no `root`) |
| insights | `ins-` | `.ins-root` |
| settings | `set-`, `ap-`, `bk-`, `strava` | por seção |
| gear (desativada) | `gear-` | `.gear-root` |

- A classe de escopo é adicionada ao `root` no `mount` e removida no cleanup.
- Reaproveite os blocos globais (`.page`, `.card`, `.btn`, `.badge`, `.modal`…).

## Cores

- Use tokens (`var(--accent)`, `var(--good-soft)`…), não hex, em CSS de tela.
- Em TypeScript, leia com `cssVar()` ou `chartColors` no momento da criação.
- Cor nova: token em `:root` **e** em `:root[data-theme='dark']` ([theming.md](../architecture/theming.md#como-adicionar-uma-cor)).

## Armazenamento

- Chaves novas com prefixo `lapwing:`; sempre em `try/catch`.
- Store nova no IndexedDB: `StoreName` + `STORES` + incrementar `DB_VERSION`.
- Mutações do editor de rotas apenas via `state.change()`; requisições de roteamento só pela `RoutingQueue`.

## Mapas

- `createBaseMap()` + aguarde `whenLoaded()` antes de adicionar sources/layers.
- `map.remove()` no unmount.
- A edição de rotas nunca pode depender do sucesso do BRouter.

## GPX, FIT e TCX

- Parsing independente de namespace; aceita `trkpt` ou `rtept`.
- Tolerante a extensões de fabricantes; mantenha os códigos de erro `invalid` e `empty` (`GpxError`), também em `parse-fit.ts` e `parse-tcx.ts` (que devolvem o mesmo `ParsedActivity`). Na importação, `empty` vira `no-gps`.
- Novos formatos de atividade entram por `parseActivityBytes` em `src/data/import.ts`; formatos em [file-formats.md](../reference/file-formats.md#importação-de-atividades-srcdataimportts).

## Testes

- `tests/**/*.test.ts`; `// @vitest-environment jsdom` quando precisar de DOM.
- Reutilize `tests/fixtures/runs` e `tests/helpers/{confirm,fit-builder,make-zip}.ts`; só dados sintéticos. Ver [testing.md](testing.md).

## Veja também

- [Como adicionar uma tela](adding-a-screen.md)
- [Visão geral da arquitetura](../architecture/overview.md)
- [Componentes de UI](../architecture/ui-components.md)
