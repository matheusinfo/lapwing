<!-- docs-tree: docs/architecture/ui-components.md | parent: docs/architecture/README.md -->
# Componentes de UI compartilhados

> **Árvore:** [docs](../README.md) › [architecture](README.md) › ui-components
> **Resumo:** Blocos CSS globais, diálogo de confirmação, toast, tema dos gráficos, mapa base e helpers de escape.
> **Código:** `src/style.css`, `src/ui/confirm.ts`, `src/ui/toast.ts`, `src/ui/chart-theme.ts`, `src/map/base.ts`, `tests/helpers/confirm.ts`

Não há framework de componentes: os "componentes" são classes CSS globais e alguns módulos utilitários.

## Blocos CSS (`src/style.css`)

Lista do cabeçalho do arquivo:

| Classe | Uso |
|---|---|
| `.page` | Conteúdo rolável da tela, com padding e largura máxima |
| `.page-header` | Linha de título (`h1` + ações) |
| `.card`, `.card-title` | Painel de superfície e seu título |
| `.btn` | Botão; variantes `.primary`, `.ghost`, `.danger` (texto vermelho), `.danger-solid` (vermelho cheio, confirma ação destrutiva), `.small` |
| `.modal` | Painel `<dialog>`: `.modal-body`, `.modal-title`, `.modal-message`, `.modal-actions` |
| `.stat-grid` / `.stat` | Grade de blocos (`dt` rótulo + `dd` valor) |
| `.badge` | Pílula; `.good`, `.warn`, `.bad` |
| `.empty-state` | Placeholder amigável sem dados |
| `.dropzone` | Área de soltar arquivo (`.dragging` enquanto há arquivo por cima) |
| `.table` | Tabela simples |
| `.field` | Rótulo + input/select/textarea empilhados |
| `.switch` | Toggle (`input` + `.switch-track` + texto) |
| `.muted` | Texto secundário |

Também globais: o shell (`.app-nav`, `.nav-item`, `.app-main`, `.screen`, `.screen-message`), `#toast` e ajustes dos controles do MapLibre no tema escuro.

Estilos específicos ficam no CSS da tela, sob um prefixo próprio (ver [conventions.md](../development/conventions.md#css)).

## Diálogo de confirmação (`src/ui/confirm.ts`)

Substitui `window.confirm()` em todo o app.

```ts
import { confirmDialog } from '../../ui/confirm';
import { t as tg } from '../../i18n';

if (!(await confirmDialog({ title, message, confirmLabel: tg('dlgDelete'), tone: 'danger' }))) return;
```

| Opção (`ConfirmOptions`) | Descrição |
|---|---|
| `title` | Título (`textContent`) |
| `message` | Texto puro via `textContent` (nomes de usuário são seguros); quebras de linha mantidas |
| `confirmLabel` | Rótulo do botão de ação |
| `cancelLabel?` | Padrão `t('dlgCancel')` |
| `tone?` | `'danger'` (botão `.btn.danger-solid`, classe `is-danger`) para apagar/substituir dados; `'primary'` (padrão, `.btn.primary`) |

Comportamento:

- Cria um `<dialog class="modal confirm-modal" role="alertdialog">` com `aria-labelledby`/`aria-describedby`, abre com `showModal()` (ou atributo `open` como fallback).
- O foco vai para **Cancelar**. `Esc` e clique no backdrop cancelam.
- Resolve `true`/`false` uma única vez e remove o elemento.
- `dismissConfirms()` cancela todos os abertos; `main.ts` chama ao trocar de tela.
- Após o `await`, cheque se a tela ainda está montada (`disposed`) antes de agir.

Rótulos prontos no dicionário global: `dlgDelete`, `dlgReplace`, `dlgDisconnect`, `dlgRestore`, `dlgDeleteRun`, `dlgDeleteGoal`, `dlgDeletePlan`, `dlgDeleteWorkout`, `dlgDeleteShoe`, `dlgReplaceSteps`, `dlgDisconnectStrava`, `dlgForgetStrava`, `dlgReplaceData`.

Testes: `answerConfirm(answer)` em `tests/helpers/confirm.ts` espera o diálogo, clica e devolve `{ title, message, dialog }` (ver [testing.md](../development/testing.md)).

## Toast (`src/ui/toast.ts`)

```ts
showToast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void
```

- Escreve em `#toast` (de `index.html`) via `textContent`, define `data-kind` e adiciona `.visible`.
- Some após 4 s; uma nova chamada reinicia o temporizador (um toast por vez).
- Cores: `--toast-bg` (info), `--toast-warn` (warn), `--bad-fill` (error). `role="status"` anuncia para leitores de tela.

## Tema dos gráficos (`src/ui/chart-theme.ts`)

- Importe `Chart` **daqui**, não de `chart.js`: o módulo registra todos os tipos (`registerables`) e aplica padrões.
- Padrões: fonte de sistema 12 px, `maintainAspectRatio: false`, `animation: false`, tooltip/interação `mode: 'index'` sem `intersect`, legenda com `boxWidth` 12.
- `chartColors`: getters `accent`, `pace`, `hr`, `ele`, `cad`, `power`, `grid`, `muted`, `accentHover`, `surface` (lidos dos tokens) e `zones` (5 cores fixas, frio → quente).
- Sempre `chart.destroy()` no cleanup.

## Mapa base (`src/map/base.ts`)

| Export | Descrição |
|---|---|
| `maplibregl` | Reexporta o MapLibre com o worker configurado (`setWorkerUrl` para o `maplibre-gl-worker.mjs?url` do Vite) |
| `STYLE_URL`, `DARK_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` e `…/styles/dark` |
| `mapStyleUrl()` | Estilo do tema efetivo |
| `createBaseMap(container, options?)` | `new Map` com estilo do tema, `NavigationControl` sem bússola (canto superior direito), `ScaleControl` métrica (inferior esquerdo), log de erros |
| `whenLoaded(map)` | Promise que resolve quando o estilo carregou (imediata se já carregou) |

Regras: adicione sources/layers só depois de `whenLoaded()`; chame `map.remove()` no unmount. O editor de rotas adiciona `GeolocateControl` e guarda a vista em `lapwing:view`.

## Escape de HTML (`esc`)

Cada feature tem seu próprio `esc`, todos com a mesma regra: substitui `< > & ' "` por entidades.

| Arquivo | Exportado? |
|---|---|
| `src/screens/activity/dom.ts` | sim (também usado por `compare`) |
| `src/screens/training/view.ts` | sim |
| `src/screens/history/filter-view.ts` | sim |
| `src/screens/insights/view.ts` | sim |
| `src/screens/gear/dialogs.ts` | sim (tela desativada) |
| `src/screens/settings/strava-section.ts`, `backup-section.ts` | não (local) |
| `src/gpx/export.ts` (`escapeXml`), `src/screens/activity/export-gpx.ts` | escape XML para GPX |
| `src/screens/training/export.ts` (`xml`, `icsEscape`) | XML do TCX (remove também caracteres de controle) e texto ICS |

Use `esc()` ao interpolar texto do usuário (nomes, notas, nomes de arquivo) em `innerHTML`; prefira `textContent` em atualizações diretas.

## Veja também

- [Tema](theming.md)
- [i18n](i18n.md)
- [Convenções](../development/conventions.md)
- [Testes](../development/testing.md)
