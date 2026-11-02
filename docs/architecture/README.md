<!-- docs-tree: docs/architecture/README.md | parent: docs/README.md -->
# Arquitetura

> **Árvore:** [docs](../README.md) › architecture
> **Resumo:** Como o Lapwing funciona por dentro: shell, roteador, dados, cálculos, i18n, tema, componentes e serviços externos.
> **Código:** `src/`

## Conteúdo

```
docs/architecture/
├── README.md                    este índice
├── overview.md                  shell, roteador por hash, telas lazy, ScreenMount, notificações, mapa de módulos
├── data-model.md                stores do IndexedDB, todos os tipos, unidades, DB_VERSION
├── storage-and-migration.md     chaves de localStorage/sessionStorage, migração Route Maker → Lapwing, backups
├── routing-engine.md            editor de rotas: RouteState, segmentos, RoutingQueue, BRouter, snapping, undo
├── analysis-and-metrics.md      resumo, tempo em movimento, melhores esforços, zonas, TRIMP, previsões, alertas
├── i18n.md                      dicionários global e por tela, defineMessages, translateDom, onLangChange
├── theming.md                   tokens CSS, data-theme, script inicial, API de theme.ts, rebuild de gráficos/mapas
├── ui-components.md             blocos CSS compartilhados, confirmDialog, toast, chart-theme, mapa base, esc
└── external-services.md         OpenFreeMap, BRouter, Strava; o que sai do dispositivo e quando
```

## Ordem de leitura sugerida

1. [overview.md](overview.md) — visão geral e mapa de diretórios.
2. [data-model.md](data-model.md) e [storage-and-migration.md](storage-and-migration.md) — onde os dados vivem.
3. O tópico que você vai mexer: [routing-engine.md](routing-engine.md), [analysis-and-metrics.md](analysis-and-metrics.md), [i18n.md](i18n.md), [theming.md](theming.md), [ui-components.md](ui-components.md) ou [external-services.md](external-services.md).

## Princípios

- **Só navegador:** não há backend. Todos os dados ficam em IndexedDB e `localStorage` do usuário.
- **Sem framework de UI:** telas renderizam templates DOM com delegação de eventos.
- **Domínio separado das telas:** `src/data/`, `src/gpx/`, `src/geo.ts` e `src/format.ts` não dependem de telas.
- **Unidades internas fixas:** metros, segundos, s/km, epoch ms, `[lon, lat]`.

## Veja também

- [Desenvolvimento](../development/README.md)
- [Referência](../reference/README.md)
- [Visão geral do produto](../overview.md)
