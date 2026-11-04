<!-- docs-tree: docs/README.md | parent: ../README.md -->
# Documentação do Lapwing

> **Árvore:** docs (raiz)
> **Resumo:** Mapa completo da documentação, com uma linha por página. Comece por aqui.
> **Código:** todo o repositório

## Como esta documentação é organizada

A documentação é uma **árvore**: cada pasta é um ramo, e cada arquivo `.md` é uma folha.

- Toda pasta tem um `README.md`, que é o índice daquele ramo.
- Toda página começa com o mesmo cabeçalho:
  - um comentário `<!-- docs-tree: <caminho> | parent: <índice pai> -->`, fácil de ler por máquinas;
  - a linha **Árvore**, com o caminho clicável até a raiz;
  - um **Resumo** de uma frase;
  - **Código** ou **Tela**, com os arquivos ou a tela que a página descreve.
- Toda página termina com **Veja também**, com links para as páginas vizinhas.

**Para assistentes de IA:** leia este arquivo, escolha o ramo pelo resumo e desça pelos índices. Não é preciso ler a árvore inteira. Os caminhos de código citados são relativos à raiz do repositório.

## Árvore completa

```
docs/
├── README.md                          — este mapa
├── overview.md                        — o que é o Lapwing, princípios e visão geral das telas
├── privacy.md                         — onde ficam os dados e o que sai do aparelho
├── faq.md                             — perguntas frequentes de quem usa
├── images/                            — capturas de tela dos READMEs (pt e en)
│
├── getting-started/                   — para começar
│   ├── README.md                      — índice do ramo
│   ├── install-and-run.md             — instalar o Node, rodar, gerar e publicar o app
│   ├── docker.md                      — subir com Docker/Compose: porta, subpasta, HTTPS e atualização
│   └── first-steps.md                 — roteiro de 10 minutos pelo app
│
├── features/                          — guia de cada tela (linguagem simples)
│   ├── README.md                      — índice do ramo
│   ├── routes.md                      — Rotas: desenhar percursos e exportar GPX
│   ├── analysis.md                    — Análise: importar corridas (GPX, FIT, TCX, .zip do Strava) e ler o relatório
│   ├── training.md                    — Treinos: planos, treinos estruturados e exportação
│   ├── history.md                     — Histórico: tendências, recordes e filtros
│   ├── compare.md                     — Comparar: duas corridas lado a lado
│   ├── insights.md                    — Metas: metas, previsões de prova e alertas de carga
│   └── settings/                      — Ajustes
│       ├── README.md                  — índice do ramo
│       ├── appearance.md              — tema claro, escuro ou do sistema
│       ├── zones.md                   — zonas de FC e de pace
│       ├── strava.md                  — conectar e sincronizar com o Strava
│       └── backup.md                  — baixar e restaurar backups
│
├── architecture/                      — como o código funciona por dentro
│   ├── README.md                      — índice do ramo
│   ├── overview.md                    — shell, roteador, telas e árvore de src/
│   ├── data-model.md                  — stores do IndexedDB, tipos e unidades
│   ├── storage-and-migration.md       — chaves de armazenamento e migração Route Maker → Lapwing
│   ├── routing-engine.md              — editor de rotas: estado, fila do BRouter e encaixe
│   ├── analysis-and-metrics.md        — resumos, melhores esforços, TRIMP, previsões e alertas
│   ├── i18n.md                        — traduções em português e inglês
│   ├── theming.md                     — tokens de cor e tema claro/escuro
│   ├── ui-components.md               — blocos de CSS, modal de confirmação, toast, gráficos e mapa
│   └── external-services.md           — OpenFreeMap, BRouter e Strava
│
├── development/                       — para quem contribui
│   ├── README.md                      — índice do ramo
│   ├── setup.md                       — requisitos, comandos e publicação
│   ├── testing.md                     — Vitest, jsdom, mocks, helpers FIT/ZIP e fixtures
│   ├── conventions.md                 — regras de código do projeto
│   └── adding-a-screen.md             — receita para criar uma tela nova
│
└── reference/                         — consulta rápida
    ├── README.md                      — índice do ramo
    ├── file-formats.md                — GPX/FIT/TCX de atividade, .zip do Strava, CSV/JSON de plano, backup, ICS, TCX e FIT
    ├── commands.md                    — scripts npm e atalhos do editor de rotas
    └── glossary.md                    — termos de corrida e de código (pt-BR ↔ inglês)
```

## Por onde começar

| Você quer… | Leia |
|---|---|
| Entender o que é o app | [overview.md](overview.md) |
| Rodar no seu computador | [getting-started/install-and-run.md](getting-started/install-and-run.md) |
| Subir num servidor com Docker | [getting-started/docker.md](getting-started/docker.md) |
| Aprender a usar | [getting-started/first-steps.md](getting-started/first-steps.md), depois [features/](features/README.md) |
| Saber onde ficam seus dados | [privacy.md](privacy.md) |
| Mexer no código | [development/](development/README.md) e [architecture/](architecture/README.md) |
| Consultar um formato de arquivo | [reference/file-formats.md](reference/file-formats.md) |

## Outros arquivos úteis na raiz do repositório

- [`README.md`](../README.md): apresentação do projeto.
- [`LICENSE`](../LICENSE): licença MIT.
- [`llms.txt`](../llms.txt): ponto de entrada curto para assistentes de IA.
- [`.github/copilot-instructions.md`](../.github/copilot-instructions.md): resumo das convenções para assistentes de código.

## Veja também

- [Visão geral](overview.md)
- [Perguntas frequentes](faq.md)
