<!-- docs-tree: docs/features/insights.md | parent: docs/features/README.md -->
# Metas — metas, previsões de prova e alertas de carga

> **Árvore:** [docs](../README.md) › [features](README.md) › insights
> **Resumo:** Crie metas semanais ou mensais, veja quanto tempo você faria em cada prova e receba avisos quando o treino está pesado demais (ou leve demais).
> **Tela:** `#/insights` · **Código:** `src/screens/insights/`

## Para que serve

A tela **Metas** (título **Metas e alertas**) reúne três cartões:

1. **Metas**: objetivos de distância, tempo ou número de corridas, por semana ou por mês.
2. **Previsões de prova**: quanto você faria hoje em 5K, 10K, meia maratona e maratona, a partir das suas melhores corridas.
3. **Alertas de carga de treino**: sinais de que você aumentou o treino rápido demais, descansou pouco ou fez treinos fortes demais.

Tudo é calculado com as corridas que você importou.

## Como usar

### Criar uma meta

1. Clique em **Nova meta**.
2. Escolha o **Período**: **Semanal** ou **Mensal**.
3. Escolha a **Medida**: **Distância**, **Tempo em movimento** ou **Número de corridas**.
4. Digite a **Meta**: em km (ex.: `30` ou `42,5`), em h:mm (ex.: `4:30` = 4 horas e 30 minutos) ou em corridas (ex.: `4`).
5. Em **Atividades que contam**, marque os tipos: **Corrida**, **Trail**, **Caminhada**, **Outra**. Por padrão, só **Corrida** e **Trail**.
6. Clique em **Salvar**.

Para mudar ou apagar, clique em **Editar meta**. A janela tem o botão **Excluir** (pede confirmação: **Excluir meta**).

### Ler as previsões

1. Em **Esforços de**, escolha **Últimos 90 dias** (padrão) ou **Todo o período**. A escolha fica salva.
2. A tabela mostra, para cada prova, a **Previsão**, o **Pace**, o **VDOT** e **Com base em** (qual esforço foi usado, com link para a corrida).
3. Abaixo, o quadro **VDOT** mostra o seu índice e os paces de treino sugeridos.

### Ler os alertas

Cada alerta tem um título, uma explicação, os números que o causaram e uma dica do que fazer. Sem nenhum problema, aparece **Tudo certo**. O cartão mostra também os números da semana e um gráfico dos últimos 28 dias.

## Detalhes

### Metas

- **Semanas** vão de segunda a domingo; **meses** são meses do calendário.
- **Situação:**
  - **Concluída**: você já chegou na meta.
  - **No ritmo**: você está pelo menos onde um ritmo constante estaria até ontem, ou, no ritmo atual, vai chegar lá. O primeiro dia do período sempre começa “no ritmo”.
  - **Atrasada**: nenhum dos dois.
- O cartão mostra quanto **faltam**, os dias restantes, quanto precisa **por dia** (≈), a **Projeção** no ritmo atual e quanto passou da meta. Uma marquinha na barra mostra **Onde um ritmo constante estaria hoje**.
- **Sequência**: quantas semanas (ou meses) seguidas a meta foi cumprida. O período atual soma quando é concluído, mas não quebra a sequência enquanto está em andamento.
- **Últimos períodos**: os últimos 8 períodos, cada um marcado como cumprido, não cumprido ou em andamento. Períodos antes da sua primeira corrida não aparecem.

### Previsões de prova

- **Fórmula de Riegel**: tempo previsto = tempo conhecido × (distância nova ÷ distância conhecida) elevado a 1,06. É um jeito clássico de estimar um tempo a partir de outro.
- **De onde vêm os esforços**: os melhores trechos de 1 km, 5 km, 10 km e meia maratona de cada corrida, e cada corrida inteira (assim um longão ajuda a prever a maratona).
- **Só corridas de rua com horários** entram. Trail fica de fora, porque o terreno muda muito o tempo.
- **Como o esforço é escolhido** para cada prova:
  1. esforços de 3 km ou mais têm preferência (os curtos exageram a resistência);
  2. vale o esforço de distância mais próxima da prova;
  3. entre distâncias parecidas, ganha o que dá o tempo mais rápido.
- **Avisos** que podem aparecer:
  - **Nenhuma corrida de 25 km ou mais neste período**: a previsão da maratona provavelmente é otimista.
  - **Só há esforços com menos de 3 km**: previsões longas são estimativas grosseiras.
  - **Extrapolada de um esforço bem mais curto** (mais de 4 vezes menor que a prova): estimativa grosseira.
- **VDOT** é um índice de condicionamento criado pelo treinador Jack Daniels: quanto maior, mais em forma. O app usa o maior VDOT entre os seus esforços de 3 km ou mais e sugere paces de treino: **Leve** (uma faixa), **Maratona**, **Limiar**, **Intervalado** e **Repetição**.
- As previsões supõem esforço de prova, percurso plano e treino específico para a distância.

### Alertas de carga de treino

Palavras usadas:

- **Carga** é o TRIMP: minutos pesados pela frequência cardíaca ([analysis.md](analysis.md)).
- **Agudo:crônico** compara os **últimos 7 dias** com a sua **semana média das últimas 4 semanas**. 1,0 = igual ao normal.
- **Treino forte**: FC média na zona 4 ou acima (o início da Z4 de **Ajustes → Zonas de treino**; no padrão, 80% da FC máxima) **ou** PSE 8 ou mais. Se a corrida não tem FC nem PSE, conta como forte quando o pace é pelo menos 8% mais rápido que o seu pace mediano (precisa de 5 corridas nos últimos 90 dias).
- Caminhadas não contam para estes alertas.

| Alerta | Quando aparece | Nível |
|---|---|---|
| **A distância está subindo rápido** | Agudo:crônico da distância de 1,3 a 1,5 | **Atenção** |
| | Acima de 1,5 | **Risco alto** |
| **A carga de treino está subindo rápido** | O mesmo, usando a carga (TRIMP) | **Atenção** / **Risco alto** |
| **Volume bem abaixo do habitual** | Agudo:crônico da distância abaixo de 0,8 | **Info** |
| **Carga de treino bem abaixo do habitual** | Agudo:crônico da carga abaixo de 0,8, quando não dá para comparar pela distância | **Info** |
| **Salto grande na distância semanal** | Últimos 7 dias mais de 10% acima da média das 3 semanas anteriores | **Atenção** |
| | Mais de 30% acima | **Risco alto** |
| ***N* dias seguidos sem descanso** | 6 dias ou mais treinando sem parar | **Atenção** |
| | 10 dias ou mais | **Risco alto** |
| **Poucos dias de descanso** | No máximo 1 dia de descanso nos últimos 14 (quando não há o alerta de dias seguidos) | **Atenção** |
| **Muitos treinos fortes nesta semana** | 3 ou mais treinos fortes em 7 dias | **Atenção** |
| **Treinos fortes em dias seguidos** | Treinos fortes em dois dias seguidos | **Atenção** |
| **Treino forte demais** | Mais de 40% do tempo dos últimos 7 dias em treinos fortes (com pelo menos 90 min de treino) | **Atenção** |

Regras extras:

- Os alertas de agudo:crônico só aparecem com pelo menos **3 semanas** de histórico e uma média de pelo menos 5 km por semana (ou 50 de carga por semana).
- Os alertas de **carga** só aparecem quando pelo menos 75% dos treinos das últimas 4 semanas têm FC. Sem isso, o gráfico mostra **Distância diária, últimos 28 dias** em vez de **Carga diária, últimos 28 dias**.
- O **salto semanal** é ignorado quando a média anterior é menor que 5 km ou o aumento é menor que 3 km.
- Sem treinos nas últimas 8 semanas, aparece **Nenhum treino nas últimas 8 semanas.**

## Dicas

- Comece com uma meta fácil de cumprir. A sequência motiva mais que um número alto.
- Um alerta de **Volume bem abaixo do habitual** durante o polimento antes de uma prova é normal.
- Registre a **PSE** nas corridas sem FC: ela ajuda o app a saber quais treinos foram fortes.

## Perguntas comuns

**Por que não aparece previsão?**
Não há corridas de rua com horários no período. Tente **Todo o período**.

**A previsão da maratona parece rápida demais.**
Sem longões de 25 km ou mais, ela costuma ser otimista. O app avisa quando é o caso.

**Os alertas são conselho médico?**
Não. São sinais simples, baseados nos seus números. Na dúvida, procure um profissional.

## Veja também

- [Histórico](history.md) · [Análise](analysis.md) · [Treinos](training.md)
- [Métricas, previsões e alertas (técnico)](../architecture/analysis-and-metrics.md)
- [Glossário](../reference/glossary.md)
