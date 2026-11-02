<!-- docs-tree: docs/features/compare.md | parent: docs/features/README.md -->
# Comparar — duas corridas lado a lado

> **Árvore:** [docs](../README.md) › [features](README.md) › compare
> **Resumo:** Coloque duas corridas lado a lado e veja números, gráficos, melhores esforços, percursos e parciais, com as diferenças já calculadas.
> **Tela:** `#/compare`, `#/compare/<a>` ou `#/compare/<a>/<b>` · **Código:** `src/screens/compare/`

## Para que serve

A tela **Comparar corridas** responde perguntas como “fiz o mesmo percurso mais rápido que no mês passado?” ou “em que ponto da prova eu perdi tempo?”. Ela não tem item próprio no menu: fica dentro do **Histórico** (o menu marca **Histórico** enquanto você está nela).

## Como usar

Há três caminhos para chegar:

- No **Histórico**, marque a caixinha de duas corridas e clique em **Comparar**.
- No relatório de uma corrida (**Análise**), clique em **Comparar**. Ela entra como **Corrida A**.
- Abra o endereço `#/compare` e escolha as duas.

Na tela:

1. Escolha a **Corrida A** e a **Corrida B** nos seletores (**Escolha uma corrida…**). Uma corrida não pode estar nos dois lados.
2. Com só a corrida A escolhida, o app sugere **Corridas parecidas:** (até 3). Clique numa para usá-la como B.
3. O botão **Inverter corridas** troca A e B de lugar.
4. Leia as seções (veja Detalhes). Clique no nome de uma corrida para **Abrir relatório**.

## Detalhes

- **Regra das diferenças.** Toda diferença é **B − A** (coluna **B − A**). Verde quer dizer que B foi mais rápida (**B mais rápida**); vermelho, mais lenta (**B mais lenta**). **Igual** quando quase não há diferença.
- **Só o ritmo ganha cor.** Distância, tempo, subida, FC, cadência, potência, carga e PSE mostram a diferença sem dizer se é “melhor” ou “pior”: correr mais longe ou com FC mais alta não é, por si só, bom nem ruim.
- **Resumo:** **Data** (diferença em dias), **Distância**, **Tempo em movimento**, **Tempo total**, **Ritmo médio**, **Melhor 1 km**, **Ganho de elevação**, **Perda de elevação**, **FC média**, **FC máxima**, **Cadência média**, **Potência média**, **Carga de treino (TRIMP)** e **Esforço (PSE)**. “Ritmo” aqui é o mesmo que **pace** (min/km).
- **Ao longo da corrida.** As duas corridas no mesmo gráfico, pela distância (km): **Ritmo**, **Frequência cardíaca** e **Elevação** (quando as duas têm o dado).
- **Diferença de tempo.** Um gráfico mostra, a cada ponto do caminho, quem estava na frente. Acima de zero: B está à frente de A naquela distância (**B à frente por …**). Abaixo de zero: B está atrás (**B atrás por …**). Precisa de horários nas duas corridas.
- **Melhores esforços.** Só as distâncias padrão (400 m, 1 km, 1 milha, 5 km, 10 km, meia maratona) que as **duas** corridas cobrem. Mais rápido é melhor.
- **Percursos.** Um mapa com os dois trajetos, cada um com a sua cor.
- **Parciais por km.** Pace de A, pace de B e a diferença em cada km; FC de cada uma quando houver.
- **Corridas parecidas** são as de distância mais próxima da corrida A, dando preferência ao mesmo tipo (corrida, trail, caminhada).
- **Corrida sem horários** aparece marcada como “sem horários”: pace, tempo e diferença de tempo ficam de fora.
- **Corrida excluída.** Se uma das corridas do endereço não existe mais, aparece **Corrida não encontrada**. Escolha outra nos seletores.
- **Sem corridas.** Com menos de duas corridas no app, a tela convida a **Importar corridas**.
- O endereço guarda as duas corridas escolhidas. Salve como favorito para voltar à mesma comparação.

## Dicas

- Compare o mesmo percurso em épocas diferentes para ver sua evolução real.
- Numa prova, o gráfico **Diferença de tempo** mostra em que trecho você ganhou ou perdeu segundos.
- Para comparar uma prova com a do ano passado, filtre **Provas** no Histórico e marque as duas.

## Perguntas comuns

**Posso comparar mais de duas corridas?**
Não. A comparação é sempre entre duas.

**Por que alguns gráficos não aparecem?**
Uma das corridas não tem aquele dado (por exemplo, FC ou altitude).

**Por que “Melhores esforços” está vazio?**
Nenhuma distância padrão está presente nas duas corridas, ou uma delas não tem horários.

## Veja também

- [Histórico](history.md) · [Análise](analysis.md)
- [Métricas e cálculos (técnico)](../architecture/analysis-and-metrics.md)
- [Glossário](../reference/glossary.md)
