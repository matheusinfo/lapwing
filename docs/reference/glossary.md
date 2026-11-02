<!-- docs-tree: docs/reference/glossary.md | parent: docs/reference/README.md -->
# Glossário

> **Árvore:** [docs](../README.md) › [reference](README.md) › glossary
> **Resumo:** Termos de corrida e de código usados no Lapwing, com o termo em pt-BR, o equivalente em inglês (como aparece no código) e a definição.
> **Código:** `src/data/types.ts`, `src/data/import.ts`, `src/data/analysis.ts`, `src/data/metrics.ts`, `src/screens/insights/`, `src/screens/training/types.ts`, `src/screens/routes/route/`

## Corrida e treino

| pt-BR | Inglês / código | Definição |
|---|---|---|
| Ritmo, pace | pace (`avgPace`, `pace`) | Tempo por quilômetro, em s/km internamente; exibido como `m:ss /km` |
| Distância | distance | Metros internamente; soma de `haversine` entre pontos |
| Tempo total | elapsed time (`elapsedTime`) | Do primeiro ao último timestamp, incluindo paradas |
| Tempo em movimento | moving time (`movingTime`) | Tempo com velocidade ≥ 0,5 m/s (`MOVING_SPEED`); base do pace médio |
| Ganho / perda de altitude | elevation gain / loss | Subidas e descidas somadas, ignorando variações < 2 m |
| Parcial, split | split (`kmSplits`) | Trecho de 1 km do relatório; o último pode ser parcial |
| Melhor esforço | best effort (`bestEffort`) | Menor tempo para cobrir uma distância (400 m, 1 km, milha, 5K, 10K, meia) em qualquer trecho da corrida |
| Melhor pace | best pace (`bestPace`) | Melhor esforço de 1 km, em s/km |
| Bloco rápido | fast block (`detectFastBlocks`) | Trecho claramente mais rápido que o resto (tiros, miolo de tempo run) |
| Desacoplamento aeróbico | aerobic decoupling (Pa:HR) | Queda da eficiência (velocidade ÷ FC) da 1ª para a 2ª metade, em % |
| Frequência cardíaca (FC) | heart rate (`hr`) | Batimentos por minuto |
| FC máxima / de repouso | max HR / resting HR (`maxHr`, `restingHr`) | Perfil do atleta; padrão 190 / 60 bpm |
| Zona de FC | HR zone (`hrZone`) | Faixas 1–5 definidas por frações da FC máxima (`hrZoneBounds`, padrão 60/70/80/90 %) |
| Cadência | cadence (`cad`) | Passos por minuto (dois pés); arquivos trazem passadas por minuto e o parser dobra |
| Potência | power | Watts |
| TRIMP | TRIMP (Training Impulse) | Carga de treino de Banister: minutos ponderados pela intensidade da FC |
| Carga de treino | training load (`load`) | Soma de TRIMP num dia/período |
| Condicionamento | fitness | Média exponencial de 42 dias da carga (crônica) |
| Fadiga | fatigue | Média exponencial de 7 dias da carga (aguda) |
| Forma | form | `fitness − fatigue`; positivo = descansado |
| ACWR | acute:chronic workload ratio | Últimos 7 dias ÷ média semanal dos últimos 28 dias; > 1,5 indica risco alto |
| Regra dos 10 % | 10 % rule (`weeklyJump`) | Alerta quando o volume semanal sobe mais de 10 % sobre as 3 semanas anteriores |
| Destreino | detraining | ACWR < 0,8: volume bem abaixo do habitual |
| Sessão dura | hard session (`hardReason`) | FC média ≥ zona 4, RPE ≥ 8, ou pace ≥ 8 % mais rápido que a mediana |
| Sequência | streak | Dias seguidos com treino, terminando hoje ou ontem |
| RPE | RPE (rate of perceived exertion) | Esforço percebido de 1 (muito fácil) a 10 (máximo), informado pelo usuário |
| Fórmula de Riegel | Riegel formula | `T2 = T1 × (D2/D1)^1.06`; prevê tempo em outra distância |
| VDOT | VDOT | Índice de Jack Daniels derivado de um desempenho; gera previsões e paces de treino (E, M, T, I, R) |
| Previsão de prova | race prediction | Tempo estimado para 5K, 10K, meia e maratona |
| Meia maratona | half marathon (`half`) | 21 097,5 m |
| Maratona | marathon | 42 195 m |
| Corrida leve | easy run (`easy`) | Tipo de treino |
| Longão | long run (`long`) | Tipo de treino |
| Tempo run, limiar | tempo (`tempo`) | Tipo de treino |
| Intervalado, tiros | intervals (`intervals`) | Tipo de treino |
| Regenerativo | recovery (`recovery`) | Tipo de treino |
| Prova | race (`race`) | Tipo de treino |
| Descanso | rest (`rest`) | Tipo de treino; nunca casa com corrida |
| Treino cruzado, fortalecimento | cross-training (`cross`) | Tipo de treino; nunca casa com corrida |
| Aquecimento / desaquecimento | warm-up / cool-down (`warmup`, `cooldown`) | Tipos de passo (`StepKind`) |
| Tiro, esforço | active / work (`active`) | Passo principal de um treino estruturado |
| Recuperação, trote | recovery / jog (`recovery`) | Passo entre tiros |
| Volta (botão) | lap (`open`) | Passo sem duração fixa: termina ao apertar a volta no relógio |
| Treino estruturado | structured workout (`steps`) | Treino dividido em passos e repetições (`WorkoutStep[]`) |
| Plano de treino | training plan (`TrainingPlan`) | Conjunto de treinos com objetivo e data de prova |
| Treino planejado | planned workout (`PlannedWorkout`) | Um treino do plano num dia |
| Casamento | matching (`matchWorkouts`) | Associação automática de uma corrida importada ao treino do dia |
| Parcial / perdido | partial / missed | Status: corrida < 80 % do alvo / treino passado sem corrida |
| Meta | goal (`Goal`) | Alvo semanal ou mensal de distância, tempo ou número de corridas |
| Tênis | shoe (`Shoe`) | Calçado com quilometragem e desgaste; UI atualmente desativada |
| Trilha (trail) | trail run (`trail-run`) | Tipo de atividade; excluído das previsões |

## Código e arquitetura

| pt-BR | Inglês / código | Definição |
|---|---|---|
| Tela | screen (`screens/<nome>`) | Módulo carregado sob demanda que exporta `mount` |
| Montar / desmontar | mount / unmount (`ScreenMount`) | `mount(root, params)` preenche a tela e devolve o cleanup |
| Limpeza | cleanup | Função que libera mapas, gráficos, listeners e assinaturas |
| Rota (URL) | route (`RouteDef`) | Caminho no hash (`#/history`) ligado a uma tela |
| Rota (corrida) | route | Percurso desenhado no editor de rotas e exportado em GPX |
| Ponto de passagem | waypoint (`waypoints`) | Ponto clicado pelo usuário no editor de rotas |
| Trecho, segmento | segment (`Segment`) | Caminho entre dois waypoints consecutivos; `kind` `routed`/`straight`/`imported` |
| Roteamento | routing (`RoutingQueue`, BRouter) | Cálculo do caminho a pé entre dois pontos |
| Encaixe | snapping (`snapEnds`) | Mover o waypoint para o início/fim do caminho roteado (até 50 m) |
| Circuito | loop (`isLoop`, `closeLoop`) | Rota cujo último ponto é igual ao primeiro |
| Trilha / track | track (`tracks`, `TrackPoint`) | Sequência de pontos gravados de uma atividade |
| Atividade | activity (`Activity`) | Corrida/caminhada importada (resumo); os pontos ficam em `tracks` |
| Resumo | summary (`ActivitySummary`) | Números principais calculados na importação |
| Store | store (`StoreName`) | "Tabela" do IndexedDB (`activities`, `tracks`, `plans`, `workouts`, `settings`, `shoes`, `goals`) |
| Notificação de dados | data change (`onDataChange`) | Evento por store após escrita, também entre abas (`BroadcastChannel`) |
| Dicionário | dictionary (`defineMessages`) | Textos `en` + `pt-BR` de uma tela |
| Token de cor | design token (`--accent`…) | Custom property CSS que muda com o tema |
| Tema efetivo | resolved theme (`getTheme`) | `light` ou `dark` aplicado em `data-theme` |
| Fixture | fixture | GPX de teste em `tests/fixtures/runs/` |
| GPX | GPS Exchange Format | XML aberto com trajeto (pontos com lat/lon, altitude, horário e extensões de FC, cadência…); lido e gravado pelo app |
| FIT | Flexible and Interoperable Data Transfer (`parse-fit.ts`) | Formato binário da Garmin, usado pela maioria dos relógios; o app lê atividades e grava treinos |
| TCX | Training Center XML (`parse-tcx.ts`) | XML da Garmin com trackpoints (atividades) ou treinos; o app lê atividades e grava treinos |
| Arquivo de exportação do Strava | Strava account export (`strava-archive.ts`) | `.zip` pedido em Configurações → Minha conta → Baixar ou excluir sua conta; traz `activities.csv` e um arquivo por atividade em `activities/` |
| Id de upload | upload id | Nome dos arquivos em `activities/` no `.zip` do Strava; diferente do id da atividade (`stravaId`) |
| Altitude de preenchimento | altitude placeholder (`dropAltitudePlaceholders`) | −1 m gravado por alguns relógios nos registros sem altitude; descartado pelo parser FIT |
| Origem | source (`Activity.source`) | `'strava'` para atividades vindas da API ou do `.zip` do Strava; ausente para arquivos importados |
| Resultado da importação | import result (`ImportResult`, `ImportErrorCode`) | Atividades importadas, falhas com código (`duplicate`, `no-gps`, `manual`, `ignored-type`, `invalid`, `read`, `unsupported`, `save`) e `cancelled` |
| Backup | backup (`BackupFile`) | Arquivo JSON (ou gzip) com todas as stores e chaves `lapwing:*` |
| Segredos | secrets | `clientSecret`, `accessToken`, `refreshToken` do Strava; opcionais no backup |
| Cursor de sincronização | sync cursor (`syncCursor`) | Início da atividade Strava mais nova já tratada (epoch s) |

## Veja também

- [Análise e métricas](../architecture/analysis-and-metrics.md)
- [Modelo de dados](../architecture/data-model.md)
- [Motor do editor de rotas](../architecture/routing-engine.md)
- [Formatos de arquivo](file-formats.md)
- [FAQ](../faq.md)
