<!-- docs-tree: docs/architecture/routing-engine.md | parent: docs/architecture/README.md -->
# Motor do editor de rotas

> **Árvore:** [docs](../README.md) › [architecture](README.md) › routing-engine
> **Resumo:** Internos do editor de rotas: invariante do `RouteState`, tipos e status de segmento, `RoutingQueue`, BRouter `shortest`, `chooseGeometry`, snapping e histórico de undo compartilhado.
> **Código:** `src/screens/routes/route/state.ts`, `src/screens/routes/route/router.ts`, `src/screens/routes/route/editor.ts`, `src/screens/routes/map.ts`, `src/screens/routes/index.ts`

## Peças

| Módulo | Classe/função | Responsabilidade |
|---|---|---|
| `route/state.ts` | `RouteState` | Waypoints, segmentos, undo/redo, listeners |
| `route/editor.ts` | `RouteEditor` | Cliques no mapa, marcadores, edições (cada uma = um passo de undo) |
| `route/router.ts` | `RoutingQueue`, `routeSegment`, `chooseGeometry` | Requisições ao BRouter, cancelamento, escolha de geometria, snapping |
| `map.ts` | `createRouteMap`, `setRouteData` | Mapa, camadas da rota, vista salva |
| `index.ts` | `mount` | Liga tudo, persiste em `localStorage`, GPX abrir/exportar |

Fluxo a cada mudança (registrado após `ready`):

```
state.change(mutate) ─► emit() ─► routing.sync()     (inicia/cancela requisições)
                               ├► editor.render()    (setRouteData + marcadores)
                               ├► refreshPanel()     (estatísticas + toolbar)
                               └► saveRoute em 300 ms (lapwing:route)
```

## Invariante do `RouteState`

> `segments[i]` liga `waypoints[i]` a `waypoints[i + 1]`, logo `segments.length === max(0, waypoints.length - 1)`.

- Toda mutação passa por `state.change(mutate)`: tira snapshot para undo, limpa redo, aplica, emite.
- `load(waypoints, segments)` substitui sem histórico (usado ao restaurar do storage).
- `track()` concatena `coords` de todos os segmentos sem repetir o ponto de junção.
- Histórico: `MAX_HISTORY = 100` snapshots.

## Segmentos

```ts
interface Segment { from: LngLat; to: LngLat; kind: SegmentKind; status: SegmentStatus; coords: Coord[] }
```

| `kind` | Origem | Comportamento |
|---|---|---|
| `routed` | Todo segmento novo | Pedido ao BRouter; vira o caminho ou uma reta se o caminho for quase igual |
| `straight` | Botão direito na linha | Reta forçada pelo usuário; continua reta ao mover pontas |
| `imported` | GPX aberto | Geometria exata do arquivo; ao mover uma ponta, vira `routed` |

| `status` | Significado | Desenho (`map.ts`) |
|---|---|---|
| `ready` | `coords` finais | `route-line` laranja sólida |
| `pending` | Aguardando BRouter; `coords` = reta provisória `[from, to]` | `route-dashed` cinza tracejada |
| `failed` | BRouter falhou; mantém a reta como fallback | `route-dashed` laranja tracejada |

Camadas do mapa: `route-casing` (halo, `--map-casing`), `route-line`, `route-dashed`, `route-hit` (linha invisível de 20 px para cliques; `ROUTE_HIT_LAYER`). Cada feature carrega `properties: { status, index }`.

## Edições (`RouteEditor`)

| Ação | Método | Efeito |
|---|---|---|
| Clique no mapa (fora da linha) | `addPoint(p)` | Novo waypoint + segmento `routed/pending` a partir do último |
| Clique na linha | `insertAt(hit)` | Divide o segmento no ponto mais próximo (`nearestOnSegments`), **sem** re-rotear |
| Arrastar marcador | `moveWaypoint(i, p)` | Reconstrói os dois segmentos vizinhos (`rebuild`); durante o arrasto, `previewMove` desenha retas tracejadas |
| Botão direito / toque longo (600 ms) no marcador | `deleteWaypoint(i)` | Remove; no meio, une vizinhos com um novo segmento `routed`; ignora segundo delete em < 1 s |
| Botão direito na linha | `toggleStraight(i)` | `straight ↔ routed/pending` |
| Fechar circuito | `closeLoop()` | `addPoint(waypoints[0])`; requer ≥ 2 pontos e não ser circuito |
| Inverter | `reverse()` | Inverte waypoints, segmentos, `from/to` e `coords` |
| Limpar | `clear()` | Esvazia (desfazível) |
| Abrir GPX | `loadTrack(coords)` | Dois waypoints + um segmento `imported/ready` |

Circuito (`isLoop()`): mais de 2 waypoints e o primeiro igual ao último. Mostra um marcador único (`wp-loop`, o último fica `wp-hidden`); mover o início move também o fim. `doubleClickZoom` fica desligado para não criar dois pontos e dar zoom.

## `RoutingQueue`

- `sync()` (chamado em todo `emit`):
  1. Aborta requisições de segmentos que não estão mais em `state.segments`.
  2. Inicia requisições para segmentos `routed` + `pending` sem requisição, até `MAX_CONCURRENT = 4`.
- Ao concluir: aplica `chooseGeometry`, marca `ready` e, se usou o caminho roteado, chama `snapEnds`. Em erro (não abortado): `failed` + callback `onFailure` (toast `routeFailed`). No `finally`, `state.emit()` redesenha e libera vagas.
- `busy` → `inflight.size > 0` (mostra `t('routing')` no painel).

### Requisição ao BRouter (`routeSegment`)

| Parâmetro | Valor |
|---|---|
| URL | `https://brouter.de/brouter` |
| `lonlats` | `lon,lat\|lon,lat` |
| `profile` | `shortest` (caminho mais direto por vias mapeadas) |
| `alternativeidx` | `0` |
| `format` | `geojson` |
| Timeout | `AbortSignal.timeout(15_000)` combinado ao sinal da fila (`AbortSignal.any`) |
| Cache | `Map` em memória por par de pontos com 6 casas decimais (vida da página) |

Resposta: `features[0].geometry.coordinates` → `Coord[]` (altitude quando finita). Status HTTP não-OK ou menos de 2 pontos → erro.

### `chooseGeometry(from, to, routed)`

| Constante | Valor | Regra |
|---|---|---|
| `STRAIGHT_MIN_DISTANCE` | 30 m | Segmento mais curto que isso → sempre reta |
| `STRAIGHT_RATIO` | 1,12 | Caminho ≤ 1,12 × distância direta → reta |

A reta preserva as altitudes que o BRouter informou nas pontas. Caso contrário, usa o caminho completo.

### Snapping (`snapEnds`)

Só quando o caminho roteado é usado. Para cada ponta:

| Distância waypoint → início/fim do caminho | Ação |
|---|---|
| 0 | nada |
| ≤ `SNAP_MAX_DISTANCE` (50 m) | Move o waypoint para a ponta do caminho e ajusta a ponta dos segmentos vizinhos (`moveEnd`); em circuito, move início e fim juntos |
| > 50 m | Waypoint fica; o caminho é estendido com uma reta até ele |

`moveEnd` não altera `coords` de vizinhos `pending` (receberão novas coords ao concluir).

## Histórico de undo compartilhado

- O snapshot copia **os arrays**, mas compartilha os objetos `Segment` e as tuplas de waypoint.
- Edições nunca mudam esses objetos no lugar; criam novos.
- Já a fila **muta no lugar** (`seg.coords`, `seg.status`, tuplas no snapping). Assim, quando uma requisição termina, o resultado aparece também nos snapshots de undo/redo e nunca volta um placeholder obsoleto.
- Depois de restaurar do storage os segmentos podem ter cópias das tuplas; por isso `snapEnds` atualiza `from`/`to` dos vizinhos explicitamente.

## Persistência e ciclo de vida

- `lapwing:route` salvo 300 ms após a última mudança; no unmount (inclusive troca de tema) um salvamento pendente é feito na hora.
- Segmentos restaurados com `status: 'pending'` são re-roteados no primeiro `sync()`.
- A edição de rotas nunca depende de sucesso do roteamento: falha vira reta `failed`.

## Veja também

- [Serviços externos](external-services.md#brouter)
- [Comandos e atalhos](../reference/commands.md)
- [Guia: rotas](../features/routes.md)
- [Testes](../development/testing.md) (`tests/route-router.test.ts`)
