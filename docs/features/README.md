<!-- docs-tree: docs/features/README.md | parent: docs/README.md -->
# Funcionalidades — guia de cada tela

> **Árvore:** [docs](../README.md) › features
> **Resumo:** Índice do guia de uso: uma página por tela do Lapwing, em linguagem simples.
> **Tela:** todas · **Código:** `src/screens/`

## Como ler este ramo

Cada página explica uma tela do app, do jeito que você a vê no menu. Todas seguem a mesma ordem:

1. **Para que serve**: o que a tela faz, em poucas linhas.
2. **Como usar**: passo a passo.
3. **Detalhes**: regras, limites e valores padrão.
4. **Dicas** e **Perguntas comuns**.
5. **Veja também**: páginas vizinhas e as páginas técnicas relacionadas.

Os nomes de botões aparecem em **negrito**, exatamente como estão no app em português.

> O Lapwing se chamava **Route Maker** antes. Se você usava o Route Maker neste mesmo navegador, seus dados foram levados para o Lapwing automaticamente.

## Árvore

```
features/
├── README.md       — este índice
├── today.md        — Hoje: tela inicial com o treino do dia, forma e alertas, metas e a última corrida
├── routes.md       — Rotas: desenhar percursos no mapa e exportar GPX
├── analysis.md     — Análise: importar corridas (GPX, FIT, TCX ou o .zip do Strava) e ler o relatório de cada uma
├── training.md     — Treinos: planos, treinos estruturados, ligação com corridas e exportação
├── history.md      — Histórico: totais, tendências, recordes, calendário e filtros
├── compare.md      — Comparar: duas corridas lado a lado
├── insights.md     — Metas: metas, previsões de prova e alertas de carga
└── settings/       — Ajustes: aparência, zonas de treino, Strava e backup
    ├── README.md
    ├── appearance.md
    ├── zones.md
    ├── strava.md
    └── backup.md
```

## Páginas

| Menu | Endereço | Página |
|---|---|---|
| **Hoje** (tela inicial) | `#/today` | [today.md](today.md) |
| **Rotas** | `#/routes` | [routes.md](routes.md) |
| **Análise** | `#/activity` e `#/activity/<id>` | [analysis.md](analysis.md) |
| **Treinos** | `#/training` | [training.md](training.md) |
| **Histórico** | `#/history` | [history.md](history.md) |
| (a partir de Histórico ou Análise) | `#/compare/<a>/<b>` | [compare.md](compare.md) |
| **Metas** | `#/insights` | [insights.md](insights.md) |
| **Ajustes** | `#/settings` | [settings/](settings/README.md) |

- [Hoje — o resumo do seu dia](today.md)
- [Rotas — criar percursos no mapa](routes.md)
- [Análise — importar corridas e ler o relatório](analysis.md)
- [Treinos — planos e treinos estruturados](training.md)
- [Histórico — sua evolução ao longo do tempo](history.md)
- [Comparar — duas corridas lado a lado](compare.md)
- [Metas — metas, previsões e alertas](insights.md)
- [Ajustes — aparência, zonas de treino, Strava e backup](settings/README.md)

## Coisas que valem para o app inteiro

- **Tudo fica no seu navegador.** Não existe conta nem servidor do Lapwing. Corridas, planos e metas ficam guardados só neste navegador, neste aparelho. Faça backups de vez em quando ([backup.md](settings/backup.md)).
- **Idioma.** O seletor **EN / PT** fica no menu. O app abre em português quando o navegador está em português.
- **Tema.** O botão de tema no menu alterna entre **Sistema**, **Claro** e **Escuro** ([appearance.md](settings/appearance.md)).
- **Confirmações.** Ações que apagam ou substituem dados abrem uma janela de confirmação com **Cancelar** e um botão vermelho (por exemplo **Excluir**). A tecla Esc ou um clique fora da janela cancela.
- **Unidades.** Distância em km, pace em min/km (minutos por quilômetro), elevação em metros e frequência cardíaca em bpm (batimentos por minuto).

## Veja também

- [Primeiros passos](../getting-started/first-steps.md)
- [Visão geral](../overview.md)
- [Privacidade](../privacy.md)
- [Perguntas frequentes](../faq.md)
- [Glossário](../reference/glossary.md)
