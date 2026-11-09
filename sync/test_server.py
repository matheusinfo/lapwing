"""Tests for the Lapwing sync server: python3 -m unittest sync/test_server.py"""
import gzip
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
os.environ["SYNC_LOG"] = "0"
import server  # noqa: E402


class SyncServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "t.db")
        self.start()

    def start(self):
        self.srv = server.make_server(self.db, "127.0.0.1", 0)
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.srv.RequestHandlerClass.store.db.close()

    def tearDown(self):
        self.stop()
        self.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return json.loads(r.read())

    def post(self, body, gz=False):
        data = json.dumps(body).encode() if not isinstance(body, bytes) else body
        headers = {"Content-Type": "application/json"}
        if gz:
            data = gzip.compress(data)
            headers["Content-Encoding"] = "gzip"
        req = urllib.request.Request(self.base + "/api/sync/push", data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def post_status(self, body):
        try:
            self.post(body)
        except urllib.error.HTTPError as e:
            return e.code
        return 200

    def test_status(self):
        s = self.get("/api/sync/status")
        self.assertEqual(s["app"], "lapwing-sync")
        self.assertEqual(s["protocol"], 1)
        self.assertEqual(s["seq"], 0)
        self.assertEqual(len(s["epoch"]), 32)

    def test_push_and_pull_between_devices(self):
        r = self.post({"device": "A", "changes": [
            {"store": "activities", "id": "a1", "deleted": False, "data": {"id": "a1", "name": "Corrida ção"}},
            {"store": "goals", "id": 7, "deleted": False, "data": {"id": 7, "km": 20}},
        ]}, gz=True)
        self.assertEqual(r["seq"], 2)
        b = self.get("/api/sync/changes?since=0&device=B")
        self.assertEqual([c["id"] for c in b["changes"]], ["a1", 7])
        self.assertEqual(b["changes"][0]["data"]["name"], "Corrida ção")
        self.assertEqual(b["next"], 2)
        self.assertFalse(b["more"])
        # The pushing device doesn't get its own changes back, but its cursor still moves.
        a = self.get("/api/sync/changes?since=0&device=A")
        self.assertEqual(a["changes"], [])
        self.assertEqual(a["next"], 2)

    def test_last_writer_wins_and_tombstones(self):
        self.post({"device": "A", "changes": [{"store": "plans", "id": "p", "deleted": False, "data": {"id": "p", "v": 1}}]})
        self.post({"device": "B", "changes": [{"store": "plans", "id": "p", "deleted": False, "data": {"id": "p", "v": 2}}]})
        c = self.get("/api/sync/changes?since=0&device=C")["changes"]
        self.assertEqual(c, [{"store": "plans", "id": "p", "deleted": False, "data": {"id": "p", "v": 2}}])
        self.post({"device": "A", "changes": [{"store": "plans", "id": "p", "deleted": True}]})
        page = self.get("/api/sync/changes?since=2&device=C")
        self.assertEqual(page["changes"], [{"store": "plans", "id": "p", "deleted": True}])
        self.assertEqual(page["next"], 3)

    def test_rejects_bad_input(self):
        self.assertEqual(self.post_status({"device": "A", "changes": [{"store": "nope", "id": "x", "data": {"id": "x"}}]}), 400)
        self.assertEqual(self.post_status({"device": "A", "changes": [{"store": "plans", "id": "x", "data": {"id": "y"}}]}), 400)
        self.assertEqual(self.post_status({"device": "", "changes": []}), 400)
        self.assertEqual(self.post_status(b"not json"), 400)
        self.assertEqual(self.get("/api/sync/status")["seq"], 0)

    def test_strava_login_is_never_stored(self):
        self.post({"device": "A", "changes": [
            {"store": "settings", "id": "strava", "deleted": False, "data": {"id": "strava", "refreshToken": "x"}},
            {"store": "settings", "id": "athlete", "deleted": False, "data": {"id": "athlete", "maxHr": 190}},
        ]})
        ids = [c["id"] for c in self.get("/api/sync/changes?since=0&device=B")["changes"]]
        self.assertEqual(ids, ["athlete"])

    def test_paging(self):
        server.PAGE_ROWS, old = 3, server.PAGE_ROWS
        try:
            self.post({"device": "A", "changes": [
                {"store": "goals", "id": f"g{i}", "deleted": False, "data": {"id": f"g{i}"}} for i in range(7)
            ]})
            seen, since, pages = [], 0, 0
            while True:
                p = self.get(f"/api/sync/changes?since={since}&device=B")
                seen += [c["id"] for c in p["changes"]]
                since, pages = p["next"], pages + 1
                if not p["more"]:
                    break
            self.assertEqual(seen, [f"g{i}" for i in range(7)])
            self.assertEqual(pages, 3)
        finally:
            server.PAGE_ROWS = old

    def test_data_and_epoch_survive_restart(self):
        self.post({"device": "A", "changes": [{"store": "goals", "id": "g", "deleted": False, "data": {"id": "g"}}]})
        epoch = self.get("/api/sync/status")["epoch"]
        self.stop()
        self.start()
        s = self.get("/api/sync/status")
        self.assertEqual((s["epoch"], s["seq"]), (epoch, 1))


if __name__ == "__main__":
    unittest.main()
