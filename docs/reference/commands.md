<!-- docs-tree: docs/reference/commands.md | parent: docs/reference/README.md -->
# Comandos e atalhos

> **Árvore:** [docs](../README.md) › [reference](README.md) › commands
> **Resumo:** Todos os scripts npm do projeto e todos os atalhos de teclado, mouse e toque do editor de rotas.
> **Código:** `package.json`, `scripts/make-fixtures.mjs`, `src/screens/routes/toolbar.ts`, `src/screens/routes/route/editor.ts`, `src/screens/routes/index.ts`, `src/ui/confirm.ts`

## Scripts npm

| Script | Comando real | Uso |
|---|---|---|
| `npm run dev` | `vite` | Servidor de desenvolvimento |
| `npm run build` | `tsc --noEmit && tsc --noEmit -p tests && vite build` | Typecheck de app e testes + build de produção em `dist/` |
| `npm run preview` | `vite preview` | Serve o `dist/` gerado |
| `npm test` | `vitest run` | Suíte completa uma vez |
| `npm run typecheck` | `tsc --noEmit && tsc --noEmit -p tests` | Só TypeScript |
| `npm run fixtures` | `node scripts/make-fixtures.mjs` | Regenera `tests/fixtures/runs/` (apaga os arquivos existentes) |

Variações úteis:

```bash
npm test -- tests/geo.test.ts                                # um arquivo
npm test -- tests/training-screen.test.ts -t "matches a run" # um teste pelo nome
npx vitest                                                   # modo watch
npm run fixtures -- 2026-10-31                               # fixtures até essa data (padrão 2026-10-31)
```

Não há script de lint nem de formatação.

## Editor de rotas

### Mouse

| Gesto | Onde | Ação |
|---|---|---|
| Clique | Mapa (fora da rota) | Adiciona um ponto no fim da rota |
| Clique | Linha da rota | Insere um ponto naquele lugar, sem recalcular o trecho |
| Arrastar | Marcador | Move o ponto (prévia tracejada; os trechos vizinhos são recalculados ao soltar) |
| Botão direito | Marcador | Apaga o ponto |
| Botão direito | Linha da rota | Alterna o trecho entre **reto forçado** e **seguindo caminhos** |
| Duplo clique | Mapa | Nada (zoom por duplo clique desativado para não criar dois pontos) |
| Arrastar arquivo | Tela | Solta um `.gpx` para abri-lo (sobreposição "Solte um arquivo GPX para abri-lo") |

### Toque

| Gesto | Onde | Ação |
|---|---|---|
| Toque | Mapa / linha | Igual ao clique |
| Toque longo (600 ms) | Marcador | Apaga o ponto |
| Toque longo | Linha da rota | Alterna reto/caminho (via evento `contextmenu`, que a maioria dos navegadores móveis dispara) |
| Arrastar | Marcador | Move o ponto |

Um segundo "apagar" no mesmo marcador em menos de 1 s é ignorado (alguns navegadores disparam toque longo e `contextmenu` juntos).

### Teclado

| Atalho | Ação |
|---|---|
| `Ctrl+Z` / `⌘Z` | Desfazer |
| `Ctrl+Y` / `⌘Y` | Refazer |
| `Ctrl+Shift+Z` / `⌘⇧Z` | Refazer |

Os atalhos não agem enquanto o foco está em `input`, `textarea`, `select` ou elemento editável (ex.: o campo de nome da rota). Histórico de até 100 passos.

### Barra de ferramentas

| Botão | Ação | Desabilitado quando |
|---|---|---|
| Open GPX / Abrir GPX | Abre um arquivo `.gpx` como trecho importado | — |
| Export GPX / Exportar GPX | Baixa a rota como `<nome>.gpx` | < 2 pontos |
| Desfazer / Refazer | Histórico | Nada a desfazer/refazer |
| Inverter sentido | Inverte a rota | < 2 pontos |
| Fechar circuito | Adiciona um trecho de volta ao início | < 2 pontos ou já é circuito |
| Limpar rota | Apaga tudo (desfazível) | Sem pontos |

### Controles do mapa

- Zoom (`+`/`−`) e escala métrica: `createBaseMap()`.
- Geolocalização (canto superior direito, alta precisão): centraliza na posição do usuário.
- A vista (centro e zoom) é lembrada em `lapwing:view`.

### Campos do painel

| Campo | Comportamento |
|---|---|
| Nome da rota | Até 80 caracteres; salvo em `lapwing:name`; vira o nome do GPX exportado |
| Pace | `m:ss` ou minutos (`6`, `5.5`, `5,5`); calcula o tempo estimado; borda de erro se inválido; salvo em `lapwing:pace` |

## Diálogos de confirmação (todas as telas)

| Tecla / gesto | Ação |
|---|---|
| `Esc` | Cancela |
| Clique fora do painel | Cancela |
| `Tab` | Navega; o foco inicial é **Cancelar** |

Trocar de tela cancela qualquer confirmação aberta.

## Veja também

- [Motor do editor de rotas](../architecture/routing-engine.md)
- [Ambiente e implantação](../development/setup.md)
- [Testes](../development/testing.md)
- [Guia: rotas](../features/routes.md)
