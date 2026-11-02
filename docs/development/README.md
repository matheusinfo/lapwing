<!-- docs-tree: docs/development/README.md | parent: docs/README.md -->
# Desenvolvimento

> **Árvore:** [docs](../README.md) › development
> **Resumo:** Como preparar o ambiente, testar, seguir as convenções do código e adicionar telas ao Lapwing.
> **Código:** `package.json`, `vite.config.ts`, `tsconfig.json`, `tests/`, `scripts/`

## Conteúdo

```
docs/development/
├── README.md            este índice
├── setup.md             requisitos (Node), comandos npm, build e implantação do dist/ estático
├── testing.md           Vitest, ambiente jsdom, mocks do banco, helpers (confirmação, FIT, ZIP), fixtures GPX
├── conventions.md       unidades, escape, cleanup, guardas assíncronas, prefixos CSS, i18n, tokens de cor
└── adding-a-screen.md   receita passo a passo para uma nova tela (rota, menu, i18n, CSS, testes)
```

## Atalhos

- Primeira vez no projeto: [setup.md](setup.md) → [conventions.md](conventions.md).
- Antes de abrir um PR: `npm run build` (inclui typecheck de app e testes) e `npm test`. Não há script de lint.
- Nova funcionalidade com tela própria: [adding-a-screen.md](adding-a-screen.md).

## Veja também

- [Arquitetura](../architecture/README.md)
- [Comandos](../reference/commands.md)
- [Primeiros passos](../getting-started/)
