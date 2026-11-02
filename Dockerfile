# Lapwing: imagem Docker pronta para produção.
#
# Estágio 1 compila o app com Node (npm run build -> dist/).
# Estágio 2 serve o dist/ com nginx, sem root, na porta 8080.
#
#   docker build -t lapwing .
#   docker run -d -p 8080:8080 --name lapwing lapwing
#
# Guia completo: docs/getting-started/docker.md

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Dependências primeiro, para aproveitar o cache do Docker.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Caminho base do app. Use "/" (padrão) para servir na raiz do domínio, ou
# algo como "/lapwing/" para servir numa subpasta (com as barras).
ARG BASE_PATH=/
# Passe --build-arg RUN_TESTS=true para rodar a suíte de testes no build.
ARG RUN_TESTS=false

RUN case "$BASE_PATH" in /*/|/) ;; *) echo "BASE_PATH precisa começar e terminar com / (ex.: /lapwing/)" >&2; exit 1;; esac \
    && if [ "$RUN_TESTS" = "true" ]; then npm test; fi \
    && npm run build -- --base="$BASE_PATH"

# ---------- runtime ----------
FROM nginxinc/nginx-unprivileged:1.29-alpine

ARG BASE_PATH=/

LABEL org.opencontainers.image.title="Lapwing" \
      org.opencontainers.image.description="Rotas de corrida, análise de treinos e evolução, tudo no navegador." \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html${BASE_PATH}

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
