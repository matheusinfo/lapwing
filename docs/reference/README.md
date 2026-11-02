<!-- docs-tree: docs/reference/README.md | parent: docs/README.md -->
# Referência

> **Árvore:** [docs](../README.md) › reference
> **Resumo:** Material de consulta rápida: formatos de arquivo, glossário pt-BR/inglês e comandos/atalhos.
> **Código:** `src/gpx/`, `src/data/{import,parse-fit,parse-tcx,strava-archive,zip}.ts`, `src/screens/training/`, `src/data/backup.ts`, `package.json`, `src/screens/routes/`

## Conteúdo

```
docs/reference/
├── README.md          este índice
├── file-formats.md    GPX, FIT e TCX de atividade (+ .gz), .zip do Strava, ZIP/gzip, CSV/JSON de planos, sintaxe curta de passos, backup (+gzip), ICS, TCX, FIT, query do histórico
├── glossary.md        termos de corrida e de código, em pt-BR e inglês
└── commands.md        scripts npm e atalhos de teclado/mouse/toque do editor de rotas
```

## Quando usar

| Pergunta | Página |
|---|---|
| "Que colunas o CSV de plano aceita?" | [file-formats.md](file-formats.md#csv-de-plano-srcscreenstrainingcsvts) |
| "Como escrevo `8x400` na coluna steps?" | [file-formats.md](file-formats.md#sintaxe-curta-de-treinos-estruturados-structurets) |
| "Que campos do FIT/TCX são lidos? Como o `.zip` do Strava é importado?" | [file-formats.md](file-formats.md#importação-de-atividades-srcdataimportts) |
| "O que é ACWR / TRIMP / VDOT?" | [glossary.md](glossary.md) |
| "Como rodo um teste só?" | [commands.md](commands.md#scripts-npm) |
| "Como deixo um trecho reto no editor?" | [commands.md](commands.md#editor-de-rotas) |

## Veja também

- [Arquitetura](../architecture/README.md)
- [Desenvolvimento](../development/README.md)
- [FAQ](../faq.md)
