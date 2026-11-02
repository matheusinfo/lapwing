<!-- docs-tree: docs/development/setup.md | parent: docs/development/README.md -->
# Ambiente e implantação

> **Árvore:** [docs](../README.md) › [development](README.md) › setup
> **Resumo:** Requisitos, comandos do `package.json`, configuração de TypeScript/Vite e como publicar o `dist/` estático em qualquer host.
> **Código:** `package.json`, `vite.config.ts`, `tsconfig.json`, `tests/tsconfig.json`, `index.html`

## Requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | `^20.19.0 \|\| >=22.12.0` (exigido pelo Vite 8, campo `engines` do pacote `vite`) |
| npm | o que acompanha o Node |
| Navegador | Moderno, com IndexedDB, `<dialog>`, `AbortSignal.any`/`AbortSignal.timeout` (roteamento) e, opcionalmente, `CompressionStream`/`DecompressionStream` (backups `.gz`) e `BroadcastChannel` (sincronização entre abas) |

Dependências (`package.json`):

| Tipo | Pacotes |
|---|---|
| Runtime | `chart.js` ^4.6.1, `maplibre-gl` ^6.16.0 |
| Dev | `typescript` ~5.9, `vite` ^8.3.5, `vitest` ^5.0.5, `jsdom` ^30.1.3, `@types/node` ^24.19.2 |

## Instalação

```bash
npm install
npm run dev
```

O Vite serve a aplicação em modo desenvolvimento (porta padrão do Vite, 5173). Não há variáveis de ambiente nem arquivo `.env`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do Vite |
| `npm run build` | `tsc --noEmit` (app) + `tsc --noEmit -p tests` (testes) + `vite build` → `dist/` |
| `npm run preview` | Serve o `dist/` localmente (`vite preview`) |
| `npm test` | `vitest run` (suíte completa, uma vez) |
| `npm run typecheck` | Só as duas checagens de TypeScript |
| `npm run fixtures [-- YYYY-MM-DD]` | Regenera os GPX de `tests/fixtures/runs/` ([testing.md](testing.md#fixtures)) |

Não há script de lint nem formatter configurado. Lista completa com exemplos em [commands.md](../reference/commands.md).

## Configuração

| Arquivo | Pontos relevantes |
|---|---|
| `tsconfig.json` | `target`/`lib` ES2022 + DOM, `moduleResolution: bundler`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (use `import type`), `isolatedModules`, `types: ['vite/client']`, inclui só `src` |
| `tests/tsconfig.json` | Estende o raiz; adiciona `node` aos tipos; inclui `../src`, `./` e `../vite.config.ts` |
| `vite.config.ts` | Apenas `test.include: ['tests/**/*.test.ts']`; sem `base`, plugins ou aliases |
| `.gitignore` | `node_modules`, `dist` |

Particularidade: o worker do MapLibre é importado como `maplibre-gl/dist/maplibre-gl-worker.mjs?url` e registrado com `setWorkerUrl` em `src/map/base.ts`, porque o MapLibre não acha o worker sozinho depois do bundle.

## Build

`npm run build` gera `dist/` com `index.html` e `assets/`. Cada tela vira um chunk separado (imports dinâmicos em `src/app/router.ts`).

## Implantação

O app é 100 % estático: qualquer host de arquivos serve (GitHub Pages, Netlify, Cloudflare Pages, S3, nginx…).

| Ponto | Detalhe |
|---|---|
| Caminho base | `vite.config.ts` não define `base`, então vale o padrão `/`: os assets são referenciados como `/assets/...`. Para publicar em subcaminho (ex.: `usuario.github.io/lapwing/`), defina `base` no config ou rode `vite build --base=/lapwing/` |
| Rotas | Roteamento por hash (`#/history`): não precisa de regra de rewrite no servidor |
| HTTPS | Recomendado; `crypto.randomUUID` e outras APIs exigem contexto seguro (há fallback para `newId`) |
| Cache | Arquivos em `assets/` têm hash no nome; `index.html` não deve ficar em cache longo |
| Backend | Nenhum. Os dados ficam no navegador de cada usuário, por origem (domínio + porta) |

### Strava em produção

- Cada usuário cria sua própria aplicação de API no Strava.
- "Authorization Callback Domain" deve ser o **hostname** do deploy (ex.: `lapwing.exemplo.com`, sem protocolo nem caminho); em desenvolvimento, `localhost`.
- O retorno do OAuth é `origin + pathname` com `?state=…&code=…`. O host precisa servir o mesmo `index.html` nesse caminho com query string (comportamento padrão de hosts estáticos).
- Detalhes em [external-services.md](../architecture/external-services.md#strava).

### Trocar de domínio

IndexedDB e `localStorage` são por origem. Ao mudar o domínio, os usuários começam vazios: oriente-os a exportar um backup no domínio antigo e restaurar no novo ([backup](../features/settings/backup.md)).

## Veja também

- [Testes](testing.md)
- [Comandos](../reference/commands.md)
- [Serviços externos](../architecture/external-services.md)
- [Primeiros passos](../getting-started/)
