<!-- docs-tree: docs/architecture/theming.md | parent: docs/architecture/README.md -->
# Tema claro/escuro

> **Árvore:** [docs](../README.md) › [architecture](README.md) › theming
> **Resumo:** Tokens de cor CSS, atributo `data-theme`, script inicial do `index.html`, API de `src/ui/theme.ts`, remontagem de gráficos/mapas e como adicionar uma cor.
> **Código:** `src/style.css`, `src/ui/theme.ts`, `index.html`, `src/main.ts`, `src/ui/chart-theme.ts`, `src/map/base.ts`

## Modelo

| Conceito | Valores | Onde fica |
|---|---|---|
| Preferência (`ThemePref`) | `'system' \| 'light' \| 'dark'` (`THEME_PREFS`) | `localStorage['lapwing:theme']` (padrão `system`) |
| Tema efetivo (`Theme`) | `'light' \| 'dark'` | `<html data-theme="…">` |

`system` segue `prefers-color-scheme` e reage à troca do sistema operacional em tempo real.

## Fluxo de aplicação

1. **Antes da primeira pintura** — script inline no `<head>` de `index.html` lê `lapwing:theme`, resolve `system` com `matchMedia` e grava `document.documentElement.dataset.theme`. Evita o "flash" de tema errado.
2. **Ao carregar `theme.ts`** — `readPref()` lê a preferência e `apply()` reaplica `data-theme` e ajusta `<meta name="theme-color">` para o valor de `--surface`.
3. **Ao trocar** — `setThemePref(next)` grava, chama `onThemePrefChange` listeners e `apply()`. Se o tema efetivo mudou (e não é a primeira aplicação), chama os listeners de `onThemeChange`.
4. **Remontagem** — `main.ts` assina `onThemeChange`, zera `currentRoute` e chama `show()`: a tela atual é desmontada e montada de novo, criando gráficos e mapas com as novas cores.

> Mantenha o script inline de `index.html` em sincronia com `THEME_KEY` e as regras de `theme.ts` (o próprio arquivo pede isso).

Quem troca o tema:

| UI | Arquivo |
|---|---|
| Botão `#theme-toggle` (ciclo `system → light → dark`) | `src/main.ts` |
| Cartão "Aparência" (radio) | `src/screens/settings/appearance-section.ts` |

## API de `src/ui/theme.ts`

| Export | Descrição |
|---|---|
| `THEME_PREFS` | `['system', 'light', 'dark']` |
| `getThemePref()` | Preferência atual |
| `getTheme()` | Tema efetivo |
| `setThemePref(pref)` | Persiste e aplica |
| `onThemeChange(fn)` | Quando o tema **efetivo** muda; retorna cancelamento |
| `onThemePrefChange(fn)` | Quando a **preferência** muda (mesmo que o efetivo não mude) |
| `cssVar(name, fallback)` | Valor atual de uma custom property em `<html>` |

## Tokens (`src/style.css`)

Definidos em `:root` (claro) e redefinidos em `:root[data-theme='dark']`.

| Grupo | Tokens |
|---|---|
| Acento | `--accent`, `--accent-strong` (texto/links sobre o fundo), `--accent-hover`, `--accent-soft`, `--on-accent` |
| Texto e superfícies | `--ink`, `--muted`, `--bg`, `--surface`, `--surface-alt`, `--line` |
| Status | `--good`, `--warn`, `--bad`, `--bad-fill`, `--bad-fill-hover` |
| Status suave | `--good-soft`, `--good-ink`, `--warn-soft`, `--warn-ink`, `--warn-line`, `--bad-soft`, `--bad-ink` |
| Início/fim de trajeto | `--start`, `--end` |
| Neutros | `--neutral`, `--neutral-strong` |
| Sobreposições | `--backdrop`, `--toast-bg`, `--toast-warn`, `--shadow`, `--shadow-soft` |
| Calendário | `--heat-1` … `--heat-4` (no escuro a escala vai de escuro para claro) |
| Mapa | `--map-casing` (halo sob linhas de rota) |
| Gráficos | `--chart-pace`, `--chart-hr`, `--chart-ele`, `--chart-cad`, `--chart-power`, `--chart-grid` |
| Layout (não mudam com o tema) | `--radius`, `--nav-width`, `--nav-height` |

Tokens locais de tela também podem ter versão escura, por exemplo `--trn-*` em `training.css` com `:root[data-theme='dark'] .trn-root { … }`, e `--cmp-a`/`--cmp-b` em `compare.css`, que apontam para `--chart-pace`/`--accent`.

## Gráficos e mapas

Chart.js e MapLibre leem cores **na criação**; não há atualização ao vivo, daí a remontagem.

| Biblioteca | Como pega as cores |
|---|---|
| Chart.js | `chartColors` em `src/ui/chart-theme.ts` são getters que chamam `cssVar('--chart-…')`; `applyThemeDefaults()` ajusta `Chart.defaults.color`/`borderColor` e é reexecutada em `onThemeChange` |
| MapLibre | `mapStyleUrl()` escolhe `styles/liberty` (claro) ou `styles/dark` (escuro) do OpenFreeMap; camadas próprias usam `cssVar` (ex.: `--map-casing` no editor de rotas) |
| CSS | `style.css` tem regras para os controles do MapLibre no tema escuro |

Cores ainda fixas em código (não seguem tokens): `chartColors.zones` (zonas de FC), `ROUTE_COLOR`/`PENDING_COLOR` em `screens/routes/map.ts`, rampas de cor em `screens/activity/report-map.ts`, `PLANNED_COLOR` em `screens/training/chart.ts`, e o texto do `#toast` (`#ffffff`).

## Como adicionar uma cor

1. Declare o token em `:root` **e** em `:root[data-theme='dark']` em `src/style.css` (com comentário de uso se não for óbvio).
2. Em CSS, use `var(--meu-token)`; nunca hex direto em regras de tela.
3. Em TypeScript (gráficos/mapas), leia com `cssVar('--meu-token', '#fallback')` no momento da criação. Para gráficos, prefira adicionar um getter em `chartColors`.
4. Se a cor é exclusiva de uma tela, um token com o prefixo da tela (`--trn-…`) no CSS da tela também serve, com override escuro.
5. Teste nos dois temas (`tests/theme.test.ts` cobre a lógica de preferência).

## Veja também

- [Componentes de UI](ui-components.md)
- [Visão geral](overview.md#ciclo-de-show)
- [Guia: aparência](../features/settings/appearance.md)
