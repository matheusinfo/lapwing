<!-- docs-tree: docs/development/testing.md | parent: docs/development/README.md -->
# Testes

> **Árvore:** [docs](../README.md) › [development](README.md) › testing
> **Resumo:** Como os testes Vitest são organizados, quando usar jsdom, como simular o banco e outras dependências, os helpers (confirmação, FIT e ZIP sintéticos) e as fixtures GPX.
> **Código:** `vite.config.ts`, `tests/**/*.test.ts`, `tests/helpers/{confirm,fit-builder,make-zip}.ts`, `tests/fixtures/runs/`, `scripts/make-fixtures.mjs`

## Visão geral

- Runner: **Vitest** (`vitest run`), arquivos `tests/**/*.test.ts` (`vite.config.ts`).
- Ambiente padrão: Node. Testes que usam DOM declaram na **primeira linha**:

  ```ts
  // @vitest-environment jsdom
  ```

- Os testes também passam pelo TypeScript: `npm run build`/`npm run typecheck` rodam `tsc --noEmit -p tests`.
- Não há `fake-indexeddb`: código que usa `src/data/db.ts` é testado com mocks em memória.

## Rodando

| Objetivo | Comando |
|---|---|
| Suíte completa | `npm test` |
| Um arquivo | `npm test -- tests/geo.test.ts` |
| Um teste pelo nome | `npm test -- tests/training-screen.test.ts -t "matches a run"` |
| Modo watch | `npx vitest` |

## Arquivos de teste

| Tipo | Arquivos | Ambiente |
|---|---|---|
| Lógica pura | `geo`, `compare`, `history-filters`, `history-screen`, `insights-logic`, `training-screen`, `route-router`, `parse-fit`, `zip` | Node |
| Lógica com DOM (`DOMParser`, `Blob`, storage) | `activity`, `gpx`, `parse-tcx`, `workout-structure`, `workout-export`, `strava`, `legacy-storage`, `theme`, `confirm` | jsdom |
| Importação com banco simulado | `strava-archive` (CSV, tipos, datas, `sniffFormat`, `importStravaArchive`, `importActivityFiles`) | jsdom |
| Lógica com banco simulado | `backup`, `gear` | Node |
| Telas montadas | `activity-screen`, `compare-screen`, `gear-screen`, `history-filters-screen`, `insights-screen`, `backup-section`, `strava-section` | jsdom |

Os nomes `*-screen.test.ts` nem sempre montam a tela: `history-screen.test.ts` e `training-screen.test.ts` testam funções puras dessas telas. `gear.test.ts` e `gear-screen.test.ts` cobrem a tela de tênis, hoje desativada (fora do roteador), cujo código continua no repositório.

## Padrões de mock

### Banco em memória

Padrão usado em `backup`, `gear`, `strava`, `strava-archive` e nos testes de tela: `vi.hoisted` cria o estado, `vi.mock('../src/data/db', …)` expõe só as funções que o módulo testado usa.

```ts
const mem = vi.hoisted(() => {
  const STORES = ['activities', 'tracks', 'plans', 'workouts', 'settings', 'shoes', 'goals'] as const;
  const data = new Map<string, Map<unknown, { id: unknown }>>();
  const reset = () => STORES.forEach((s) => data.set(s, new Map()));
  reset();
  return { STORES, data, reset, notified: [] as string[] };
});

vi.mock('../src/data/db', () => ({
  STORES: [...mem.STORES],
  SCHEMA_VERSION: 2,
  get: async (store: string, id: string) => structuredClone(mem.data.get(store)!.get(id)),
  // readStores, bulkWrite, … conforme o módulo testado
}));
```

Dicas:

- Use `structuredClone` para não vazar referências entre "banco" e código.
- Para testar reações a `onDataChange`, guarde os listeners num `Set` do estado hoisted e chame-os manualmente (`compare-screen.test.ts`).
- Mocks de módulos vizinhos seguem o mesmo padrão, ex.: `vi.mock('../src/data/shoes', () => ({ defaultShoeId: async () => mem.shoe }))` em `strava.test.ts`.

### Gráficos, mapas e toast

Telas com Chart.js/MapLibre trocam esses módulos por dublês, o que também permite verificar o cleanup:

| Módulo | Dublê típico | Verifica |
|---|---|---|
| `../src/ui/chart-theme` | `Chart` como classe que registra instâncias e tem `destroy()`; `chartColors` fixos | Gráficos destruídos no unmount |
| `../src/map/base` | `createBaseMap()` devolvendo objeto com `remove()`, `addSource`, `addLayer`, `loaded`; `whenLoaded` resolvido | `map.remove()` no unmount |
| `../src/ui/toast` | `{ showToast: vi.fn() }` | Mensagens mostradas |
| `../src/screens/history/charts` | stub | Isola a tabela/filtros |

Importe a tela **depois** dos mocks, com import dinâmico de nível superior:

```ts
const { mount } = await import('../src/screens/compare');
const { setLang } = await import('../src/i18n');
```

### Rede (Strava)

`src/data/strava.ts` aceita um `fetch` injetável (`FetchFn`) em `exchangeCode`, `disconnect`, `StravaApi` e `syncStrava({ fetch })`. Os testes passam uma função que responde por URL e registra as chamadas. `sessionStorage` (jsdom) é limpo entre testes e preenchido com `lapwing:strava-state` para simular o retorno do OAuth.

### Tema e storage

`theme.test.ts` substitui `matchMedia` (`vi.stubGlobal`) e usa `vi.resetModules()` para reimportar `src/ui/theme.ts` com outro estado inicial. `legacy-storage.test.ts` chama `migrateLegacyKeys(storage)` diretamente.

### Importação de arquivos

| Arquivo | O que cobre | Como |
|---|---|---|
| `zip.test.ts` | `openZip` (stored/deflate, pastas, nomes UTF-8/CP437, comentário com a assinatura dentro, ZIP64, data descriptor, leitura só das partes necessárias, erros), `crc32`, `decodeName`, `isGzip`/`gunzip` | ZIPs gerados por `makeZip` |
| `parse-fit.test.ts` | `parseActivityFit` (unidades, cabeçalho de 12 bytes, CRC errado, `enhanced_altitude`, cadência fracionária, timestamps comprimidos, big-endian, campos de desenvolvedor, valores inválidos, tipos, arquivos encadeados e truncados, desempenho) e `dropAltitudePlaceholders` | FITs gerados por `FitBuilder` |
| `parse-tcx.test.ts` | `parseActivityTcx` (espaços antes de `<?xml`, BOM, prefixos de namespace, tipos, cadência, pontos sem posição, erros) | TCX em string no próprio teste |
| `strava-archive.test.ts` | `parseCsv`, `readActivitiesCsv` (cabeçalhos em pt-BR e inglês, colunas fora do lugar), `mapStravaType`, `parseStravaDate`, `sniffFormat`, `importStravaArchive` e `importActivityFiles` (tipos, repetidas, cancelamento e retomada, ZIP sem CSV, erros de gravação) | ZIPs de `zipFile`/`gz`; `db` e `shoes` simulados; `parse-fit`/`parse-tcx` trocados por dublês que leem uma especificação JSON do arquivo sintético; GPX das fixtures |

Use só **dados sintéticos**: nunca coloque no repositório um arquivo de exportação real (ele traz dados pessoais).

## Helpers de arquivo

### `tests/helpers/fit-builder.ts`

Escritor FIT mínimo para os testes do decodificador, independente do encoder de treinos do app (só reaproveita `fitCrc`): cabeçalho, mensagens de definição e de dados (qualquer ordem de bytes, campos de desenvolvedor, cabeçalho de timestamp comprimido) e CRC. Exporta `FitBuilder`, `fitTime(ms)` (epoch ms → segundos FIT), `semi(graus)` (graus → semicírculos) e os tipos `FitType`, `FieldSpec`, `FieldValue`.

### `tests/helpers/make-zip.ts`

Gera ZIPs em memória com `node:zlib`: `makeZip(entries, { zip64?, comment? })` devolve os bytes; `zipFile(entries, name?)` devolve um `File`; `gz(dados)` comprime em gzip. Cada `ZipSpec` escolhe `method` (0, 8 ou outro), `utf8`, `rawName`, `dataDescriptor` e `encrypted` (só a flag), para testar os casos especiais do leitor.

## Helper de confirmação (`tests/helpers/confirm.ts`)

```ts
import { answerConfirm } from './helpers/confirm';

button.click();                                   // dispara confirmDialog()
const shown = await answerConfirm(true);          // espera .confirm-modal e clica OK (false = Cancelar)
expect(shown.title).toBe('Delete goal');
```

Retorna `{ title, message, dialog }`. Usado em `backup-section`, `insights-screen`, `gear-screen` e `workout-export`. Exige jsdom.

## Fixtures

`tests/fixtures/runs/` contém GPX realistas no estilo Strava (loop no Lago Ingá, Maringá) com FC, cadência, temperatura, altitude, uma parada em semáforo em alguns arquivos e potência em um deles (`intervalado-5x1000`).

```bash
npm run fixtures                 # data final padrão 2026-10-31
npm run fixtures -- 2026-10-31   # data final explícita
```

- Script: `scripts/make-fixtures.mjs`; gerador pseudoaleatório com semente fixa (determinístico).
- Cobre as 5 semanas até a data final: corridas leves, longões, intervalados (6x800, 5x1000, 8x400), tempo runs e um regenerativo.
- **Apaga todos os arquivos** de `tests/fixtures/runs/` antes de escrever.
- Nome: `YYYY-MM-DD-<treino-sem-acento>.gpx`. Os testes localizam arquivos por trecho do nome (`readdirSync(dir).find((f) => f.includes(match))`), não por data.

Uso nos testes:

```ts
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs');
const points = parseActivityGpx(fs.readFileSync(path.join(dir, name), 'utf8')).points;
```

## Checklist para um teste novo

1. Arquivo em `tests/<assunto>.test.ts`.
2. Precisa de DOM? Primeira linha `// @vitest-environment jsdom`.
3. Toca `db.ts`, `chart-theme`, `map/base` ou rede? Use os mocks acima. Precisa de um FIT ou ZIP? Gere com `FitBuilder` ou `makeZip`/`zipFile`.
4. Monta tela? Verifique o cleanup (gráficos destruídos, mapa removido, listeners cancelados) e reaja a `onDataChange`/`setLang`.
5. Confirmações: `answerConfirm`.
6. Rode `npm test -- tests/<arquivo>` e depois `npm run typecheck`.

## Veja também

- [Convenções](conventions.md)
- [Como adicionar uma tela](adding-a-screen.md)
- [Comandos](../reference/commands.md)
- [Componentes de UI](../architecture/ui-components.md)
