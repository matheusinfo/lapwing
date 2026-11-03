<!-- docs-tree: docs/features/training.md | parent: docs/features/README.md -->
# Treinos — planos, treinos estruturados e exportação

> **Árvore:** [docs](../README.md) › [features](README.md) › training
> **Resumo:** Crie ou importe um plano de treino, veja cada semana, deixe o app ligar suas corridas aos treinos e mande os treinos para o calendário ou o relógio.
> **Tela:** `#/training` (semana escolhida: `#/training?week=AAAA-MM-DD`) · **Código:** `src/screens/training/`

## Para que serve

A tela **Treinos** guarda seus **planos de treino**: uma lista de treinos com data, tipo e meta (distância, tempo ou pace). Quando você importa uma corrida, o app procura o treino daquele dia e marca se ele foi feito. Assim você vê, sem esforço, quanto do plano já cumpriu.

## Como usar

### 1. Criar um plano

Há três jeitos (botões no topo da tela):

- **Gerar plano**: o app monta um plano até a sua prova.
  1. Escolha o **Objetivo** (**5K**, **10K**, **Meia maratona** ou **Maratona**), a **Data da prova** e as **Corridas por semana** (3, 4 ou 5).
  2. Se quiser, informe o **Tempo alvo** (por exemplo `55:00`). Ele define os paces alvo. Vazio = treinar por sensação.
  3. Clique em **Pré-visualizar** para ver as semanas, os km e o longão de cada uma.
  4. Clique em **Salvar plano**.
- **Importar**: traga um plano de uma planilha CSV ou de um arquivo JSON. Baixe o **Modelo CSV** ou o **Modelo JSON** para ver o formato. Depois de escolher o arquivo, o app mostra quantos treinos encontrou e quais linhas têm erro; confira **Nome**, **Objetivo** e **Data da prova** e clique em **Importar *N* treinos**.
- **Plano em branco**: dê um **Nome**, um **Objetivo** e, se quiser, a **Data da prova**. Depois adicione os treinos à mão.

Com mais de um plano, troque entre eles no seletor **Plano**. Os ícones ao lado servem para **Editar plano**, **Exportar** e **Excluir plano**.

### 2. Adicionar e editar treinos

1. Clique em **Adicionar treino**, ou no **+** de um dia da semana.
2. Preencha **Data**, **Tipo**, **Título** (opcional), **Distância (km)**, **Duração (h:mm:ss)**, **Pace alvo (min/km)** e **Descrição**.
3. Clique em **Salvar**.

Para editar, clique no treino. Na edição aparecem também **Situação** e **Corrida vinculada**, o botão **Excluir** e, se houver corrida ligada, **Abrir relatório da corrida**.

**Tipos de treino:** **Corrida leve**, **Longão** (corrida longa), **Tempo run** (ritmo forte e controlado), **Intervalado** (tiros), **Regenerativo** (bem leve), **Prova**, **Descanso** e **Fortalecimento / cross** (academia, bike etc.).

### 3. Treinos estruturados

Um treino estruturado é dividido em **etapas**: aquecimento, tiros, recuperação, desaquecimento.

1. No formulário do treino, marque **Treino estruturado**. O app cria um começo: 10 min de aquecimento, a corrida principal e 10 min de desaquecimento.
2. Use **Etapa** para adicionar uma etapa, **Bloco de repetições** para um bloco que se repete (**Repetir** *N* **vezes**) e **Etapa no bloco** para pôr etapas dentro dele.
3. Em cada etapa escolha o **Tipo de etapa** (**Aquecimento**, **Esforço**, **Recuperação**, **Desaquecimento**, **Pausa**), o **Tipo de duração** (**km**, **m**, **Tempo** ou **Até o lap**, que dura até você apertar o botão de volta do relógio) e o **Alvo** (**Sem alvo**, **Pace**, **Zona de FC** ou **FC (bpm)**). Há também um campo de **Nota**.
4. Reordene com **Mover para cima** / **Mover para baixo** e apague com **Remover**.

Ou escolha um modelo em **Usar um modelo…**: **Intervalado 8 × 400 m**, **Intervalado 6 × 800 m**, **Intervalado 5 × 1000 m**, **Fartlek 8 × 1 min**, **Tempo 3 × 10 min**, **Progressivo** e **Longão com final forte**. Se já houver etapas, o app pergunta antes de substituir (**Substituir etapas**).

A distância e a duração do treino são estimadas a partir das etapas (aparece **Estimativa …**). Na semana, o treino mostra um pequeno desenho de barras com a intensidade de cada etapa.

### 4. Acompanhar a semana

- **Cartão do plano**: barra de progresso, os números **Plano concluído**, **Consistência** (treinos feitos entre os que já passaram) e **Sequência** (treinos feitos seguidos) e dois quadros com barra colorida e cada número por extenso (passe o mouse sobre um item para ver a explicação). Com data de prova, mostra quantos dias faltam.
  - **Treinos** (“*X* de *Y* encerrados”, ou seja, os que já não estão pendentes: feitos, parciais, perdidos e pulados; chega a *Y* de *Y* no fim do plano): **Feitos**, **Parciais**, **Perdidos** (a data passou sem corrida), **Pulados** (só aparece se houver) e **Pendentes** (hoje ou depois, ainda não feitos).
  - **Distância** (“*X* de *Y* km”): **Feita**, **Pendente** (distância planejada dos treinos que faltam) e **Perdida** (a dos treinos perdidos e pulados, mais o que faltou nos parciais). **Ainda possível** = feita + pendente, ou seja, até onde o plano chega se todos os treinos que faltam forem feitos como planejado, também em % do plano.
- **Semana**: os 7 dias, de segunda a domingo, com cada treino e a sua situação. Correu em outro dia? **Arraste** a corrida (uma **Corrida extra** ou a corrida já ligada a um treino) até o treino certo, mesmo que seja de outro dia da semana: ela passa a valer para aquele treino. Soltar no dia, fora de um treino, liga a corrida ao primeiro treino daquele dia ainda sem corrida. Use **1 semana** / **2 semanas** para ver uma ou duas semanas de cada vez (a escolha fica salva neste navegador); com **2 semanas** dá para arrastar uma corrida de uma semana para a outra, como o longão de domingo feito na segunda seguinte. Use as setas **Semana anterior** / **Próxima semana** (que andam uma semana) e **Hoje** para voltar à semana atual. Etiquetas **Esta semana** e **Semana leve** aparecem quando cabem. No topo: **Planejado**, **Corrido** e **Treinos feitos**.
- **Distância semanal: planejado x corrido**: gráfico de barras do plano inteiro. Clique numa semana para ir até ela. **Ver como tabela** mostra os números.
- **Corridas x metas**: as últimas 12 corridas ligadas a treinos, com a meta, o que você fez e **Pace x meta** (**Na meta** quando a diferença é de até 10 s/km).

### 5. Exportar

Clique no ícone **Exportar** do plano, escolha o formato e clique em **Baixar**:

| Formato | Para quê |
|---|---|
| **Calendário (.ics)** | Um evento de dia inteiro por treino, para Google Agenda, Calendário da Apple, Outlook etc. |
| **Treinos Garmin (.tcx)** | Treinos com etapas, repetições e paces alvo, agendados nas datas. Importe no Garmin Connect (versão web). |
| **Planilha (.csv)** | Uma linha por treino; etapas na coluna `steps`. |
| **Lapwing (.json)** | Cópia completa do plano, para importar de novo aqui ou em outro aparelho. |

Opções: **Somente treinos de hoje em diante** (ligada por padrão para .ics e .tcx) e **Incluir dias de descanso** (ligada por padrão para .csv e .json; não existe no .tcx, que só leva treinos de corrida).

Para **um treino só**, abra o treino e use **Exportar treino**: **FIT (relógio)**, **TCX** ou **ICS** (só para tipos de corrida).

### Colocar um treino FIT no relógio Garmin

1. Abra o treino e clique em **FIT (relógio)**. Um arquivo `.fit` é baixado.
2. Ligue o relógio ao computador com o cabo USB.
3. Copie o arquivo para a pasta **GARMIN/NewFiles** do relógio.
4. Desconecte o relógio com segurança. O treino aparece na lista de treinos do relógio (o caminho no menu varia de modelo para modelo).

## Detalhes

- **Ligação automática com corridas.** Para cada dia, o app liga cada treino de corrida à corrida daquele dia com distância mais parecida com a meta. Só entram treinos dos tipos leve, longão, tempo, intervalado, regenerativo e prova, e corridas do tipo corrida ou trail. Descanso, fortalecimento e treinos pulados nunca são ligados.
- **Ligação à mão** (**Corrida vinculada**, ou arrastar a corrida até o treino) sempre vence a automática e pode ser com uma corrida de outro dia: arrastando, qualquer dia visível na tela; em **Corrida vinculada**, até 7 dias antes ou depois do treino. Uma corrida fica ligada a um só treino: arrastá-la para outro treino a tira do anterior. Ligar uma corrida a um treino **Pulado** volta a situação dele para automática. Treinos de descanso não recebem corrida. **Nenhuma (não vincular corrida)** impede a ligação para aquele treino; **Automático** desfaz a ligação à mão.
- **Situações:**
  - **Feito**: há corrida ligada com pelo menos 80% da meta (ou o treino foi marcado à mão).
  - **Parcial**: há corrida ligada, mas com menos de 80% da distância planejada (ou do tempo, quando não há distância).
  - **Não feito**: a data já passou e não houve corrida.
  - **A fazer**: hoje ou no futuro, ainda sem corrida.
  - **Descanso**: treinos do tipo descanso.
  - **Pulado**: você marcou como pulado.
  - Corridas que não combinam com nenhum treino aparecem na semana como **Corrida extra**.
- **Marcar como feito** (em **Situação**) serve para um treino feito sem corrida importada. A **distância planejada** dele conta como corrida na distância **Feita**, em **Corrido** e no gráfico (menos para fortalecimento / cross, que não é corrida).
- **Corrido** da semana soma todas as suas corridas da semana, ligadas ou não, mais os treinos marcados como feitos à mão.
- **Plano concluído** = (feitos + parciais) ÷ todos os treinos, sem contar os de descanso.
- **Gerador de plano:**
  - Duração ideal: 5K 8 semanas, 10K 10, Meia 12, Maratona 16. Se faltar tempo até a prova, o plano é encurtado e o app avisa.
  - A distância cresce aos poucos, com uma **semana leve** (75%) a cada 4 semanas e um **polimento** (semanas mais leves) antes da prova.
  - Na semana da prova, só corridas curtas e leves com acelerações.
  - Dias da semana: com 3 corridas, terça, quinta e domingo; com 4, terça, quarta, sexta e domingo; com 5, terça, quarta, quinta, sábado e domingo. O longão é sempre no domingo.
  - Dias antes de hoje ficam de fora. O gerador não cria treinos de descanso.
  - Depois de salvo, qualquer treino pode ser editado.
- **Importação de CSV:** cabeçalho obrigatório com as colunas `date` e `kind` (aceita nomes em português, como `data` e `tipo`). Opcionais: `title`, `distance_km`, `duration`, `pace`, `description`, `steps` e `status` (`feito` ou `pulado`). Separador vírgula, ponto e vírgula ou tab. Data em `AAAA-MM-DD` ou `DD/MM/AAAA`. Tipos também em português (leve, longão, intervalado, regenerativo, prova, descanso…). Linhas com erro são ignoradas.
- **Formato curto de etapas** (coluna `steps` e arquivos JSON), por exemplo:
  `wu 15min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min`
  - tipo: `wu` (aquecimento), `run` (esforço), `rec` (trote), `cd` (desaquecimento), `rest` (pausa); também em português (`aquecimento`, `tiro`, `trote`, `desaquecimento`, `pausa`). Sem tipo = esforço.
  - duração: `400m`, `1.5km`, `10min`, `90s`, `1:30` ou `lap` (até o lap).
  - alvo depois de `@`: pace `4:00-4:10`, zona `z2` ou `140-150bpm`.
  - repetição: `8x( … )`; nota entre colchetes `[ … ]`.
- **Limites:** repetições de 1 a 99, com um nível de bloco; zona de FC de 1 a 5 ou 30–250 bpm.
- **Estimativas** sem pace alvo usam o pace leve do plano (a mediana dos treinos leves, longões e regenerativos) ou 6:00 min/km.
- **Excluir plano** pede confirmação e apaga também todos os treinos dele. As corridas continuam salvas.

## Dicas

- Gere o plano e depois ajuste os dias que não combinam com a sua rotina.
- Fez um treino na esteira e não tem GPS? Use **Marcar como feito**.
- Duas corridas no mesmo dia? Escolha a certa em **Corrida vinculada**.
- Trocou o treino de dia (por exemplo, fez na segunda o leve de terça)? Arraste a **Corrida extra** até o treino de terça. Se o treino era da semana anterior, mude para **2 semanas** antes de arrastar.
- Antes de trocar de aparelho, exporte o plano em **Lapwing (.json)** ou faça um backup completo.

## Perguntas comuns

**Corri, importei, mas o treino continua “A fazer”.**
A ligação automática só junta corrida e treino do mesmo dia (no horário local), e a corrida precisa ser do tipo corrida ou trail. Se correu em outro dia, arraste a corrida até o treino ou escolha-a em **Corrida vinculada**.

**Por que ficou “Parcial”?**
A corrida teve menos de 80% da distância planejada.

**Consigo mandar o plano inteiro para o relógio?**
Em .tcx, pelo Garmin Connect (web). O arquivo FIT é feito um treino por vez.

## Veja também

- [Análise — importar corridas](analysis.md) · [Histórico](history.md) · [Metas](insights.md)
- [Formatos de arquivo: CSV/JSON de plano, ICS, TCX e FIT](../reference/file-formats.md)
- [Modelo de dados (técnico)](../architecture/data-model.md)
- [Glossário](../reference/glossary.md)
