<!-- docs-tree: docs/getting-started/docker.md | parent: docs/getting-started/README.md -->
# Rodar com Docker

> **Árvore:** [docs](../README.md) › [getting-started](README.md) › docker
> **Resumo:** Subir o Lapwing num servidor (ou no seu computador) com Docker, sem instalar o Node: build, Docker Compose, porta, subpasta, HTTPS e atualização.
> **Código:** `Dockerfile`, `compose.yaml`, `docker/nginx.conf`, `.dockerignore`

## Do que você precisa

- **[Docker](https://docs.docker.com/get-docker/)** com o plugin **Compose** (`docker compose version` deve responder). O Docker Desktop já traz os dois.
- Uma cópia do repositório (`git clone` ou o `.zip` do GitHub).
- Internet durante o build (baixa as imagens base e os pacotes npm).

Não é preciso instalar o Node: o build acontece dentro do container.

## Subir em 1 minuto

Na pasta do projeto:

```bash
docker compose up -d --build
```

Abra **http://localhost:8080**. Pronto.

| Para… | Comando |
|---|---|
| Ver se está saudável | `docker compose ps` (coluna STATUS mostra `healthy`) |
| Acompanhar os logs | `docker compose logs -f` |
| Parar e remover | `docker compose down` |
| Atualizar para a versão nova | `git pull && docker compose up -d --build` |

Os dados de quem usa **não ficam no container**: ficam no navegador de cada pessoa ([privacidade](../privacy.md)). Por isso não há volume para configurar, e recriar o container não apaga nada.

## Sem Compose (só `docker`)

```bash
docker build -t lapwing .
docker run -d --name lapwing --restart unless-stopped -p 8080:8080 lapwing
```

Para atualizar: `git pull`, `docker build -t lapwing .`, `docker rm -f lapwing` e o `docker run` de novo.

## Configuração

O `compose.yaml` lê duas variáveis de ambiente. Defina no terminal ou num arquivo `.env` ao lado do `compose.yaml`:

```dotenv
# .env
LAPWING_PORT=3000          # porta no servidor (padrão 8080)
LAPWING_BASE_PATH=/        # "/" = raiz do domínio; "/lapwing/" = subpasta
```

Dentro do container o nginx sempre escuta na porta **8080**.

### Argumentos de build

| Argumento | Padrão | Para quê |
|---|---|---|
| `BASE_PATH` | `/` | Caminho onde o app vai morar. Precisa começar e terminar com `/` (ex.: `/lapwing/`); o build falha com uma mensagem clara se não estiver assim. |
| `RUN_TESTS` | `false` | `true` roda `npm test` antes do build; se algum teste falhar, a imagem não é gerada. |

Exemplo sem Compose:

```bash
docker build --build-arg BASE_PATH=/lapwing/ --build-arg RUN_TESTS=true -t lapwing .
```

### Publicar numa subpasta

Com `LAPWING_BASE_PATH=/lapwing/`, o app responde em `http://servidor:8080/lapwing/` (a raiz `/` dá 404). Isso serve para colocar o Lapwing atrás de um proxy que **repassa o caminho inteiro**, sem cortar o prefixo. Mudar o `BASE_PATH` exige um novo build (`docker compose up -d --build`), porque o caminho fica gravado nos arquivos gerados.

## HTTPS e proxy reverso

O container fala só HTTP. Em produção, coloque um proxy reverso na frente para ter **HTTPS**, que é recomendado (alguns recursos do navegador exigem contexto seguro). Exemplo mínimo com o [Caddy](https://caddyserver.com/), que emite o certificado sozinho:

```caddyfile
lapwing.exemplo.com {
    reverse_proxy 127.0.0.1:8080
}
```

Se o proxy roda na mesma máquina, publique a porta só no loopback para ela não ficar exposta. No `compose.yaml`:

```yaml
    ports:
      - "127.0.0.1:${LAPWING_PORT:-8080}:8080"
```

Nginx, Traefik, Cloudflare Tunnel e afins funcionam do mesmo jeito: basta apontar para a porta 8080 do container.

## Strava

Se alguém for usar a sincronização com o Strava, o **Authorization Callback Domain** do app de API do Strava precisa ser o domínio onde o Lapwing está publicado (ex.: `lapwing.exemplo.com`, sem `https://` nem caminho). Passo a passo em [features/settings/strava.md](../features/settings/strava.md).

## Trocar de domínio ou de porta

O navegador guarda os dados **por origem** (domínio + porta). Se você mudar o endereço do Lapwing, cada pessoa vê o app vazio no endereço novo. Avise para baixarem um backup no endereço antigo e restaurarem no novo ([backup](../features/settings/backup.md)).

## Como a imagem é feita

O `Dockerfile` tem dois estágios:

1. **build** (`node:22-alpine`): `npm ci` e `npm run build`, que confere os tipos e gera `dist/`. As dependências são instaladas antes de copiar o código, então builds seguidos reaproveitam o cache.
2. **runtime** (`nginxinc/nginx-unprivileged:1.29-alpine`): só o `dist/` e o `docker/nginx.conf`. O nginx roda **sem root**, e a imagem final não tem Node nem código-fonte.

O que o `docker/nginx.conf` faz:

| Caminho | Comportamento |
|---|---|
| `/healthz` | Responde `ok`; usado pelo `HEALTHCHECK` da imagem |
| `…/assets/*` | Cache de 1 ano (`immutable`), porque os nomes têm hash. Arquivos `.mjs` (worker do MapLibre) saem como JavaScript |
| demais (`index.html`) | `Cache-Control: no-cache`, para o navegador pegar a versão nova logo após um deploy |
| tudo | gzip, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, sem versão do nginx nos cabeçalhos |

Não há regra de fallback de SPA: o app usa rotas com `#` (`#/history`), e o retorno do Strava (`/?state=…&code=…`) cai no próprio `index.html`.

O `compose.yaml` ainda endurece o container: sistema de arquivos **somente leitura** (com `/tmp` em memória para o nginx), `no-new-privileges`, todas as *capabilities* removidas e limite de 64 MB de memória. O app usa bem menos que isso.

O `.dockerignore` deixa fora do build `node_modules`, `dist`, `.git`, `docs`, `deploy` e os `.md`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `port is already allocated` | A porta 8080 está em uso. Defina outra em `LAPWING_PORT` (ex.: `LAPWING_PORT=3000 docker compose up -d`). |
| `docker: 'compose' is not a docker command` | Instale o plugin Compose ou use o Docker Desktop. Versões antigas usam `docker-compose` (com hífen). |
| O build falha em `npm run build` | Um erro de tipos no código. Rode `npm run build` fora do Docker para ver os detalhes, ou leia o log com `docker compose build --progress=plain`. |
| Página em branco numa subpasta | O `BASE_PATH` do build não bate com o caminho do endereço. Ajuste `LAPWING_BASE_PATH` e rode `docker compose up -d --build`. |
| Log mostra `can not modify /etc/nginx/conf.d/default.conf (read-only file system?)` | Aviso normal com o sistema de arquivos somente leitura. Pode ignorar. |
| O mapa fica em branco | O mapa é baixado da internet pelo navegador de quem usa (OpenFreeMap), não pelo servidor. Confira a conexão de quem está acessando. |
| Mudei o código e nada mudou | Use `--build` no `docker compose up`, e recarregue a página. |

## Veja também

- [Instalar e rodar](install-and-run.md)
- [Ambiente e implantação](../development/setup.md)
- [Serviços externos](../architecture/external-services.md)
- [Privacidade](../privacy.md)
