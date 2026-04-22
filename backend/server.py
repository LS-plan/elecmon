#!/usr/bin/env python3
"""轻量 HTTP API 服务，仅供立刻采集使用，监听 127.0.0.1:8089"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
except ImportError:
    pass

from backend.poll import main as poll_once
from backend.config import HISTORY_JSON

_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 屏蔽 access log

    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/collect":
            self.send_response(404)
            self.end_headers()
            return

        if not _lock.acquire(blocking=False):
            self._send_json(429, {"error": "采集中，请稍候再试"})
            return
        try:
            poll_once()
            with open(HISTORY_JSON, encoding="utf-8") as f:
                history = json.load(f)
            self._send_json(200, history[-1] if history else {})
        except Exception as e:
            self._send_json(500, {"error": str(e)})
        finally:
            _lock.release()


if __name__ == "__main__":
    port = int(os.environ.get("API_PORT", 8089))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"ElecMon API listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()
