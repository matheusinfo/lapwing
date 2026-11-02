<!-- docs-tree: docs/architecture/external-services.md | parent: docs/architecture/README.md -->
# Serviços externos

> **Árvore:** [docs](../README.md) › [architecture](README.md) › external-services
> **Resumo:** Os três serviços de rede que o app usa (OpenFreeMap, BRouter, Strava), seus endpoints e limites, e exatamente que dados saem do dispositivo e quando.
> **Código:** `src/map/base.ts`, `src/screens/routes/route/router.ts`, `src/data/strava.ts`, `src/main.ts`, `src/screens/settings/strava-section.ts`

## Resumo

| Serviço | Para quê | Quando | Chave/conta |
|---|---|---|---|
| OpenFreeMap | Estilo, tiles, fontes e sprites do mapa | Sempre que um mapa é exibido | Não |
| BRouter (`brouter.de`) | Caminho a pé entre dois pontos | A cada segmento novo/alterado no editor de rotas | Não |
| Strava API | OAuth e importação de corridas | Só se o usuário configurar e clicar em conectar/sincronizar | App de API do próprio usuário (exige assinatura do Strava) |

Não há backend próprio, analytics, telemetria nem fontes web externas. Fora esses três, o app só faz requisições ao próprio host (arquivos estáticos).

## OpenFreeMap

| Item | Valor |
|---|---|
| Estilo claro | `https://tiles.openfreemap.org/styles/liberty` (`STYLE_URL`) |
| Estilo escuro | `https://tiles.openfreemap.org/styles/dark` (`DARK_STYLE_URL`) |
| Escolha | `mapStyleUrl()` conforme `getTheme()`; trocar o tema remonta a tela e recria o mapa |
| Cliente | MapLibre GL via `createBaseMap()` |

O estilo referencia os demais recursos (tiles vetoriais, glyphs, sprites), que o MapLibre baixa conforme a área e o zoom visíveis.

**Dados que saem:** IP, user-agent e as áreas do mapa visualizadas (implícitas nos tiles pedidos). Mapas aparecem no editor de rotas, no relatório de corrida e na comparação.

## BRouter

| Item | Valor |
|---|---|
| Endpoint | `GET https://brouter.de/brouter` |
| Parâmetros | `lonlats=<lon>,<lat>\|<lon>,<lat>`, `profile=shortest`, `alternativeidx=0`, `format=geojson` |
| Timeout | 15 s (`AbortSignal.timeout`) |
| Concorrência | Até 4 requisições simultâneas (`MAX_CONCURRENT`) |
| Cache | Em memória, por par de pontos (6 casas decimais), até recarregar a página |
| Cancelamento | Segmentos removidos/substituídos abortam a requisição (`RoutingQueue.sync`) |
| Falha | Segmento vira reta `failed` + toast; a edição continua ([routing-engine.md](routing-engine.md)) |

**Dados que saem:** as coordenadas de início e fim de cada segmento roteado. Retas forçadas e GPX abertos (`imported`) não geram requisição; mover a ponta de um segmento importado gera.

## Strava

### Modelo

- **Requer assinatura paga do Strava:** desde junho de 2026, criar e usar aplicações da API do Strava exige uma assinatura. O app não verifica isso; sem assinatura o usuário não consegue criar a aplicação. A alternativa sem API é importar o `.zip` de exportação da conta do Strava (todas as atividades, lido localmente por `data/strava-archive.ts`, com `stravaId` gravado para a sincronização reconhecê-las depois) ou arquivos GPX/FIT/TCX avulsos ([file-formats.md](../reference/file-formats.md#arquivo-de-exportação-do-strava-importstravaarchive-srcdatastrava-archivets)).
- Sem servidor: o usuário cria **sua própria** aplicação em `https://www.strava.com/settings/api` e informa Client ID e Client Secret na tela de configurações.
- Em "Authorization Callback Domain" deve constar o hostname onde o app roda (a tela mostra `location.hostname`, ou `localhost`).
- Credenciais e tokens ficam só no IndexedDB (`settings`, registro `{ id: 'strava' }`). Ver [data-model.md](data-model.md#registro-do-strava-stravasettings-srcdatastravats).

### Endpoints

| Uso | Método e URL | Corpo / parâmetros |
|---|---|---|
| Consentimento | navegação para `https://www.strava.com/oauth/authorize` | `client_id`, `response_type=code`, `redirect_uri`, `approval_prompt=auto`, `scope`, `state` |
| Troca de código | `POST https://www.strava.com/oauth/token` | form: `client_id`, `client_secret`, `code`, `grant_type=authorization_code` |
| Renovação | `POST https://www.strava.com/oauth/token` | form: `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token` |
| Revogação | `POST https://www.strava.com/oauth/deauthorize` | form: `access_token` (melhor esforço; erros ignorados) |
| Listagem | `GET https://www.strava.com/api/v3/athlete/activities?after=<s>&per_page=100&page=<n>` | `Authorization: Bearer <token>` |
| Streams | `GET https://www.strava.com/api/v3/activities/<id>/streams?keys=latlng,time,altitude,heartrate,cadence,temp,watts,distance&key_by_type=true` | idem |

### OAuth passo a passo

1. `startAuthorization(clientId)`: gera `state` (16 bytes hex) em `sessionStorage['lapwing:strava-state']` e navega para o consentimento. `redirect_uri = origin + pathname` (sem query nem hash).
2. O Strava volta para `…/?state=…&code=…&scope=…` (ou `error=…`).
3. `main.ts` detecta `state` em `location.search` e chama `captureStravaRedirect()` **antes do primeiro render**: compara o `state`, grava `PendingAuth` em `sessionStorage['lapwing:strava-pending']`, remove a query com `history.replaceState` e vai para `#/settings`.
4. A seção Strava chama `takePendingAuth()` e `exchangeCode()`; os tokens são salvos. Se o atleta mudou, `syncCursor` e `lastSyncAt` são zerados.

Escopo pedido: `STRAVA_SCOPE = 'read,activity:read_all'`. `canReadActivities(scope)` verifica se o usuário concedeu `activity:read` ou `activity:read_all`.

### Tokens

- `StravaApi.token()` renova quando faltam ≤ 60 s para `expiresAt` (epoch s) e persiste via `onTokens`.
- Respostas 400/401/403 do endpoint de token → `credentials` (na troca) ou `unauthorized` (na renovação). 401 na API → `unauthorized`.
- `disconnect()` revoga e mantém só `clientId` e `clientSecret` (`withoutTokens`).

### Sincronização (`syncStrava`)

| Etapa | Detalhe |
|---|---|
| Faixa (`SyncRange`) | `since-last` (`syncCursor` ou 30 dias), `30d`, `12m` (365 dias), `all` (`after=0`) |
| Listagem | Páginas de 100 até vir uma página incompleta |
| Filtro | `mapSportType`: `Run`/`VirtualRun` → `run`, `TrailRun` → `trail-run`, `Walk`/`Hike` → `walk`; outros contam em `ignored` |
| Ordem | Mais antigas primeiro |
| Por atividade | Checa duplicata **antes** de baixar streams; pula `manual` ou sem GPS (`skipped`); 404 nos streams → `skipped`; outro erro HTTP → `failed` |
| Cursor | Salvo após cada atividade tratada; para de avançar após uma falha (a atividade é retentada na próxima vez) |
| Interrupção | Limite de taxa, token revogado, rede e cancelamento (`AbortSignal`) param a sincronização e são reportados em `error`/`cancelled` |

### Limites de taxa

- HTTP 429 → `StravaError('rate-limit')`.
- `parseRateLimit` lê `X-ReadRateLimit-Usage/Limit` (preferido) ou `X-RateLimit-Usage/Limit`, no formato `"curto,diário"` (janela de 15 min e dia). Os números vêm do Strava; o app não fixa limites.
- A UI mostra o uso quando os cabeçalhos estão expostos.

### CORS

O app chama o Strava direto do navegador e **assume** que a API permite CORS para qualquer origem. As requisições de token usam `URLSearchParams` (form-encoded) para serem "simples" e evitar preflight; as chamadas à API com `Authorization` dependem do preflight ser aceito. Os cabeçalhos de rate limit só são legíveis se o Strava os expuser via CORS; por isso `usage` é opcional.

**Dados que saem:** Client ID, Client Secret, código e tokens (só para `strava.com`). Nenhum dado de atividade é enviado ao Strava; o fluxo é só de download.

## O que sai do dispositivo, por ação

| Ação do usuário | Destino | Dados |
|---|---|---|
| Abrir uma tela com mapa | OpenFreeMap | Área/zoom visíveis (tiles), IP |
| Botão de geolocalização do editor | API de geolocalização do navegador | Posição usada só localmente para centralizar o mapa (tiles da área são pedidos depois) |
| Adicionar/mover ponto de rota | BRouter | Coordenadas dos dois extremos do segmento |
| Conectar ao Strava | Strava | Client ID, `redirect_uri`, `state`; depois Client Secret + código |
| Sincronizar | Strava | Token, parâmetros de listagem e ids de atividade |
| Desconectar | Strava | Access token (revogação) |
| Importar GPX/FIT/TCX ou o `.zip` do Strava, analisar, planejar, backup | — | Nada: tudo local |

## Veja também

- [Armazenamento e migração](storage-and-migration.md)
- [Motor do editor de rotas](routing-engine.md)
- [Implantação](../development/setup.md#implantação)
- [Guia: Strava](../features/settings/strava.md)
- [Privacidade](../privacy.md)
