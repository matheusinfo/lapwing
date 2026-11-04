<!-- docs-tree: docs/features/settings/zones.md | parent: docs/features/settings/README.md -->
# Zonas de treino — frequência cardíaca e pace

> **Árvore:** [docs](../../README.md) › [features](../README.md) › [settings](README.md) › zones
> **Resumo:** Defina suas 5 zonas de frequência cardíaca e de pace, à mão ou calculadas pelas suas corridas.
> **Tela:** `#/settings` (cartão **Zonas de treino**; o link **Editar zonas em Ajustes** do relatório abre `#/settings?section=zones`) · **Código:** `src/screens/settings/zones-section.ts`, `src/screens/settings/zones-estimate.ts`, `src/data/zones.ts`

## Para que serve

As zonas dizem o quanto cada corrida foi leve ou forte. Elas aparecem:

- no **relatório de cada corrida** ([analysis.md](../analysis.md)): tempo em cada zona de **frequência cardíaca** e de **pace**;
- nos **alertas de carga** em **Metas** ([insights.md](../insights.md)): um treino conta como forte com FC média a partir da **Z4**.

A **FC máxima** e a **FC de repouso** também entram na **carga de treino (TRIMP)** do relatório, do Histórico e de Metas.

## Como usar

### Editar à mão

1. Abra **Ajustes** e vá ao cartão **Zonas de treino** (ou clique em **Editar zonas em Ajustes** no relatório de uma corrida).
2. Na tabela **Zonas**, ajuste a **FC (bpm)** e o **Pace (min/km)** de cada zona. As zonas vizinhas acompanham: mudar o fim da Z2 para 166 muda o início da Z3 para 167; no pace, o fim de uma zona é o início da seguinte.
3. Clique em **Salvar zonas**. Enquanto não salva, aparece **Alterações não salvas.**

Exemplo:

| Zona | FC (bpm) | Pace (min/km) |
|---|---|---|
| Z1 Recuperação | até 158 | acima de 6:50 |
| Z2 Resistência | 159–166 | 6:50–6:15 |
| Z3 Moderado | 167–176 | 6:15–5:45 |
| Z4 Limiar | 177–185 | 5:45–5:15 |
| Z5 Máximo | a partir de 186 | abaixo de 5:15 |

Para usar só zonas de FC, deixe todos os campos de pace em branco.

### Calcular pelas corridas

1. Clique em **Calcular pelas minhas corridas**. O app lê suas corridas (pode levar alguns segundos na primeira vez) e preenche **FC máxima**, **FC de limiar**, **Pace de limiar** e as zonas.
2. Abaixo dos botões aparece de onde veio cada valor, por exemplo: “FC de limiar 187 bpm: melhor média de 30 minutos dos últimos 6 meses, em 5 de set. (Corrida 10K)”.
3. Confira e clique em **Salvar zonas**. Nada é salvo antes disso.

### Gerar a partir dos seus valores

Se você já sabe sua **FC de limiar** ou seu **Pace de limiar** (de um teste ou do relógio), digite e clique em **Gerar zonas destes valores**. Com só um dos dois, só aquele tipo de zona muda.

### Voltar ao padrão

**Voltar ao padrão** (só aparece com zonas próprias) apaga as suas zonas e volta às zonas por % da FC máxima, depois de confirmar.

## Detalhes

- **Padrão** (sem zonas próprias): zonas de FC por % da **FC máxima**: Z2 a partir de 60%, Z3 de 70%, Z4 de 80% e Z5 de 90%. Não há zonas de pace.
- **Referências:**
  - **FC máxima** e **FC de repouso** (bpm): a de repouso precisa ser pelo menos 20 bpm menor que a máxima, as duas entre 30 e 230.
  - **FC de limiar** (bpm) e **Pace de limiar** (m:ss por km): a base para gerar as zonas.
- **Zonas geradas** (zonas de corrida de Joe Friel):
  - FC: Z2 a partir de 85% da FC de limiar, Z3 de 90%, Z4 de 95% e Z5 de 100%.
  - Pace: Z2 a partir de 129% do pace de limiar, Z3 de 114%, Z4 de 106% e Z5 de 100% (arredondado a 5 s). Pace maior é mais lento.
- **Cálculo pelas corridas** (corridas e trail runs):
  - **FC máxima**: a maior média de 10 segundos entre as 5 corridas com FC máxima mais alta dos últimos 12 meses. Um pico isolado do sensor (uma ou duas leituras) não conta, nem leituras acima de 225 bpm. Sem corridas com FC, o valor atual fica.
  - **FC de limiar**: a melhor média de 30 minutos de tempo em movimento entre as 12 corridas mais fortes (pela FC média) dos últimos 6 meses com pelo menos 30 minutos. Se ela fica abaixo de 85% da FC máxima, não houve um esforço forte e o app usa 90% da FC máxima.
  - **Pace de limiar**: o pace T de Jack Daniels pelo melhor **VDOT** dos últimos 6 meses (a mesma conta das previsões de prova em **Metas**). Sem uma corrida de 3 km ou mais com tempo, as zonas de pace ficam como estão.
- **Tempo em cada zona** no relatório:
  - FC: soma o tempo entre cada ponto do arquivo, pela FC daquele ponto (intervalos de mais de 30 s contam como 30 s).
  - Pace: divide a corrida em trechos de 100 m e põe o tempo em movimento de cada trecho na zona do seu pace. Um pace exatamente no limite vai para a zona mais rápida.
- As zonas ficam no registro do atleta (`settings`, id `athlete`) e vão para o backup e para a sincronização entre aparelhos.

## Dicas

- Faça o cálculo depois de uma prova ou de um treino forte de 30 minutos ou mais: é dele que sai a FC de limiar.
- Se o relógio mostra uma FC máxima que você nunca viu numa corrida, prefira a das suas corridas (ou a de um teste).
- Gerou as zonas e quer arredondar? Edite depois na tabela; as vizinhas se ajustam sozinhas.

## Perguntas comuns

**Por que a FC de limiar saiu “90% da FC máxima”?**
Nos últimos 6 meses não houve uma corrida com 30 minutos fortes (média de pelo menos 85% da FC máxima). Digite a sua FC de limiar, se souber, e clique em **Gerar zonas destes valores**.

**Mudei as zonas. As corridas antigas mudam?**
Sim. O tempo em cada zona é calculado na hora, sempre com as zonas atuais.

**As zonas dos treinos estruturados (por exemplo “z2”) usam estas zonas?**
Não. Ao exportar um treino para o relógio, “z2” vai como a zona 2 do próprio relógio.

## Veja também

- [Ajustes](README.md)
- [Análise de corridas](../analysis.md)
- [Metas e alertas](../insights.md)
