# Lapwing coach server (coach/): answers the Coach screen with Claude, holding
# the Anthropic API key so it never reaches the browser.
#
# Build from the repository root (the bundle step needs package.json):
#   docker build -f coach/Dockerfile -t lapwing-coach .
#   docker run -d --env-file .env -p 127.0.0.1:8001:8001 lapwing-coach
#
# Serve it only behind the app's web server, under /api/coach/, and behind a
# login (e.g. Cloudflare Access): it has no authentication of its own.
# Guide: docs/features/coach.md

# ---------- build: one self-contained file ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/build-coach.mjs scripts/
COPY coach coach
RUN node scripts/build-coach.mjs

# ---------- runtime ----------
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/coach/dist/server.mjs ./server.mjs

USER node
ENV NODE_ENV=production \
    COACH_HOST=0.0.0.0 \
    COACH_PORT=8001
EXPOSE 8001
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8001/healthz || exit 1
CMD ["node", "server.mjs"]
