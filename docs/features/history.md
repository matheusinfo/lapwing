<!-- docs-tree: docs/features/history.md | parent: docs/features/README.md -->
# Histórico — sua evolução ao longo do tempo

> **Árvore:** [docs](../README.md) › [features](README.md) › history
> **Resumo:** Totais por período, gráficos de volume e pace, condicionamento e fadiga, recordes, calendário de consistência e a tabela de todas as corridas, com filtros.
> **Tela:** `#/history` (com período e filtros no endereço, por exemplo `#/history?range=year`) · **Código:** `src/screens/history/`

## Para que serve

O **Histórico** junta todas as atividades importadas e mostra como você está evoluindo: quanto correu, se está mais rápido, se está cansado ou descansado, quais são seus recordes e em quais dias você treinou. Embaixo fica a lista completa, onde dá para buscar, filtrar, ordenar, excluir e escolher duas corridas para comparar.

## Como usar

1. Escolha o **Período** no topo: **4 semanas**, **12 semanas** (padrão), **Este ano** ou **Tudo**.
2. Leia os totais e os gráficos (veja Detalhes).
3. Na tabela **Corridas**, digite em **Buscar pelo nome** para achar uma corrida.
4. Clique no título de uma coluna para ordenar; clique de novo para inverter a ordem.
5. Clique no nome de uma corrida para abrir o relatório dela.
6. Para filtrar mais, clique em **Filtros** (veja abaixo).
7. Para comparar, marque a caixinha de **duas** corridas e clique em **Comparar**.

### Filtros avançados

Clique em **Filtros** para abrir o painel. Com filtros ligados, o botão mostra quantos estão ativos.

- **Filtros rápidos** (um clique liga, outro desliga):
  - **Longões ≥ 15 km**
  - **Com FC** (só corridas com frequência cardíaca)
  - **Com subida ≥ 200 m**
  - **Provas** (só aparece se você tem planos de treino)
- **Distância (km)**: **Mín.** e **Máx.** (por exemplo `10,5`).
- **Pace (min/km)**: **Mín.** e **Máx.** em `m:ss` (por exemplo `5:30`).
- **Ganho de elevação (m)**: **Mín.** e **Máx.**
- **FC média (bpm)**: **Mín.** e **Máx.**
- **Tipo de atividade**: **Corrida**, **Trilha**, **Caminhada**, **Outro** (pode marcar vários).
- **Tipo de treino**: **Leve**, **Longão**, **Tempo run**, **Intervalado**, **Regenerativo**, **Prova** e **Fora do plano**. Vem das corridas ligadas aos seus planos em **Treinos**; só aparece quando existe algum plano.
- **Data**: **De** e **Até**.

Os filtros ligados aparecem como etiquetas em **Filtros ativos** (por exemplo “Distância ≥ 15 km”). Clique numa etiqueta para remover aquele filtro, ou em **Limpar tudo**. O contador mostra “*N* de *T* corridas” e o quadro **Totais das corridas exibidas** soma só o que está na tela.

## Detalhes

- **Períodos.** “4 semanas” e “12 semanas” contam semanas inteiras (de segunda a domingo), incluindo a semana atual. “Este ano” começa em 1º de janeiro. “Tudo” começa na sua primeira atividade. Todos terminam hoje.
- **Comparação.** Cada total mostra a variação (↑ ou ↓ em %) contra o período anterior de mesmo tamanho (**vs 4 semanas anteriores**, **vs 12 semanas anteriores**, **vs período anterior igual**). Em **Tudo** não há comparação. No pace, a diferença aparece como “*x* /km mais rápido” ou “mais lento”.
- **Totais:** **Distância**, **Corridas**, **Tempo em movimento**, **Ganho de elevação**, **Pace médio**, **FC média** e **Carga de treino**. Entram todas as atividades importadas, inclusive caminhadas.
- **Distância por semana.** Uma barra por semana do período. **Ver dados** abre a tabela com distância, número de corridas e tempo de cada semana.
- **Evolução do pace.** Um ponto por corrida com horário e pelo menos 500 m, mais a **Tendência (média de 5 corridas)**. Mais rápido fica em cima.
- **Condicionamento e fadiga.** Usa a carga de treino (TRIMP, calculado pela FC média):
  - **Condicionamento (42 dias)**: sua carga de longo prazo.
  - **Fadiga (7 dias)**: a carga da última semana.
  - **Forma** = condicionamento − fadiga. Acima de 5 é **descansado**, abaixo de −10 é **cansado**, no meio é **equilibrado**.
  - Precisa de corridas com frequência cardíaca. A FC máxima e de repouso vêm de **Ajustes → Zonas de treino** ([settings/zones.md](settings/zones.md)).
- **Recordes pessoais** (sempre de **Todo o período**): **1 km mais rápido**, **5 km mais rápido**, **10 km mais rápido**, **Meia maratona mais rápida** (o melhor trecho dentro de qualquer corrida), **Corrida mais longa**, **Maior subida** e **Melhor pace médio (5 km+)**. Na primeira vez aparece **Calculando…** enquanto o app lê os trajetos. Clique no valor para abrir a corrida.
- **Consistência.** Um calendário com um quadradinho por dia. Quanto mais escuro, mais km: sem corrida, menos de 5, menos de 10, menos de 15, 15 km ou mais. Mostra pelo menos 12 semanas e no máximo 53. Passe o mouse num dia para ver a distância.
- **Tabela.** Colunas **Data**, **Nome**, **Tipo**, **Distância**, **Tempo**, **Pace**, **FC média**, **Subida**, **Cadência** e **Carga**. A busca ignora maiúsculas e acentos.
- **Os filtros valem dentro do período escolhido.** Para filtrar em todas as corridas, escolha **Tudo**.
- **Dados que faltam.** Uma corrida sem FC (ou sem horário, ou sem elevação) só some da lista quando o filtro daquele dado está ligado.
- **Mín. e Máx. invertidos** funcionam do mesmo jeito (útil no pace, em que “menor” é mais rápido).
- **Endereço compartilhável.** O período e os filtros ficam no endereço da página. Salve como favorito para voltar à mesma visão. O link só mostra corridas que estão no navegador de quem abre.
- **Comparar.** Com uma corrida marcada aparece **Selecione mais uma corrida para comparar.**; com mais de duas, **Selecione exatamente 2 corridas para comparar.** **Limpar seleção** desmarca tudo.
- **Excluir.** O ícone de lixeira de cada linha pede confirmação (**Excluir corrida**) e não pode ser desfeito.

## Dicas

- Use **Este ano** com **Longões ≥ 15 km** para ver quantos longões você fez no ano.
- **Fora do plano** mostra as corridas que não estavam no seu plano de treino.
- Para comparar duas provas, filtre por **Provas**, marque as duas e clique em **Comparar**.

## Perguntas comuns

**Por que “Condicionamento e fadiga” está vazio?**
Nenhuma corrida tem frequência cardíaca.

**Por que o número de “Corridas” inclui caminhadas?**
O Histórico soma todas as atividades importadas. Use **Tipo de atividade** para ver só corridas.

**Filtrei por data e não apareceu nada.**
O filtro de data só procura dentro do **Período**. Escolha **Tudo** antes.

**Os recordes mudam com o período?**
Não. Eles sempre consideram todas as corridas.

## Veja também

- [Comparar](compare.md) · [Análise](analysis.md) · [Treinos](training.md) · [Metas](insights.md)
- [Métricas e cálculos (técnico)](../architecture/analysis-and-metrics.md)
- [Modelo de dados (técnico)](../architecture/data-model.md)
- [Glossário](../reference/glossary.md)
