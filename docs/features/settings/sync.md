<!-- docs-tree: docs/features/settings/sync.md | parent: docs/features/settings/README.md -->
# Sincronização — os mesmos dados em todos os aparelhos

> **Árvore:** [docs](../../README.md) › [features](../README.md) › [settings](README.md) › sync
> **Resumo:** Quando o site do Lapwing tem o servidor de sincronização, suas corridas, planos e metas aparecem em todos os aparelhos que abrem o mesmo endereço.
> **Tela:** `#/settings` (cartão **Sincronização**) · **Código:** `src/data/sync.ts`, `src/screens/settings/sync-section.ts`, `sync/server.py`

## Para que serve

Sem servidor, cada navegador guarda os próprios dados, e para levar tudo a outro aparelho é preciso usar o [backup](backup.md). Se quem publicou o Lapwing também rodar o **servidor de sincronização** (`sync/`), o app passa a guardar uma cópia lá e manter todos os aparelhos iguais, sozinho.

O cartão **Sincronização** só aparece quando o site tem esse servidor. Em hospedagens só de arquivos (GitHub Pages, Netlify…) ele fica escondido e nada muda.

## Como funciona para quem usa

- **Automático.** Cada mudança é enviada cerca de 2 segundos depois. O app também busca as novidades ao abrir, ao voltar para a aba e a cada minuto com a aba aberta.
- **O cartão mostra** o estado (**Tudo sincronizado**, **Sincronizando…**, **Sem conexão**, erro ou **Sua sessão expirou**), a hora da última sincronização e quantas mudanças aguardam envio. **Sincronizar agora** força uma rodada.
- **Primeira vez num aparelho:** o que ele já tinha é enviado e o que está no servidor é baixado. Os dois lados se somam.
- **Mesma coisa editada em dois aparelhos:** vale a última versão enviada (registro por registro).
- **Exclusões também sincronizam.** Apagar uma corrida num aparelho apaga nos outros.
- **Sessão expirada:** se o site fica atrás de um login (por exemplo, Cloudflare Access), o cartão pede para recarregar a página. Nada se perde: as mudanças esperam e são enviadas depois.

## O que sincroniza e o que não

| Sincroniza | Fica só no aparelho |
|---|---|
| Corridas e trajetos GPS, planos, treinos, metas, tênis, configurações do atleta | **Login do Strava** (Client Secret e tokens): os tokens mudam a cada renovação e dois aparelhos com os mesmos tokens desconectariam um ao outro. Conecte o Strava em cada aparelho. |
| | Preferências do `localStorage` (tema, idioma, percurso em edição, posição do mapa…) |

## Bom saber

- **Importe o mesmo arquivo em um aparelho só.** Corridas importadas separadamente em dois aparelhos ganham identificadores diferentes e aparecem duplicadas depois da sincronização.
- **O servidor não tem login próprio.** Ele precisa ficar atrás de algo que autentique (por exemplo, Cloudflare Access) e ser acessível só pelo servidor web do app, em `/api/sync/`. Ver [Para quem publica o app](#para-quem-publica-o-app).
- **O backup continua útil.** A sincronização não guarda versões antigas: uma exclusão sincronizada não tem volta. Faça [backups](backup.md) de vez em quando.
- **Servidor zerado:** se o banco do servidor for apagado, cada aparelho percebe (o servidor tem um identificador, `epoch`) e reenvia tudo o que tem.

## Para quem publica o app

O servidor é um único arquivo Python (`sync/server.py`, só biblioteca padrão), com os dados num SQLite. Rodar:

```bash
SYNC_DB=/caminho/lapwing.db SYNC_PORT=8000 python3 sync/server.py
# ou a imagem: docker build -t lapwing-sync sync/
```

O servidor web do app deve repassar `/api/sync/` para ele (sem cortar o caminho) e aceitar corpos de até 32 MB. Em desenvolvimento: `LAPWING_SYNC_URL=http://127.0.0.1:8000 npm run dev` (proxy do Vite, também no `npm run preview`).

| Endpoint | O que faz |
|---|---|
| `GET /api/sync/status` | `{ app: "lapwing-sync", protocol: 1, epoch, seq }`; o app usa para detectar o servidor |
| `GET /api/sync/changes?since=N&device=D` | Mudanças depois de `N`, sem as do próprio aparelho, em páginas (`next`, `more`) |
| `POST /api/sync/push` | `{ device, changes: [{ store, id, deleted, data? }] }`, opcionalmente em gzip |
| `GET /healthz` | Verificação de saúde |

Variáveis: `SYNC_DB` (padrão `/data/lapwing.db`), `SYNC_HOST`, `SYNC_PORT` (padrão `8000`), `SYNC_MAX_BODY`, `SYNC_LOG=0` para silenciar o log. Testes: `python3 -m unittest sync/test_server.py`.

No navegador, o estado da sincronização fica no `localStorage` com o prefixo `lapwing-sync:` (aparelho, cursor, `epoch`, fila de envio). Esse prefixo fica de fora do backup de propósito, para que restaurar um backup em outro aparelho não copie a identidade deste.
