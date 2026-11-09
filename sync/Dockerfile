# Lapwing sync server (sync/server.py): standard library only, data in SQLite
# under /data. Serve it behind the app's nginx at /api/sync/ and behind a login
# (e.g. Cloudflare Access): the server itself has no authentication.
ARG PYTHON_IMAGE=python:3.12-alpine
FROM ${PYTHON_IMAGE}

# A plain Alpine base works too (e.g. armhf hosts without a fitting python
# image): python3 is installed only when the base doesn't have it.
RUN command -v python3 >/dev/null || apk add --no-cache python3; \
    python3 --version && mkdir -p /data && chown 10001:10001 /data

WORKDIR /app
COPY server.py .

USER 10001:10001
ENV SYNC_DB=/data/lapwing.db \
    SYNC_PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]
CMD ["python3", "/app/server.py"]
