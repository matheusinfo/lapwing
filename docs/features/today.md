<!-- docs-tree: docs/features/today.md | parent: docs/features/README.md -->
# Hoje — o resumo do seu dia

> **Árvore:** [docs](../README.md) › [features](README.md) › today
> **Resumo:** A tela inicial do app: o treino de hoje com as etapas e o arquivo para o relógio, como está o seu treino (forma e alertas), suas metas e a última corrida.
> **Tela:** `#/today` (é a tela que abre primeiro) · **Código:** `src/screens/today/`

## Para que serve

A tela **Hoje** responde, num relance, à pergunta “o que eu faço hoje?”. Ela não guarda nada novo: junta o que já existe nas outras telas.

- **Treino de hoje**, do plano escolhido em **Treinos**.
- **Como você está**: a forma (descansado ou cansado) e o alerta de carga mais importante, de **Metas**.
- **Metas**: o andamento de cada meta da semana ou do mês.
- **Última corrida**: os números principais e um lembrete para registrar o esforço.

É a primeira tela quando você abre o Lapwing, e também a que aparece ao clicar no logotipo do menu.

## Como usar

1. Abra o app (ou clique em **Hoje** no menu).
2. Leia o **Treino de hoje**:
   - o tipo (por exemplo **Intervalado**), o título, a situação (**A fazer**, **✓ Feito**, **Parcial**…) e as metas de distância, tempo e pace;
   - num treino estruturado, o desenho das etapas e a lista delas, com os blocos de repetição (por exemplo **6×** 800 m @ 4:05–4:15 /km);
   - a descrição do treino.
3. Vai correr com relógio Garmin? Clique em **FIT (relógio)** para baixar o treino ([como copiar para o relógio](training.md#colocar-um-treino-fit-no-relógio-garmin)).
4. Depois de importar a corrida em **Análise**, o treino passa para **✓ Feito** e o botão vira um link para a corrida.
5. Embaixo, veja **Corrido na semana** (km corridos de segunda até hoje / km planejados na semana), **Treinos na semana** (feitos / total) e os **Próximos treinos**. **Abrir em Treinos** leva para a semana atual.
6. À direita (ou abaixo, no celular), confira **Como você está**, **Metas** e **Última corrida**. Cada cartão tem um link para a tela completa.

## Detalhes

### Treino de hoje

- **Qual plano.** O mesmo que está escolhido em **Treinos** (o último que você selecionou lá). Sem escolha, vale o primeiro plano.
- **Sem plano**, aparece um convite com o botão **Ir para Treinos**.
- **Nada no dia**: aparece **Nada planejado para hoje.** Num dia de **Descanso**, aparece **Dia de descanso**.
- **Situação e corrida ligada** seguem as mesmas regras de **Treinos**: a corrida do dia é ligada sozinha ao treino, ou à mão, arrastando na semana ([training.md](training.md)).
- **FIT (relógio)** só aparece em treinos de corrida que ainda estão **A fazer** (sem corrida ligada e sem marcação à mão de feito ou pulado).
- **Contagem da prova**: com data de prova no plano, o topo mostra **Faltam *N* dias para a prova** até o dia da prova.
- **Próximos treinos**: os 3 seguintes depois de hoje, sem dias de descanso e sem os que você já marcou à mão (feito ou pulado).
- **Corrido na semana** soma todas as corridas de rua e trail da semana (de segunda a domingo), mais os treinos marcados como feitos à mão sem corrida, como no cartão da semana em **Treinos**.

### Como você está

- **Forma** = condicionamento − fadiga, a mesma conta do **Histórico** ([history.md](history.md)): acima de 5 é **Descansado**, abaixo de −10 é **Cansado**, no meio é **Equilibrado**. Só aparece se houver corridas com frequência cardíaca nos últimos 42 dias.
- **Alerta**: o mais grave dos alertas de carga de **Metas** ([insights.md](insights.md#alertas-de-carga-de-treino)), com a dica do que fazer. Se houver mais, aparece **+*N* alertas**. Sem nenhum, **Tudo certo**.
- **Últimos 7 dias**, **Média semanal** (das últimas 4 semanas) e **Dias seguidos** de treino.

### Metas

Cada meta mostra o valor, a meta, a porcentagem, uma barra e quanto falta. As regras de **No ritmo**, **Atrasada** e **Concluída** são as de [insights.md](insights.md#metas). Sem metas, o botão **Criar meta** leva para **Metas**.

### Última corrida

- A corrida de rua ou trail mais recente (caminhadas não entram).
- Quando: **hoje**, **ontem**, **há *N* dias** ou a data, depois de uma semana.
- Se a corrida valeu para um treino do plano, aparece **Treino: *nome***.
- **Carga** (TRIMP) com as mesmas faixas do relatório: **Leve**, **Moderado**, **Forte**, **Muito forte**.
- Sem **PSE** registrada, o link **Como foi? Registre o esforço (PSE)** abre o relatório. A PSE ajuda os alertas a saberem quais treinos foram fortes.

### Primeira vez

Sem nenhuma corrida, plano ou meta, a tela mostra **Boas-vindas ao Lapwing** com três atalhos: **Importar corridas**, **Criar um plano de treino** e **Desenhar uma rota**.

### Tela aberta o dia todo

Se a tela fica aberta (por exemplo, num tablet ou num display na parede), ela passa sozinha para o dia seguinte depois da meia-noite. Ela também se atualiza quando você importa uma corrida ou muda um plano, uma meta ou um ajuste, inclusive em outra aba.

## Dicas

- Deixe a tela **Hoje** como favorito do navegador ou ícone na tela inicial do celular: é o atalho para o dia de treino.
- Registre a PSE logo depois de importar a corrida. Leva 2 segundos e deixa os alertas mais certos.

## Perguntas comuns

**O treino de hoje é de outro plano.**
A tela usa o plano escolhido em **Treinos**. Troque o plano no seletor **Plano** de lá.

**Corri, mas o treino continua “A fazer”.**
Importe a corrida em **Análise**. Se ela não for ligada sozinha (por exemplo, porque você correu em outro dia), arraste a corrida até o treino em **Treinos**.

**Por que não aparece a forma?**
Ela precisa de corridas com frequência cardíaca nos últimos 42 dias.

## Veja também

- [Treinos](training.md) · [Metas](insights.md) · [Histórico](history.md) · [Análise](analysis.md)
- [Métricas, previsões e alertas (técnico)](../architecture/analysis-and-metrics.md)
- [Visão geral da arquitetura](../architecture/overview.md)
