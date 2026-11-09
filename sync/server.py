#!/usr/bin/env python3
"""Lapwing sync server: keeps one copy of the app's records so every browser
that opens the same site sees the same data.

Standard library only (http.server + sqlite3). It has no login of its own:
put it behind something that authenticates (e.g. Cloudflare Access) and expose
it only through the app's web server, under /api/sync/.

API (JSON):
  GET  /api/sync/status                         -> {app, protocol, epoch, seq}
  GET  /api/sync/changes?since=N&device=D       -> {epoch, changes[], next, more}
  POST /api/sync/push   {device, changes[]}     -> {seq}   (body may be gzip)
  GET  /healthz                                 -> ok

A change is {store, id, deleted, data?}. Every write gets a new, increasing
`seq`; a record keeps only its latest version (last writer wins) and deletions
stay as tombstones, so any device can catch up from its last `seq`.
"""
from __future__ import annotations

import gzip
import io
import json
import os
import sqlite3
import threading
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

APP = "lapwing-sync"
PROTOCOL = 1
PREFIX = "/api/sync"
STORES = {"activities", "tracks", "plans", "workouts", "settings", "shoes", "goals"}
# Never stored here: per-device credentials (the app doesn't send them either).
LOCAL_ONLY = {("settings", '"strava"')}

MAX_BODY = int(os.environ.get("SYNC_MAX_BODY", 32 * 1024 * 1024))
PAGE_BYTES = int(os.environ.get("SYNC_PAGE_BYTES", 2 * 1024 * 1024))
PAGE_ROWS = 500


class Store:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=NORMAL")
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS records (
                  store   TEXT NOT NULL,
                  id      TEXT NOT NULL,      -- JSON-encoded key
                  seq     INTEGER NOT NULL,
                  device  TEXT NOT NULL,
                  deleted INTEGER NOT NULL,
                  data    TEXT,               -- JSON record, NULL when deleted
                  PRIMARY KEY (store, id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS records_seq ON records (seq);
                """
            )
            row = self.db.execute("SELECT value FROM meta WHERE key='epoch'").fetchone()
            if row is None:
                self.epoch = uuid.uuid4().hex
                self.db.execute("INSERT INTO meta VALUES ('epoch', ?)", (self.epoch,))
            else:
                self.epoch = row[0]

    def seq(self) -> int:
        with self.lock:
            return self.db.execute("SELECT COALESCE(MAX(seq), 0) FROM records").fetchone()[0]

    def push(self, device: str, changes: list[tuple[str, str, bool, str | None]]) -> int:
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                seq = self.db.execute("SELECT COALESCE(MAX(seq), 0) FROM records").fetchone()[0]
                for store, key, deleted, data in changes:
                    seq += 1
                    self.db.execute(
                        "INSERT OR REPLACE INTO records (store, id, seq, device, deleted, data) VALUES (?, ?, ?, ?, ?, ?)",
                        (store, key, seq, device, 1 if deleted else 0, None if deleted else data),
                    )
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise
            return seq

    def changes(self, since: int, device: str) -> str:
        """Changes after `since`, without the asking device's own; `next` covers the skipped ones too."""
        with self.lock:
            rows = self.db.execute(
                "SELECT store, id, seq, device, deleted, data FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
                (since, PAGE_ROWS + 1),
            ).fetchall()
        more = len(rows) > PAGE_ROWS
        rows = rows[:PAGE_ROWS]
        out, size, nxt = [], 0, since
        for store, key, seq, dev, deleted, data in rows:
            if out and size >= PAGE_BYTES:
                more = True
                break
            nxt = seq
            if dev == device:
                continue
            item = f'{{"store":{json.dumps(store)},"id":{key},"deleted":{"true" if deleted else "false"}'
            item += "}" if deleted else f',"data":{data}}}'
            out.append(item)
            size += len(item)
        body = f'{{"epoch":{json.dumps(self.epoch)},"changes":[{",".join(out)}],"next":{nxt},"more":{"true" if more else "false"}}}'
        return body


class BadRequest(Exception):
    pass


def parse_push(raw: bytes) -> tuple[str, list[tuple[str, str, bool, str | None]]]:
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise BadRequest("invalid JSON") from exc
    if not isinstance(body, dict):
        raise BadRequest("expected an object")
    device = body.get("device")
    changes = body.get("changes")
    if not isinstance(device, str) or not 0 < len(device) <= 100:
        raise BadRequest("invalid device")
    if not isinstance(changes, list):
        raise BadRequest("invalid changes")
    out = []
    for c in changes:
        if not isinstance(c, dict) or c.get("store") not in STORES:
            raise BadRequest("invalid store")
        rid = c.get("id")
        if not isinstance(rid, (str, int, float)) or isinstance(rid, bool):
            raise BadRequest("invalid id")
        key = json.dumps(rid, separators=(",", ":"))
        if (c["store"], key) in LOCAL_ONLY:
            continue
        deleted = c.get("deleted") is True
        data = None
        if not deleted:
            rec = c.get("data")
            if not isinstance(rec, dict) or rec.get("id") != rid:
                raise BadRequest("invalid record")
            data = json.dumps(rec, separators=(",", ":"), ensure_ascii=False)
        out.append((c["store"], key, deleted, data))
    return device, out


class Handler(BaseHTTPRequestHandler):
    server_version = "lapwing-sync"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    store: Store  # set by make_server

    def log_message(self, fmt, *args):  # one line per request, without the health checks
        if os.environ.get("SYNC_LOG", "1") != "0" and not self.path.startswith("/healthz"):
            super().log_message(fmt, *args)

    def send_json(self, status: int, body: str | dict) -> None:
        data = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def error(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/healthz":
            data = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif url.path == f"{PREFIX}/status":
            self.send_json(200, {"app": APP, "protocol": PROTOCOL, "epoch": self.store.epoch, "seq": self.store.seq()})
        elif url.path == f"{PREFIX}/changes":
            q = parse_qs(url.query)
            try:
                since = int(q.get("since", ["0"])[0])
            except ValueError:
                return self.error(400, "invalid since")
            device = q.get("device", [""])[0]
            self.send_json(200, self.store.changes(max(since, 0), device))
        else:
            self.error(404, "not found")

    def do_POST(self):
        if urlsplit(self.path).path != f"{PREFIX}/push":
            return self.error(404, "not found")
        try:
            length = int(self.headers.get("Content-Length") or -1)
        except ValueError:
            length = -1
        if length < 0:
            return self.error(411, "length required")
        if length > MAX_BODY:
            return self.error(413, "body too large")
        raw = self.rfile.read(length)
        try:
            if self.headers.get("Content-Encoding", "").lower() == "gzip":
                d = gzip.GzipFile(fileobj=io.BytesIO(raw))
                raw = d.read(MAX_BODY + 1)
                if len(raw) > MAX_BODY:
                    return self.error(413, "body too large")
            device, changes = parse_push(raw)
        except (OSError, EOFError):
            return self.error(400, "invalid gzip")
        except BadRequest as exc:
            return self.error(400, str(exc))
        seq = self.store.push(device, changes)
        self.send_json(200, {"seq": seq})


def make_server(db_path: str, host: str, port: int) -> ThreadingHTTPServer:
    store = Store(db_path)
    handler = type("BoundHandler", (Handler,), {"store": store})
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    return srv


def main() -> None:
    db_path = os.environ.get("SYNC_DB", "/data/lapwing.db")
    host = os.environ.get("SYNC_HOST", "0.0.0.0")
    port = int(os.environ.get("SYNC_PORT", "8000"))
    srv = make_server(db_path, host, port)
    print(f"lapwing-sync on {host}:{port}, db {db_path}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
