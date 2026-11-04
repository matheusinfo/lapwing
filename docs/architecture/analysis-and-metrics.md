<!-- docs-tree: docs/architecture/analysis-and-metrics.md | parent: docs/architecture/README.md -->
# Análise e métricas

> **Árvore:** [docs](../README.md) › [architecture](README.md) › analysis-and-metrics
> **Resumo:** Fórmulas e limiares de resumo, tempo em movimento, melhores esforços, zonas de FC, TRIMP, fitness/fadiga, previsões (Riegel/VDOT), alertas de sobrecarga e casamento de treinos.
> **Código:** `src/data/analysis.ts`, `src/data/metrics.ts`, `src/geo.ts`, `src/data/parse-fit.ts` (`dropAltitudePlaceholders`), `src/data/import.ts` (`findDuplicate`), `src/screens/activity/calc.ts`, `src/screens/history/aggregate.ts`, `src/screens/history/efforts.ts`, `src/screens/insights/{predictions,overload,goals}.ts`, `src/screens/training/matching.ts`

Todos esses módulos são funções puras (sem DOM nem banco), exceto `history/efforts.ts` (lê trilhas).

## Resumo de atividade (`computeSummary`)

| Métrica | Cálculo |
|---|---|
| Distância | Soma de `haversine` entre pontos consecutivos (raio 6 371 008,8 m) |
| `elapsedTime` | Último − primeiro timestamp (precisa de ≥ 2 timestamps) |
| `movingTime` | Ver abaixo; cai para `elapsedTime` se der 0 |
| `avgPace` | `movingTime / (distance / 1000)` |
| `bestPace` | `bestEffort(dist, moving, 1000)` |
| Ganho/perda | `elevationGainLoss` com limiar de 2 m (variações menores são ruído). Arquivos FIT passam antes por `dropAltitudePlaceholders` (abaixo) |
| FC, cadência, temperatura, potência | Média ponderada pelo tempo; cada intervalo limitado a 30 s; sem tempo, média simples |
| `bounds` | Min/max de lon/lat |

### Altitude de preenchimento em FIT

Alguns relógios gravam exatamente −1,0 m nos registros entre os registros completos, em vez do valor inválido do FIT. Lidos como reais, cada salto −1 m → altitude real soma centenas de metros ao ganho. `dropAltitudePlaceholders` (`src/data/parse-fit.ts`, chamado no fim de `parseActivityFit`) apaga `ele` desses pontos quando o −1 aparece em ≥ 10 % dos pontos e a mediana das outras altitudes está a mais de 30 m de −1; os pontos ficam sem altitude e são tratados como qualquer lacuna (`elevationGainLoss` os pula; `buildStreams` repete o valor anterior no gráfico). Detalhes em [file-formats.md](../reference/file-formats.md#atividades-fit-parseactivityfit-srcdataparse-fitts).

### Tempo em movimento

`MOVING_SPEED = 0.5` m/s (~1,8 km/h). Um intervalo entre dois pontos conta se `distância / dt ≥ 0.5`. `cumulativeMovingTime` devolve o acumulado por ponto (todo zero sem timestamps).

### Melhor esforço (`bestEffort`)

Janela deslizante sobre a distância cumulativa: para cada início `i`, avança `j` até cobrir `meters`; o tempo em movimento do trecho é escalado para exatamente `meters`. Retorna `undefined` se a corrida é mais curta ou não tem tempo.

| Onde | Distâncias |
|---|---|
| Relatório (`activity/calc.ts`, `EFFORT_DISTANCES`) | 400 m, 1 km, 1 milha (1609,344 m), 5 km, 10 km, meia (21 097,5 m) |
| Histórico/insights (`history/aggregate.ts`, `EFFORT_DISTANCES`) | 1 km, 5 km, 10 km, meia |

`history/efforts.ts` calcula os esforços de cada atividade uma trilha por vez (`requestIdleCallback` ou `setTimeout`), cancelável por `AbortSignal`, com cache em memória por id durante a sessão.

## Relatório de corrida (`screens/activity/calc.ts`)

| Função | Regra |
|---|---|
| `buildStreams` | `dist`, `moving`, altitude com lacunas preenchidas pelo valor anterior |
| `kmSplits` | Um split por km; o último é parcial (`< 999.5 m`) e descartado se `< 10 m` |
| `chartStep(total)` | Passo de amostragem dos gráficos: `max(20, ceil(total/500/10)*10)` m |
| `detectFastBlocks` | Pace suavizado (janela 100 m, amostra a cada 25 m), percentis 2–98 %, divisão em dois grupos por Otsu (`twoGroups`); exige grupo rápido ≥ 10 % mais rápido; une blocos separados por ≤ 75 m e descarta < 200 m. Requer tempo, ≥ 1 km e ≥ 20 amostras |
| `aerobicDecoupling` | Pa:HR em %: queda da eficiência (velocidade ÷ FC) da 1ª para a 2ª metade do tempo em movimento; exige ≥ 20 min |

## Zonas de frequência cardíaca e de pace (`data/zones.ts`, `data/metrics.ts`)

As zonas são guardadas como o valor onde começam as zonas 2–5 (`ZoneStarts`).

- `hrStarts(s)`: `hrZoneStarts` (bpm, crescente) quando válido; senão `round(hrZoneBounds[i] × maxHr)`.
- `paceStarts(s)`: `paceZoneStarts` (s/km, decrescente) quando válido; senão `undefined` (sem zonas de pace).
- `zoneOfHr(hr, starts)`: índice 0–4 = quantos inícios são ≤ `round(hr)`. `hrZone(hr, s)` usa `hrStarts(s)`.
- `zoneOfPace(pace, starts)`: índice 0–4 = quantos inícios são ≥ `pace` (um pace no limite vai para a zona mais rápida).
- `hrZoneRanges(s)`: limites inclusivos em bpm, `[[0, b0−1], [b0, b1−1], [b1, b2−1], [b2, b3−1], [b3, max(maxHr, b3)]]`.
- `hrZoneSeconds(points, s)`: segundos por zona de FC; intervalos limitados a 30 s.
- `paceZoneSeconds(dist, moving, starts, chunk = 100)`: tempo em movimento de cada trecho de 100 m na zona do seu pace; trechos com menos de 50 m (o fim da corrida) ficam de fora.
- Zonas geradas (Friel): `hrZonesFromLthr(L)` = `round([0,85; 0,90; 0,95; 1,00] × L)`; `paceZonesFromThreshold(T)` = `[1,29; 1,14; 1,06; 1,00] × T`, arredondado a 5 s.

Com o padrão (`maxHr` 190, limites 0,6/0,7/0,8/0,9): Z1 ≤ 113, Z2 114–132, Z3 133–151, Z4 152–170, Z5 ≥ 171 bpm.

### Estimativa pelas corridas (`screens/settings/zones-estimate.ts`)

Só corridas e trail runs.

- **FC máxima:** lê os pontos das 5 corridas com maior `summary.maxHr` dos últimos 365 dias e pega a maior média de 10 s de tempo em movimento (`bestWindowHr`), ignorando leituras acima de 225 bpm.
- **FC de limiar:** maior média de 30 min (`bestWindowHr`, 1800 s) entre as 12 corridas de maior FC média dos últimos 180 dias com ≥ 30 min em movimento. Abaixo de 85 % da FC máxima estimada, usa 90 % da FC máxima.
- **Pace de limiar:** `trainingPaces(bestVdot(efforts)).threshold` com os esforços (`loadEfforts`/`collectEfforts`) das corridas dos últimos 180 dias (`predictionRuns`).

## TRIMP (carga de treino)

Banister com coeficientes masculinos:

```
r = clamp((hr − restingHr) / (maxHr − restingHr), 0, 1)
peso(hr) = r × 0.64 × e^(1.92 × r)
trimp = Σ minutos × peso(hr)      (cada intervalo limitado a 30 s)
```

| Função | Fonte | Uso |
|---|---|---|
| `trimp(points, s)` | Fluxo de FC completo | Relatório da corrida |
| `trimpFromSummary(summary, s)` | `avgHr` × `movingTime` | Listas, histórico, sobrecarga (um pouco menor em treinos irregulares) |

Faixas no relatório: < 50 fácil, < 100 moderado, < 200 difícil, ≥ 200 muito difícil.

## Fitness, fadiga e forma (`history/aggregate.ts`)

- Carga diária = soma de `trimpFromSummary` das atividades do dia (local).
- Médias exponenciais da primeira atividade até hoje, usando todas as atividades:
  - `fitness` (crônica): `FITNESS_DAYS = 42`, `k = 1 − e^(−1/42)`;
  - `fatigue` (aguda): `FATIGUE_DAYS = 7`, `k = 1 − e^(−1/7)`;
  - `form = fitness − fatigue` (positivo = descansado).
- Calendário: `heatLevel` 0 (sem corrida), 1 (< 5 km), 2 (< 10 km), 3 (< 15 km), 4 (≥ 15 km). Semanas começam na segunda.

## Previsões de prova (`insights/predictions.ts`)

**Fontes (`collectEfforts`):** melhores esforços (1K/5K/10K/meia) e cada corrida inteira ≥ 1 km de `predictionRuns` (apenas tipo `run`, com tempo; janela padrão `DEFAULT_WINDOW_DAYS = 90`, ou tudo).

**Riegel:** `T2 = T1 × (D2 / D1)^1.06` (`RIEGEL_EXPONENT`).

**Escolha da fonte (`chooseSource`) para cada distância-alvo D (5K, 10K, meia, maratona):**

1. Se houver esforços ≥ 3 km (`MIN_RELIABLE_DISTANCE`), só eles são usados.
2. Proximidade `|ln(D/d)|`; mantêm-se candidatos até `ln 1.5` além do mais próximo.
3. Entre eles vence a previsão mais rápida.

**Ressalvas (`PredictionCaveat`):**

| Caveat | Quando |
|---|---|
| `noLongRun` | Maratona sem corrida ≥ 25 km (`LONG_RUN_FOR_MARATHON`) |
| `shortOnly` | Todos os esforços < 3 km |
| `farExtrapolation` | `D / d > 4` (`MAX_RELIABLE_RATIO`) |

**VDOT (Daniels & Gilbert):**

```
vo2(v)         = −4.6 + 0.182258·v + 0.000104·v²          (v em m/min)
sustentável(t) = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)   (t em min)
VDOT           = vo2(v) / sustentável(t)
```

`bestVdot` usa o maior VDOT entre esforços ≥ 3 km. `trainingPaces`: E = 62–70 % do VDOT, M = pace da maratona prevista pelo VDOT (bisseção, `vdotRaceTime`), T = 88 %, I = 97,5 %, R = 107 %.

## Alertas de sobrecarga (`insights/overload.ts`)

Dias locais; "últimos 7 dias" = hoje + 6 anteriores. Caminhadas não contam (`TRAINING_TYPES = ['run', 'trail-run', 'other']`).

| Regra | Cálculo | Severidade |
|---|---|---|
| ACWR distância (`acwrDistance`) | 7 dias ÷ (28 dias ÷ 4) | > 1,5 `high`; ≥ 1,3 `caution`; < 0,8 `detrainingDistance` (`info`) |
| ACWR carga (`acwrLoad`) | Mesmo, com TRIMP; só se ≥ 75 % das sessões de 28 dias têm FC | Idem; `detrainingLoad` só se não houver ACWR de distância |
| Pré-requisitos do ACWR | ≥ 21 dias de histórico; média crônica ≥ 5 km/sem ou ≥ 50 TRIMP/sem | — |
| Salto semanal (`weeklyJump`) | 7 dias vs. média das semanas dos dias 8–28 | > 30 % `high`; > 10 % `caution`; ignorado se base < 5 km ou aumento < 3 km |
| Sequência (`streak`) | Dias seguidos terminando hoje (ou ontem) | ≥ 6 `caution`; ≥ 10 `high` |
| Poucos descansos (`fewRestDays`) | Sem `streak`, ≥ 14 dias de histórico e ≤ 1 dia de descanso em 14 | `caution` |
| Sessões duras (`hardSessions`) | ≥ 3 nos últimos 7 dias | `caution` |
| Duras seguidas (`backToBackHard`) | Sessões duras em dois dias consecutivos | `caution` |
| Fração dura (`hardShare`) | > 40 % do tempo em movimento, com ≥ 90 min no total | `caution` |

Sessão "dura" (`hardReason`): FC média ≥ início da zona 4 (`hrStarts(settings)[2]`), **ou** RPE ≥ 8, **ou** (sem FC nem RPE, ≥ 1 km) pace médio ≤ 92 % da mediana dos últimos 90 dias (corridas ≥ 3 km; precisa de ≥ 5). Os alertas saem ordenados por severidade.

## Metas (`insights/goals.ts`)

- Período: semana (segunda) ou mês civil, local.
- `achieved` quando valor ≥ alvo; `on-track` quando valor ≥ fração proporcional até o fim de ontem **ou** a projeção no ritmo atual alcança o alvo; senão `behind`.

## Tênis

`src/data/shoes.ts` mantém `shoeStats`/`wearStatus` (desgaste = distância ÷ `retireDistance`), mas a UI de tênis está desativada; a importação ainda chama `defaultShoeId()`, que não retorna nada sem tênis cadastrados.

## Casamento de treinos (`training/matching.ts`)

1. Vínculos manuais (`linkedActivityId`) vencem.
2. Por dia local, cada treino de corrida (`easy`, `long`, `tempo`, `intervals`, `recovery`, `race`) pega a corrida (`run`/`trail-run`) não usada de distância mais próxima do alvo (guloso sobre todos os pares do dia).
3. Nunca casam automaticamente: `rest`, `cross`, `skipped`, `unlinked`.

Distância-alvo (`plannedDistance`): `distance`, senão estimativa dos `steps`, senão `duration / pace`. Status: `partial` se a corrida cobre < 80 % (`PARTIAL_THRESHOLD`) da distância (ou do tempo, sem distância); passado sem corrida = `missed`.

## Duplicatas na importação

| Origem | Critério |
|---|---|
| Arquivos e `.zip` do Strava (`findDuplicate`, `data/import.ts`) | Mesmo `stravaId`, ou início a ≤ 60 s (ambos com `hasStartTime`) e diferença de distância < 50 m |
| Strava (`isDuplicate`) | Mesmo `stravaId`, ou início a ≤ 60 s e distância dentro da tolerância (antes de baixar streams: `max(50, 2 %)`; depois: 50 m) |

## Veja também

- [Modelo de dados](data-model.md)
- [Glossário](../reference/glossary.md)
- [Guia: análise](../features/analysis.md)
- [Guia: insights](../features/insights.md)
- [Guia: histórico](../features/history.md)
