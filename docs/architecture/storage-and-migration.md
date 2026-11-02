<!-- docs-tree: docs/architecture/storage-and-migration.md | parent: docs/architecture/README.md -->
# Armazenamento e migração

> **Árvore:** [docs](../README.md) › [architecture](README.md) › storage-and-migration
> **Resumo:** Todas as chaves de `localStorage`/`sessionStorage`, a migração Route Maker → Lapwing e a compatibilidade de backups.
> **Código:** `src/app/legacy-storage.ts`, `src/data/db.ts`, `src/data/backup.ts`, `src/data/strava.ts`

## Onde cada dado vive

| Mecanismo | Conteúdo |
|---|---|
| IndexedDB `lapwing` | Atividades, trilhas, planos, treinos, configurações, tênis, metas ([data-model.md](data-model.md)) |
| `localStorage` (`lapwing:*`) | Preferências e o rascunho do editor de rotas |
| `sessionStorage` (`lapwing:*`) | Estado temporário do OAuth do Strava |
| `BroadcastChannel('lapwing-db')` | Só mensagens (nome da store alterada), nada persistido |
| Memória | Cache de rotas do BRouter (`router.ts`), cache de melhores esforços (`history/efforts.ts`) |

Todo acesso a storage é envolvido em `try/catch`: em modo privado ou com storage bloqueado o app continua funcionando, só sem persistir preferências.

## Chaves de `localStorage`

| Chave | Módulo | Valor |
|---|---|---|
| `lapwing:lang` | `src/i18n/index.ts` | `'en'` ou `'pt-BR'` (texto puro) |
| `lapwing:theme` | `src/ui/theme.ts`, script inline de `index.html` | `'system'`, `'light'` ou `'dark'` |
| `lapwing:route` | `src/screens/routes/index.ts` | JSON `{ waypoints: LngLat[], segments: Segment[] }` (salvo com debounce de 300 ms) |
| `lapwing:name` | `src/screens/routes/index.ts` | JSON string com o nome da rota |
| `lapwing:view` | `src/screens/routes/map.ts` | JSON `{ center: [lng, lat], zoom }` (salvo em `moveend`) |
| `lapwing:pace` | `src/screens/routes/stats.ts` | Texto do campo de pace (ex.: `6:00`), padrão `6:00` |
| `lapwing:insights-window` | `src/screens/insights/index.ts` | `'all'` ou `'90d'` |
| `lapwing:training:active-plan` | `src/screens/training/index.ts` | id do plano ativo |

`restoreRoute()` só aceita `lapwing:route` se `segments.length === waypoints.length - 1` (invariante de [routing-engine.md](routing-engine.md)).

## Chaves de `sessionStorage`

| Chave | Módulo | Valor | Vida útil |
|---|---|---|---|
| `lapwing:strava-state` | `src/data/strava.ts` | 16 bytes aleatórios em hex (`state` do OAuth) | De `startAuthorization()` até `captureStravaRedirect()` |
| `lapwing:strava-pending` | `src/data/strava.ts` | JSON `PendingAuth`: `{ code, scope }` ou `{ error: 'denied' \| 'state' }` | Até `takePendingAuth()` na tela de configurações |

## Regras para novas chaves

- Use sempre o prefixo `lapwing:` (é o que o backup copia e o que a migração gera).
- Leia e grave dentro de `try/catch`.
- Dados de usuário que precisam sobreviver/ser sincronizados entre abas vão para o IndexedDB, não para `localStorage`.

## Migração Route Maker → Lapwing

O app se chamava **Route Maker**. Há três migrações, todas idempotentes.

### 1. Chaves de storage (`src/app/legacy-storage.ts`)

- Executa como efeito colateral do import, que é o segundo import de `main.ts` (antes de qualquer leitura de configuração).
- Para `localStorage` **e** `sessionStorage`: cada chave `route-maker:<x>` vira `lapwing:<x>`.
- Se `lapwing:<x>` já existe, o valor novo é mantido; a chave antiga é removida de qualquer forma.
- `migrateLegacyKeys(storage)` é exportada para testes (`tests/legacy-storage.test.ts`).

### 2. Banco IndexedDB (`src/data/db.ts`)

Na primeira chamada a `open()`:

1. Abre/cria `lapwing` (versão 2) e anota se foi criado agora (`oldVersion === 0`).
2. `legacyDbMayExist(created)`:
   - com `indexedDB.databases()` disponível: verifica se existe um banco `route-maker`;
   - sem essa API: assume que existe só quando `lapwing` acabou de ser criado.
3. `migrateLegacyDb(target)`:
   - lê todas as stores do banco antigo que também existem no novo (uma transação de leitura);
   - grava tudo com `put` no novo (uma transação de escrita; ids iguais são sobrescritos);
   - fecha e apaga `route-maker`.
4. Se a cópia falhar, o banco antigo **é mantido** (com `console.warn`) e a cópia é tentada de novo na próxima abertura onde `indexedDB.databases()` existe.

A migração não chama `notify()`.

### 3. Backups antigos (`src/data/backup.ts`)

`validateBackup` aceita `app: 'lapwing'` e `app: 'route-maker'`. Chaves `route-maker:*` na seção `localStorage` do arquivo são renomeadas para `lapwing:*`; outras chaves sem prefixo conhecido são descartadas.

## Compatibilidade de backups

Formato completo em [file-formats.md](../reference/file-formats.md#backup-json). O backup sempre inclui todas as `STORES` (inclusive `shoes`, cuja UI está desativada); o cartão de backup só mostra contagens de `SUMMARY_STORES` (`activities`, `plans`, `workouts`, `goals`). Regras de compatibilidade:

| Situação | Resultado |
|---|---|
| `app` diferente de `lapwing`/`route-maker`, ou JSON que não é objeto | `BackupError('not-a-backup')` |
| `format` ausente, não inteiro ou < 1 | `BackupError('malformed')` |
| `format > BACKUP_FORMAT` (1) | `BackupError('newer-format')` |
| Arquivo gzip sem `DecompressionStream` | `BackupError('no-gzip')` |
| Store desconhecida no arquivo | Listada em `unknownStores`, ignorada na restauração |
| Registro de store conhecida sem `id` string/número finito | `BackupError('malformed')` |
| `dbVersion` maior que `SCHEMA_VERSION` | Restaura, mas `summarizeBackup` marca `newerSchema: true` (a UI avisa) |
| Backup sem segredos sobre um dispositivo conectado ao Strava | `planRestore` preserva `clientSecret`, `accessToken` e `refreshToken` locais quando o campo falta no arquivo |

Modos de restauração (`RestoreMode`):

- `merge`: `put` por id; em conflito o arquivo vence.
- `replace`: esvazia cada store **presente no arquivo** e grava (uma única transação para todas as stores).

Após a restauração, as chaves `lapwing:*` do arquivo são gravadas em `localStorage`. A seção de backup aplica o idioma restaurado na hora (`setLang`); as demais preferências passam a valer quando o módulo dono as relê (o tema, por exemplo, é lido por `theme.ts` só no carregamento da página).

## Veja também

- [Modelo de dados](data-model.md)
- [Serviços externos](external-services.md)
- [Formatos de arquivo](../reference/file-formats.md)
- [Guia: backup e restauração](../features/settings/backup.md)
- [Privacidade](../privacy.md)
