<!-- docs-tree: docs/overview.md | parent: docs/README.md -->
# Visão geral

> **Árvore:** [docs](README.md) › overview
> **Resumo:** O que é o Lapwing, os princípios que guiam o projeto e um mapa das telas.
> **Código:** `src/main.ts`, `src/app/router.ts`

## O que é

O Lapwing é um app de corrida que roda **inteiro no navegador**. Ele junta quatro coisas que normalmente ficam espalhadas em apps diferentes:

1. **Planejar o percurso**: desenhar rotas no mapa e exportar para o relógio.
2. **Entender cada corrida**: importar o arquivo da corrida e ver um relatório detalhado.
3. **Seguir um plano**: montar ou gerar um plano de treinos e ver o que já foi feito.
4. **Acompanhar a evolução**: histórico, recordes, metas, previsões de prova e alertas de excesso de treino.

O projeto se chamava **Route Maker** no começo. O nome mudou para **Lapwing** (quero-quero, em inglês), e os dados de quem já usava são migrados automaticamente.

## Princípios

| Princípio | Na prática |
|---|---|
| **Seus dados ficam com você** | Tudo é salvo no navegador (IndexedDB e localStorage). Não há servidor nem conta. |
| **Funciona sem cadastro** | Abriu, usou. O Strava é opcional (e exige assinatura do Strava). |
| **Simples por fora** | Telas diretas, textos curtos, português e inglês. |
| **Leve por dentro** | TypeScript puro, sem framework de interface. Só MapLibre (mapas) e Chart.js (gráficos) como dependências. |
| **Formatos abertos** | Entra e sai GPX, CSV, JSON, ICS, TCX e FIT, para você nunca ficar preso ao app. |

## Mapa das telas

| Menu | Endereço | O que faz | Guia |
|---|---|---|---|
| Hoje | `#/today` (tela inicial) | Treino do dia, forma e alertas, metas e a última corrida | [features/today.md](features/today.md) |
| Rotas | `#/routes` | Desenhar percursos e exportar GPX | [features/routes.md](features/routes.md) |
| Análise | `#/activity`, `#/activity/<id>` | Importar corridas e ver o relatório de cada uma | [features/analysis.md](features/analysis.md) |
| Treinos | `#/training` | Planos de treino, treinos estruturados e exportação | [features/training.md](features/training.md) |
| Histórico | `#/history` | Tendências, recordes, calendário e filtros | [features/history.md](features/history.md) |
| (pelo Histórico ou relatório) | `#/compare/<a>/<b>` | Comparar duas corridas | [features/compare.md](features/compare.md) |
| Metas | `#/insights` | Metas, previsões de prova e alertas de carga | [features/insights.md](features/insights.md) |
| Ajustes | `#/settings` | Tema, Strava e backup | [features/settings/](features/settings/README.md) |

## Como as peças se encaixam

```
Navegador
└── index.html ─ aplica o tema salvo antes da primeira pintura
    └── src/main.ts ─ menu, idioma, tema e roteador por hash (#/…)
        ├── src/screens/<tela>/   ─ cada tela é carregada sob demanda
        ├── src/data/             ─ IndexedDB, tipos, importação, métricas, Strava, backup
        ├── src/ui/               ─ tema, modal de confirmação, toast, gráficos
        ├── src/map/base.ts       ─ mapa MapLibre com estilo claro ou escuro
        └── src/i18n/             ─ textos em português e inglês

Serviços externos (só quando necessário)
├── OpenFreeMap ─ imagens do mapa
├── BRouter     ─ cálculo de caminhos no editor de rotas
└── Strava      ─ opcional, só se você conectar (exige assinatura do Strava)
```

Os detalhes técnicos estão em [architecture/overview.md](architecture/overview.md).

## Veja também

- [Primeiros passos](getting-started/first-steps.md)
- [Privacidade](privacy.md)
- [Arquitetura](architecture/README.md)
