<!-- docs-tree: docs/development/adding-a-screen.md | parent: docs/development/README.md -->
# Como adicionar uma tela

> **Árvore:** [docs](../README.md) › [development](README.md) › adding-a-screen
> **Resumo:** Receita passo a passo para criar uma tela nova: pasta, `mount`, rota, item de menu, rótulo traduzido, dicionário, CSS com prefixo, dados e testes.
> **Código:** `src/app/router.ts`, `src/app/screen.ts`, `src/i18n/en.ts`, `src/i18n/pt-BR.ts`, `src/screens/*/`

Exemplo usado abaixo: uma tela "Clima" em `/weather`, prefixo CSS `wx-`.

## 1. Pasta da tela

```
src/screens/weather/
├── index.ts      mount + eventos + render
├── i18n.ts       dicionários en / pt-BR com defineMessages
├── weather.css   estilos com prefixo wx-
└── calc.ts       (opcional) lógica pura, testável sem DOM
```

## 2. Dicionário (`i18n.ts`)

```ts
import { defineMessages } from '../../i18n';

const en = {
  title: 'Weather',
  empty: 'No runs yet.',
};

const ptBR: Record<keyof typeof en, string> = {
  title: 'Clima',
  empty: 'Nenhuma corrida ainda.',
};

export type WxKey = keyof typeof en;
export const tr = defineMessages<WxKey>({ en, 'pt-BR': ptBR });
```

## 3. `index.ts` com `mount` e cleanup

```ts
import './weather.css';
import { listActivities, onDataChange } from '../../data/db';
import { onLangChange } from '../../i18n';
import type { ScreenMount } from '../../app/screen';
import type { Activity } from '../../data/types';
import { tr } from './i18n';

export const mount: ScreenMount = (root) => {
  root.classList.add('wx-root');
  let disposed = false;
  let loadId = 0;
  let activities: Activity[] = [];

  function render(): void {
    root.innerHTML = `
      <div class="page wx-page">
        <header class="page-header"><h1>${tr('title')}</h1></header>
        ${activities.length ? '' : `<div class="empty-state"><p>${tr('empty')}</p></div>`}
      </div>`;
  }

  async function load(): Promise<void> {
    const id = ++loadId;
    const list = await listActivities();
    if (disposed || id !== loadId) return;
    activities = list;
    render();
  }

  const offData = onDataChange((store) => {
    if (store === 'activities') void load();
  });
  const offLang = onLangChange(render);
  render();
  void load();

  return () => {
    disposed = true;
    offData();
    offLang();
    root.classList.remove('wx-root');
  };
};
```

Checklist do cleanup: mapas (`map.remove()`), gráficos (`chart.destroy()`), timers, listeners em `window`/`document` (ou `{ signal }` de um `AbortController`), `<dialog>` aberto, classes no `root`. Texto do usuário em `innerHTML` passa por um `esc` (copie o padrão de `src/screens/activity/dom.ts`).

## 4. Rota e item de menu (`src/app/router.ts`)

1. Acrescente o id ao tipo `NavId`:

   ```ts
   export type NavId = 'routes' | 'activity' | 'training' | 'history' | 'insights' | 'settings' | 'weather';
   ```

2. Acrescente a `NAV_ITEMS` (a ordem do array é a ordem do menu). `icon` é o conteúdo de um `<svg viewBox="0 0 24 24">` com traço, no mesmo estilo dos demais:

   ```ts
   { id: 'weather', path: '/weather', label: 'navWeather', icon: '<circle cx="12" cy="12" r="4"/>' },
   ```

3. Acrescente a `ROUTES` (import dinâmico → chunk próprio):

   ```ts
   { path: '/weather', nav: 'weather', load: () => import('../screens/weather') },
   { path: '/weather/:id', nav: 'weather', load: () => import('../screens/weather') }, // se precisar de parâmetro
   ```

Rotas de detalhe podem destacar outro item do menu (ex.: `/compare/...` usa `nav: 'history'`). Para estado que não deve remontar a tela (filtros, abas), use a query do hash (`currentQuery()`) e escute `hashchange` na própria tela, como faz `screens/history`.

## 5. Rótulo do menu (dicionário global)

`label` é uma `MessageKey`, então vai nos **dois** arquivos globais:

```ts
// src/i18n/en.ts
navWeather: 'Weather',
// src/i18n/pt-BR.ts
navWeather: 'Clima',
```

`pt-BR.ts` é `Record<MessageKey, string>`: se faltar a chave, o `tsc` falha.

## 6. CSS com prefixo (`weather.css`)

```css
/* Weather screen. Everything is scoped under .wx-root. */

.wx-root .wx-page {
  gap: 16px;
}
```

- Escolha um prefixo curto e único (existentes: `rm-`, `act-`, `trn-`, `his-`, `cmp-`, `ins-`, `gear-`, `set-`, `ap-`, `bk-`).
- Use tokens (`var(--surface)`, `var(--muted)`) e os blocos globais (`.page`, `.card`, `.btn`, `.stat-grid`…).
- Cores próprias: token local com override em `:root[data-theme='dark'] .wx-root`.

## 7. Dados

- Ler/gravar com as funções de `src/data/db.ts`; unidades internas (m, s, s/km, epoch ms).
- Precisa de uma store nova? Adicione a `StoreName` e `STORES` em `db.ts` e incremente `DB_VERSION`. A store passa a entrar automaticamente em backups (`STORES`). Documente o formato em [data-model.md](../architecture/data-model.md).
- Preferências simples: `localStorage` com chave `lapwing:weather:<algo>`, em `try/catch`.

## 8. Testes

| Teste | Arquivo | Ambiente |
|---|---|---|
| Lógica pura | `tests/weather.test.ts` | Node |
| Tela montada | `tests/weather-screen.test.ts` | `// @vitest-environment jsdom` |

No teste de tela: mock de `../src/data/db` (e de `chart-theme`/`map/base` se houver), `await import('../src/screens/weather')`, monte num `div`, verifique o render, um `onDataChange` simulado, `setLang('pt-BR')` e o cleanup. Ver [testing.md](testing.md).

## 9. Verificação final

```bash
npm run typecheck
npm test
npm run dev   # navegue até #/weather nos dois idiomas e nos dois temas
```

Troque o tema com a tela aberta: ela deve remontar sem vazar gráficos/mapas (o shell chama o cleanup).

## Telas desativadas

`src/screens/gear/` (tela de tênis desativada: código mantido, fora do roteador) é um exemplo de tela sem rota. Para reativá-la seria preciso refazer os passos 4 e 5 (`NavId`, `NAV_ITEMS`, `ROUTES` e rótulo `navGear`, que ainda existe nos dicionários globais).

## Veja também

- [Visão geral da arquitetura](../architecture/overview.md)
- [Convenções](conventions.md)
- [i18n](../architecture/i18n.md)
- [Tema](../architecture/theming.md)
