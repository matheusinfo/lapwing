<!-- docs-tree: docs/reference/file-formats.md | parent: docs/reference/README.md -->
# Formatos de arquivo

> **Árvore:** [docs](../README.md) › [reference](README.md) › file-formats
> **Resumo:** Todos os formatos que o Lapwing lê ou grava: GPX, FIT e TCX de atividade (também `.gz`), o `.zip` de exportação da conta do Strava (ZIP/gzip), CSV e JSON de planos, sintaxe curta de treinos estruturados, backup JSON/gzip, ICS, TCX e FIT de treino e a query de filtros do histórico.
> **Código:** `src/gpx/{parse,export}.ts`, `src/data/{parse-activity,parse-fit,parse-tcx,import,strava-archive,zip,gzip}.ts`, `src/screens/activity/export-gpx.ts`, `src/screens/training/{csv,structure,export,fit,types}.ts`, `src/data/backup.ts`, `src/screens/history/filters.ts`

## Visão geral

| Formato | Lê | Grava | Onde |
|---|---|---|---|
| GPX (rota) | sim | sim | Editor de rotas |
| GPX (atividade) | sim | sim | Análise (importar várias, exportar uma) |
| FIT (atividade) | sim | — | Análise (importar) |
| TCX (atividade) | sim | — | Análise (importar) |
| `.gz` de um arquivo de atividade | sim | — | Análise (importar) |
| `.zip` de exportação da conta do Strava (ou ZIP de arquivos de atividade) | sim | — | Análise (importar) |
| CSV de plano | sim | sim | Treinos |
| JSON de plano | sim | sim | Treinos |
| ICS (iCalendar) | — | sim | Treinos (plano ou treino) |
| TCX de treino (Garmin workouts) | — | sim | Treinos (plano ou treino) |
| FIT de treino (workout) | — | sim | Treinos (um treino) |
| Backup JSON / `.json.gz` | sim | sim | Configurações › Backup |

## GPX

### Leitura (comum aos dois parsers)

- `DOMParser` com `application/xml`; erro de parse ou raiz diferente de `gpx` → `GpxError('invalid')`.
- **Independente de namespace**: `getElementsByTagNameNS('*', …)` e comparação por `localName`.
- Usa `trkpt`; se não houver, `rtept`. Vários tracks/segmentos viram uma sequência só, na ordem do arquivo.
- Pontos sem `lat`/`lon` numéricos são ignorados; menos de 2 pontos válidos → `GpxError('empty')`.
- Nome: primeiro `<name>` cujo pai é `metadata`, `trk` ou `rte`.

### Rota (`parseGpx`, `src/gpx/parse.ts`)

Produz `Coord[]` (`[lon, lat, ele?]`) lendo só `<ele>`. Aberto no editor como um segmento `imported`.

### Atividade (`parseActivityGpx`, `src/data/parse-activity.ts`)

| Dado | Tags lidas (por nome local, qualquer prefixo: `gpxtpx:hr`, `ns3:hr`…) | Regra |
|---|---|---|
| Altitude | `ele` | — |
| Tempo | `time` | `Date.parse` → epoch ms |
| FC | `hr`, `heartrate` (dentro de `extensions`) | > 0 |
| Cadência | `cad`, `cadence`, `runcadence` | > 0; valores < 130 são dobrados (passadas → passos/min) |
| Temperatura | `atemp`, `temp`, `temperature` | °C |
| Potência | `power`, `watts` | ≥ 0 |
| Tipo | `<trk><type>` | vazio, `9` ou contém `run` → `run` (com `trail` → `trail-run`); `walk`, `hik…` ou `10` → `walk`; senão `other` |

Erros do parser: `GpxError('invalid')` e `GpxError('empty')`. Na importação eles viram os códigos `invalid` e `no-gps` (ver [Importação de atividades](#importação-de-atividades-srcdataimportts)).

### Escrita

| Função | Conteúdo |
|---|---|
| `toGpx(coords, name)` (`src/gpx/export.ts`) | GPX 1.1, `creator="Lapwing"`, `metadata` com `name` e `time`, um `trk` com `<type>running</type>`, `trkpt` com 7 casas e `ele` com 1 casa |
| `toActivityGpx(points, name)` (`screens/activity/export-gpx.ts`) | GPX 1.1 com `time`, `ele` e `extensions`: `<power>` e `gpxtpx:TrackPointExtension` (`atemp`, `hr`, `cad` em **passadas**/min = `cad / 2`), namespace `http://www.garmin.com/xmlschemas/TrackPointExtension/v1` |
| `fileNameFor(name)` | Slug sem acentos: `"Volta no Parque"` → `volta-no-parque.gpx` (padrão `route.gpx`) |

## Importação de atividades (`src/data/import.ts`)

Ponto de entrada: `importActivityFiles(files, { signal?, onProgress? }): Promise<ImportResult>` (`importGpxFiles` é um alias mantido por compatibilidade).

### Formatos e detecção

| Entrada | Como é reconhecida | Leitor |
|---|---|---|
| `.gpx`, `.fit`, `.tcx` | extensão (`isActivityFileName`) | `parseActivityBytes` |
| `.gpx.gz`, `.fit.gz`, `.tcx.gz` (ou qualquer gzip) | bytes mágicos `1f 8b` (`isGzip`), descomprimido com `gunzip` | `parseActivityBytes` |
| `.zip` | extensão, ou bytes `50 4b 03 04` (`PK\3\4`) | `importStravaArchive` (`strava-archive.ts`, import dinâmico) |
| Outra extensão | lê só os primeiros 64 bytes: ZIP → arquivo; gzip, FIT ou texto começando com `<` → atividade; senão `unsupported` | — |

`parseActivityBytes(bytes, fileName)`: descomprime gzip se for o caso; o formato vem do conteúdo (`sniffFormat`: assinatura `.FIT` nos bytes 8–11, ou elemento raiz XML `gpx` / `TrainingCenterDatabase`, com qualquer prefixo, ignorando declaração, comentários e DOCTYPE) e, na falta dele, da extensão (`formatFromName`, que ignora `.gz`). Textos XML passam por `trimStart()` antes do parse, porque TCX do Strava podem ter espaços antes de `<?xml`, o que o XML proíbe.

A tela (`screens/activity/import-page.ts`) aceita no seletor `.gpx,.fit,.tcx,.gz,.zip,application/gpx+xml,application/zip`; ao soltar, filtra por essas extensões ou MIME contendo `gpx`, `xml` ou `zip`.

### Atividade gerada

`buildActivity(parsed, fileName)`: `name` = nome do arquivo (GPX `<name>`, FIT `sport.name`) ou o nome do arquivo sem pastas, `.gz` e extensão (`displayName`); `startTime` = primeiro timestamp (senão hora da importação, `hasStartTime: false`); `fileName` = nome do arquivo ou caminho dentro do ZIP; `summary` = `computeSummary`. Corridas novas recebem o tênis padrão (`defaultShoeId`). Arquivos soltos são importados com qualquer tipo (inclusive `other`); o filtro de tipos vale só dentro de ZIPs.

### Repetidas (`findDuplicate`)

Mesmo `stravaId`; ou ambos com `hasStartTime`, início a ≤ 60 s e diferença de distância < 50 m. É a regra de `isDuplicate` da sincronização com o Strava (`data/strava.ts`), aplicada também aos arquivos soltos. Atividades importadas na mesma execução entram na lista de comparação.

### Resultado (`ImportResult`)

`{ imported: Activity[], failed: ImportFailure[], cancelled: boolean }`. `ImportFailure` = `{ fileName, code, existingId?, name? }` (`name` vem do `activities.csv`).

| `ImportErrorCode` | Quando | Rótulo na tela (pt-BR) |
|---|---|---|
| `duplicate` | `findDuplicate` achou a atividade (`existingId`) | **Já importada** / **N já estavam no app** |
| `no-gps` | parser lançou `GpxError('empty')`: menos de 2 pontos com posição | **Sem GPS (esteira ou indoor)** / **N sem GPS** |
| `manual` | linha do `activities.csv` sem arquivo | **Registrada à mão** / **N registrada(s) à mão (sem arquivo)** |
| `ignored-type` | tipo fora de `run`, `trail-run`, `walk` (só em ZIP) | **Outro tipo** / **N de outros tipos ignorada(s)** |
| `invalid` | `GpxError('invalid')`, ou o `.zip` não é ZIP | **Não é um arquivo GPX, FIT ou TCX** |
| `read` | falha de leitura/descompressão, ZIP corrompido, arquivo listado no CSV mas ausente do ZIP | **Não foi possível ler este arquivo** |
| `unsupported` | formato desconhecido (`UnsupportedFileError`), entrada ZIP cifrada ou com outro método | **Formato não suportado** |
| `save` | o IndexedDB recusou a gravação (ex.: cota) | **Não foi possível salvar (o armazenamento do navegador está cheio?)** |
| `empty` | mantido por compatibilidade; o `empty` dos parsers agora vira `no-gps` | **Nenhum ponto de trilha neste arquivo** |

Na tela, `invalid`, `empty`, `read`, `unsupported` e `save` contam como **N com erro**.

### Progresso e cancelamento

- `onProgress({ phase, done, total })`: `phase: 'open'` enquanto lê o índice de um ZIP (**Lendo o arquivo…**), `'import'` durante as atividades (**Importando {done} de {total}…**). Para arquivos soltos só é chamado com mais de um arquivo.
- Cada atividade é gravada assim que processada (`saveImported`), com `setTimeout(0)` entre atividades (`yieldToLoop`) para a página continuar respondendo.
- `signal` abortado (botão **Cancelar**, ou sair da tela) → para antes da próxima atividade e devolve `cancelled: true`; o que foi gravado fica. Rodar de novo pula o que já existe (repetidas).
- Ordem: primeiro os arquivos soltos, depois os ZIPs, um por vez.

## Atividades FIT (`parseActivityFit`, `src/data/parse-fit.ts`)

Decodificador próprio (sem dependência), seguindo o FIT SDK:

- Cabeçalho de 12 ou 14 bytes com `.FIT` nos bytes 8–11 (senão `GpxError('invalid')`); vários arquivos FIT encadeados no mesmo arquivo são lidos em sequência.
- Cabeçalhos de registro normais e de **timestamp comprimido** (offset de 5 bits sobre o último timestamp completo); mensagens de definição em **qualquer ordem de bytes** e com **campos de desenvolvedor** (pulados pelo tamanho). Mensagens e campos não usados são pulados pelo tamanho.
- Valores "inválidos" de cada tipo base (`0xFF`, `0x7FFF`, `0xFFFFFFFF`…) são tratados como ausentes.
- Tolerância: CRC-16 errado, tamanho declarado zero ou maior que o arquivo, ou arquivo truncado são aceitos se renderem uma trilha (≥ 2 pontos); sem trilha, viram `invalid`. Arquivo válido sem pontos com posição → `GpxError('empty')`.

| Mensagem (nº global) | Campos lidos | Conversão |
|---|---|---|
| `record` (20) | `timestamp` (253) | segundos desde 1989-12-31T00:00:00Z → epoch ms |
| | `position_lat` (0), `position_long` (1) | semicírculos × `180 / 2³¹` → graus; registros sem posição são descartados |
| | `enhanced_altitude` (78), senão `altitude` (2) | `valor / 5 − 500` → m |
| | `heart_rate` (3) | bpm, > 0 |
| | `cadence` (4) + `fractional_cadence` (53) | `cadence + fractional / 128`; a pé (tipo ≠ `other`) e < 130 → × 2 (passadas → passos/min) |
| | `power` (7), `temperature` (13) | W, °C |
| `session` (18) | `sport` (5), `sub_sport` (6) | a primeira sessão define o tipo |
| `sport` (12) | `sport` (0), `sub_sport` (1), `name` (3) | tipo, se não houver sessão; `name` vira o nome da atividade |

Tipo: sem `sport` → `run`; `sport = 1` → `run` (`sub_sport = 3` → `trail-run`); `11` (walking) ou `17` (hiking) → `walk`; outros → `other`. Pontos fora de ordem de tempo são reordenados (ordenação estável).

**Altitude de preenchimento (`dropAltitudePlaceholders`).** Alguns relógios gravam exatamente **−1,0 m** nos registros entre os registros completos, em vez do valor inválido. Lidos como reais, somam centenas de metros de subida a cada registro completo. O parser apaga esses valores quando os três critérios valem: o valor é exatamente −1; ele aparece em **≥ 10 %** dos pontos; e a **mediana** das outras altitudes está a **mais de 30 m** de −1. Corridas realmente perto do nível do mar mantêm os dados. As lacunas são preenchidas depois como qualquer ponto sem altitude ([analysis-and-metrics.md](../architecture/analysis-and-metrics.md)).

## Atividades TCX (`parseActivityTcx`, `src/data/parse-tcx.ts`)

- `DOMParser` (`application/xml`) após remover espaços e BOM iniciais; erro de parse ou raiz diferente de `TrainingCenterDatabase` → `GpxError('invalid')`.
- Independente de namespace (por `localName`): `ns3:TPX`, `ax:RunCadence`… funcionam.
- Lê todos os `Trackpoint` do arquivo; menos de 2 com posição → `GpxError('empty')`. Não há nome (usa o nome do arquivo).

| Dado | Elemento | Regra |
|---|---|---|
| Posição | `Position/LatitudeDegrees`, `Position/LongitudeDegrees` | pontos sem posição são ignorados |
| Altitude | `AltitudeMeters` | m |
| Tempo | `Time` | `Date.parse` → epoch ms |
| FC | `HeartRateBpm/Value` | > 0 |
| Cadência | `RunCadence` (em `Extensions`), senão `Cadence` | > 0; a pé e < 130 → × 2 |
| Potência | `Watts` (em `Extensions`) | ≥ 0 |
| Tipo | atributo `Sport` do primeiro `Activity` | vazio ou contém `run` → `run` (com `trail` → `trail-run`); `walk` ou `hik…` → `walk`; senão `other` |

## Arquivo de exportação do Strava (`importStravaArchive`, `src/data/strava-archive.ts`)

Gerado em Strava → **Configurações → Minha conta → Baixar ou excluir sua conta → Solicitar arquivo** (não exige assinatura nem app de API). Deve ser importado como `.zip`, sem descompactar.

### Conteúdo usado

| Caminho no ZIP | Uso |
|---|---|
| `activities.csv` | Índice: uma linha por atividade, cabeçalhos **no idioma da conta** (ex.: `Activity ID` / `ID da atividade`, `Filename` / `Nome do arquivo`). Procurado na raiz ou numa pasta (o caminho mais curto) |
| `activities/` | Um arquivo por atividade, nomeado por um **id de upload** (não é o id da atividade): na maioria `.fit.gz`, os antigos `.gpx.gz`, às vezes `.tcx.gz` ou sem compressão |
| todo o resto (rotas, mídia, perfil, mensagens…) | ignorado; nada é lido nem guardado |

### Colunas do `activities.csv` (`readActivitiesCsv`)

CSV RFC 4180 (`parseCsv`): campos entre aspas com vírgulas, quebras de linha e `""`; fim de linha CRLF/LF/CR; BOM ignorado; linhas em branco puladas.

| Posição (0-based) | Campo | Uso |
|---|---|---|
| 0 | id da atividade | `stravaId` (numérico) |
| 1 | data | início, só se o arquivo não tiver horários (`parseStravaDate`, em UTC) |
| 2 | nome | nome da atividade |
| 3 | tipo | `mapStravaType` (abaixo) |
| 4 | descrição | `notes` |
| 12 | nome do arquivo | caminho no ZIP (`activities/<upload>.fit.gz`); vazio = atividade manual |
| 15, 16, 17 | tempo total (s), tempo em movimento (s), distância (m) | lidos para `CsvActivity`, não gravados |

- Cada coluna é procurada primeiro pelo **rótulo do cabeçalho** (normalizado: minúsculas, sem acentos) em en, pt-BR, es, fr e de; se não achar, pela **posição** acima.
- Verificação: ≥ 90 % dos ids precisam ser numéricos, senão o CSV é descartado. A coluna do arquivo é aceita só se seus valores parecem caminhos de atividade (`isActivityFileName`, ao menos 4 para 1); senão o app procura a coluna que mais parece.
- Datas aceitas: `Nov 1, 2026, 9:00:15 AM`, `1 de nov. de 2026, 09:00:15`, `1 nov. 2026, 09:00:15`, ISO; meses em en, pt, es, fr, de, it e nl.

### Tipos (`mapStravaType`)

Rótulos em en, pt-BR, es, fr, de, it e nl, sem acentos:

| Rótulo (exemplos) | Tipo no app |
|---|---|
| Trail Run, Corrida em trilha, Carrera de montaña, Course en sentier | `trail-run` |
| Run, Corrida, Carrera, Course à pied, Laufen, Corsa, Hardlopen | `run` |
| Walk, Hike, Caminhada, Trilha, Caminata, Senderismo, Marche, Randonnée, Wandern… | `walk` |
| Ride, Swim, Weight Training, Yoga, Workout, Rowing, Ski, Elliptical… (e equivalentes) | `other` → `ignored-type` |
| desconhecido | usa o tipo lido do arquivo (que também precisa ser `run`, `trail-run` ou `walk`) |

### Processamento

1. `openZip` lê o diretório central; `readCsv` + `planWork` casam cada linha com sua entrada (caminho exato, com ou sem a pasta do CSV, ou só o nome do arquivo). Arquivos de `activities/` sem linha no CSV entram no fim, com nome e tipo do próprio arquivo.
2. Por linha: sem arquivo → `manual` (ou `read` se o CSV aponta um arquivo ausente); tipo `other` → `ignored-type` (sem descomprimir); mesmo `stravaId` já no app → `duplicate` (sem descomprimir).
3. Lê e descomprime a entrada, `parseActivityBytes`, `buildActivity`; aplica tipo, nome, data (fallback), `source: 'strava'`, `stravaId` e `notes` (descrição); `findDuplicate`; grava.
4. Sem `activities.csv` utilizável e sem pasta `activities/` (um ZIP qualquer de arquivos de atividade), importa todos os arquivos de atividade fora de `routes/`, com nome e tipo do arquivo e sem `source`.

Desempenho de referência: um arquivo real com ~350 atividades importou em menos de 10 s no Chrome.

## ZIP e gzip (`src/data/zip.ts`, `src/data/gzip.ts`)

| Recurso | Suporte |
|---|---|
| Métodos | `0` (stored) e `8` (deflate); outros → `ZipError('unsupported')` → `unsupported` |
| Criptografia | flag de criptografia ou método 99 → `ZipError('encrypted')` → `unsupported` |
| ZIP64 | tamanhos/offsets acima de 4 GB e mais de 65 535 entradas (registro e localizador ZIP64, campo extra `0x0001`) |
| Data descriptor | sim: tamanhos vêm do diretório central |
| Nomes | UTF-8 (com flag ou válido sem flag), senão CP437; `\` vira `/` |
| Comentário do arquivo | sim (o fim do diretório central é procurado de trás para frente; lixo no fim é tolerado) |
| Integridade | tamanho e CRC-32 de cada entrada conferidos → `ZipError('corrupt')` → `read` |
| Não é ZIP | `ZipError('not-zip')` → `invalid` |

- **Leitura por fatias:** `openZip(blob)` usa `blob.slice()`, então só o diretório central e as entradas realmente lidas vão para a memória. O arquivo do Strava pode ter vários GB por causa das mídias.
- **Descompressão:** `DecompressionStream` do navegador, sem dependência: `'deflate-raw'` para entradas ZIP e `'gzip'` para `.gz` (`decompress`, `gunzip`). Os bytes são escritos direto no stream (não via `Blob.stream()`).
- `strava-archive.ts` é carregado sob demanda (`import()` dinâmico em `importActivityFiles`), só quando há um ZIP; `zip.ts` e `gzip.ts` são estáticos (`import.ts` usa `ZipError` e `gunzip`).

## CSV de plano (`src/screens/training/csv.ts`)

- Cabeçalho obrigatório, colunas em qualquer ordem, nomes em inglês ou português; separador `,`, `;` ou tab (o mais frequente na 1ª linha). Aspas com escape `""`; BOM ignorado.
- Obrigatórias: `date` e `kind` (senão erro `columns`).

| Coluna (aliases) | Formato |
|---|---|
| `date` (`data`, `dia`) | `YYYY-MM-DD` ou `DD/MM/YYYY` |
| `kind` (`type`, `tipo`) | `easy`, `long`, `tempo`, `intervals`, `recovery`, `race`, `rest`, `cross` ou aliases (`leve`, `longão`, `intervalado`, `tiros`, `fartlek`, `regenerativo`, `prova`, `descanso`, `folga`, `musculação`…) |
| `title` (`titulo`, `name`, `nome`, `treino`, `workout`) | texto |
| `distance_km` (`distance`, `km`, `distancia`…) | número, `.` ou `,`; 0–500 |
| `duration` (`duracao`, `tempo`, `time`) | `h:mm:ss`, `mm:ss` ou minutos |
| `pace` (`ritmo`) | `m:ss` por km (sufixo `/km` ou `min/km` aceito) |
| `description` (`descricao`, `notes`, `notas`, `obs`) | texto |
| `steps` (`structure`, `estrutura`, `etapas`, `passos`) | sintaxe curta (abaixo) |
| `status` (`situacao`, `estado`) | `done` / `skipped` e aliases (`feito`, `ok`, `x`, `✓`, `pulado`, `não`…); vazio = casamento automático |

Códigos de erro por linha: `empty`, `columns`, `json`, `date`, `kind`, `distance`, `duration`, `pace`, `steps`, `status`.

Exportação (`exportPlanCsv`): ordenado por data; `steps` e `status` só aparecem se algum treino os usa. Modelo baixável (`csvTemplate`, gerado para 2026-11-01):

```csv
date,kind,title,distance_km,duration,pace,description,steps
2026-11-03,intervals,6x800 m,10.3,,,"Warm up 2 km, 6x800 m @ 4:30, 400 m jog, cool down 1.5 km","wu 2km; 6x(run 800m @4:25-4:35, rec 400m); cd 1.5km"
2026-11-05,easy,Easy run,6,,6:15,Conversational pace,
2026-11-06,cross,Strength,,45:00,,,
2026-11-07,rest,Rest,,,,,
2026-11-08,long,Long run,12,,6:30,,
```

## JSON de plano

Entrada aceita (`parsePlanJson`): objeto `{ name?, goal?, raceDate?, workouts: [...] }` ou só o array de treinos. Cada item usa `date`, `kind` (ou `type`), `title` (ou `name`), `distanceKm` (ou `distance_km`, `km`), `duration`, `pace`, `description`, `steps` (array de `WorkoutStep` ou texto curto), `status`. `goal` deve ser um `PlanGoal`; `raceDate` em `YYYY-MM-DD`. A escolha entre CSV e JSON (`parsePlanFile`) usa a extensão `.json` ou o primeiro caractere `{`/`[`.

Modelo baixável (`jsonTemplate`, 2026-11-01; mesmos treinos do CSV, `steps` como texto):

```json
{
  "name": "My 10K plan",
  "goal": "10k",
  "raceDate": "2026-12-27",
  "workouts": [
    { "date": "2026-11-03", "kind": "intervals", "title": "6x800 m", "distanceKm": 10.3,
      "description": "Warm up 2 km, 6x800 m @ 4:30, 400 m jog, cool down 1.5 km",
      "steps": "wu 2km; 6x(run 800m @4:25-4:35, rec 400m); cd 1.5km" },
    { "date": "2026-11-05", "kind": "easy", "title": "Easy run", "distanceKm": 6, "pace": "6:15", "description": "Conversational pace" },
    { "date": "2026-11-06", "kind": "cross", "title": "Strength", "duration": "45:00" },
    { "date": "2026-11-07", "kind": "rest", "title": "Rest" },
    { "date": "2026-11-08", "kind": "long", "title": "Long run", "distanceKm": 12, "pace": "6:30" }
  ]
}
```

Exportação (`exportPlanJson`) acrescenta `"format": "lapwing-plan", "version": 1` (ignorados na leitura) e grava `steps` como objetos sem `id` (`stripStepIds`):

```json
{ "type": "repeat", "times": 8, "steps": [
  { "type": "step", "kind": "active", "duration": { "type": "distance", "meters": 400 },
    "target": { "type": "pace", "min": 240, "max": 250 } },
  { "type": "step", "kind": "recovery", "duration": { "type": "distance", "meters": 200 } } ] }
```

## Sintaxe curta de treinos estruturados (`structure.ts`)

```
wu 15min; 8x(run 400m @4:00-4:10, rec 200m); cd 10min
```

| Elemento | Sintaxe |
|---|---|
| Separador de passos | `;` ou quebra de linha (fora de `()`/`[]`) |
| Passo | `[tipo] duração [@ alvo] [[nota]]` |
| Tipo | `wu`, `run`, `rec`, `cd`, `rest` + aliases (`warmup`, `aquecimento`, `tiro`, `forte`, `jog`, `trote`, `desaquecimento`, `pausa`, `descanso`…); padrão `run` (`active`) |
| Duração | `400m`, `1.5km`, `10min`, `90s`, `1h`, `1:30` (m:ss), `1:05:00`, `lap`/`open`/`livre` (até apertar a volta) |
| Alvo | `4:00-4:10` ou `4:00` (pace/km), `z2` / `zone2` (zona FC), `140-150bpm` |
| Repetição | `Nx(passo, passo, …)` ou `N×(…)`; um nível; vírgula separa passos (exceto vírgula decimal entre dígitos) |
| Nota | `[texto]`; ao exportar, `[`/`]` viram `(`/`)` e `;` vira espaço |

Mapeamento de tipos: `wu` → `warmup`, `run` → `active`, `rec` → `recovery`, `cd` → `cooldown`, `rest` → `rest`. Texto inválido ou que falha em `validateSteps` → `undefined` (erro `steps` na importação).

## Backup JSON

```json
{
  "app": "lapwing",
  "format": 1,
  "dbVersion": 2,
  "exportedAt": "2026-11-01T12:00:00.000Z",
  "secrets": false,
  "stores": { "activities": [ … ], "tracks": [ … ], "plans": [], "workouts": [], "settings": [ … ], "shoes": [], "goals": [] },
  "localStorage": { "lapwing:lang": "pt-BR", "lapwing:theme": "dark" }
}
```

| Campo | Regra |
|---|---|
| `app` | `lapwing` (lê também `route-maker`) |
| `format` | `BACKUP_FORMAT = 1`; maior → `newer-format` |
| `dbVersion` | `SCHEMA_VERSION` (2) |
| `secrets` | `false` remove `clientSecret`, `accessToken`, `refreshToken` do registro `settings/strava` |
| `stores` | Todas as `STORES`; cada registro precisa de `id` |
| `localStorage` | Só chaves `lapwing:*` |

- Nome: `lapwing-backup-YYYY-MM-DD.json` ou `.json.gz` (data local).
- Gzip opcional via `CompressionStream('gzip')`; na leitura o gzip é detectado pelos bytes mágicos `1f 8b`, não pela extensão.
- Erros (`BackupErrorCode`): `not-a-backup`, `newer-format`, `malformed`, `no-gzip`. Regras de restauração em [storage-and-migration.md](../architecture/storage-and-migration.md#compatibilidade-de-backups).

## ICS (`exportIcs`)

- RFC 5545: `VCALENDAR` com `PRODID:-//Lapwing//Training plans//EN`, `X-WR-CALNAME`; um `VEVENT` de dia inteiro por treino (`DTSTART;VALUE=DATE` / `DTEND` no dia seguinte), `UID:<id>@lapwing`, `CATEGORIES` = nome do tipo, `TRANSP:TRANSPARENT`.
- `DESCRIPTION`: alvo, estrutura e descrição (textos no idioma atual).
- Escape de `\ ; ,` e quebras; linhas dobradas em 75 octetos sem cortar caracteres UTF-8; fim de linha `CRLF`.
- Exportação de plano: filtro `selectWorkouts` (descanso opcional, a partir de uma data).

```
BEGIN:VEVENT
UID:abc@lapwing
DTSTAMP:20261101T000000Z
DTSTART;VALUE=DATE:20261103
DTEND;VALUE=DATE:20261104
SUMMARY:8x400
DESCRIPTION:Target: 7 km\nStructure: 15 min WU · 8×(400 m @ 4:00–4:10 /
 km\, 200 m jog) · 10 min CD
CATEGORIES:Intervals
TRANSP:TRANSPARENT
END:VEVENT
```

## TCX de treino (`exportTcx`)

- `TrainingCenterDatabase` v2, seção `<Workouts>`, `Sport="Running"`. Só tipos de corrida (`RUNNING_KINDS`: `easy`, `long`, `tempo`, `intervals`, `recovery`, `race`).
- `Name`: 1–15 caracteres, únicos (sufixo numérico); com `schedule` o nome começa com `MM-DD` e há `<ScheduledOn>`.
- Passos: `effectiveSteps` — os `steps` do treino ou um passo único com distância/duração e pace ±10 s.

| Passo | TCX |
|---|---|
| Distância / tempo / aberto | `Distance_t` (`Meters`) / `Time_t` (`Seconds`) / `UserInitiated_t` |
| Pace | `Speed_t` + `CustomSpeedZone_t`, `ViewAs=Pace`, m/s (pace lento = low) |
| Zona FC | `HeartRate_t` + `PredefinedHeartRateZone_t` |
| FC bpm | `HeartRate_t` + `CustomHeartRateZone_t` |
| Intensidade | `Resting` para `rest`/`recovery`, senão `Active` |
| Repetição (≥ 2) | `Repeat_t` com `Repetitions` (máx. 99) e `Child`; 1 vez é achatada |

## FIT de treino (`exportWorkoutFit` / `encodeWorkoutFit`)

Encoder mínimo seguindo o FIT SDK, para **um** treino:

| Item | Valor |
|---|---|
| Cabeçalho | 14 bytes, protocolo 1.0 (`0x10`), perfil 21.00, `.FIT`, CRC do cabeçalho |
| Mensagens | `file_id` (0; `type=5` workout, fabricante 255 development), `workout` (26; `sport=1` running, `num_valid_steps`, `wkt_name` ≤ 32 bytes), `workout_step` (27) |
| Fim | CRC-16 (CRC-16/ARC do SDK), little endian |
| Tempo | segundos desde 1989-12-31T00:00:00Z (`FIT_EPOCH_MS`) |

`workout_step`: `wkt_step_name` (16 bytes), `duration_type` (0 tempo em ms, 1 distância em cm, 5 aberto, 6 repetição), `target_type` (0 velocidade, 1 FC, 2 aberto), velocidades em mm/s (`1 000 000 / pace`), FC custom com offset +100, `intensity` (`active` 0, `rest` 1, `warmup` 2, `cooldown` 3, `recovery` 4), `notes` opcional (≤ 64 bytes). Uma repetição grava os filhos e depois um passo `repeat_until_steps_cmplt` apontando para o primeiro filho, com `times` em `target_value`. Download: `<slug>.fit`, MIME `application/vnd.ant.fit`.

## Query de filtros do histórico

`#/history?…`. Os filtros usam `filtersToQuery` / `filtersFromQuery` (chaves em `FILTER_KEYS`); `range` é lido e escrito pela própria tela (`historyHash` em `screens/history/index.ts`).

| Chave | Valor |
|---|---|
| `range` | `4w`, `12w` (padrão, omitido), `year`, `all` (fora de `FILTER_KEYS`) |
| `q` | busca por nome |
| `dmin`, `dmax` | distância em **km** |
| `pmin`, `pmax` | pace em s/km |
| `emin`, `emax` | ganho de altitude em m |
| `hmin`, `hmax` | FC média em bpm (`hmin=0` sozinho = "tem FC") |
| `t` | tipos de atividade separados por vírgula |
| `k` | tipos de treino casado (`easy`…`race`, `unplanned`) |
| `from`, `to` | `YYYY-MM-DD` |

Valores inválidos são ignorados na leitura. Mudar a query não remonta a tela.

## Veja também

- [Modelo de dados](../architecture/data-model.md)
- [Armazenamento e migração](../architecture/storage-and-migration.md)
- [Guia: treinos](../features/training.md)
- [Guia: análise](../features/analysis.md)
- [Análise e métricas](../architecture/analysis-and-metrics.md)
- [Privacidade](../privacy.md)
- [Guia: backup](../features/settings/backup.md)
