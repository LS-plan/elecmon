import logging
import os
from datetime import datetime, timedelta

import requests as http_requests
from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.scheduler import start_scheduler
from backend.database import query_readings, get_latest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

RANGE_MAP = {
    "1d": 1,
    "3d": 3,
    "7d": 7,
    "1m": 30,
    "3m": 90,
    "1y": 365,
}


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/data")
def get_data():
    range_key = request.args.get("range", "7d")
    days = RANGE_MAP.get(range_key, 7)
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    rows = query_readings(since)
    return jsonify(rows)


@app.route("/api/latest")
def latest():
    row = get_latest()
    return jsonify(row or {})


@app.route("/api/analyze", methods=["POST"])
def analyze():
    body = request.json or {}
    base_url = body.get("base_url", "").rstrip("/")
    api_key = body.get("api_key", "")
    model = body.get("model", "gpt-4o")
    messages = body.get("messages", [])

    if not base_url or not api_key:
        return jsonify({"error": "base_url 和 api_key 不能为空"}), 400

    try:
        resp = http_requests.post(
            f"{base_url}/v1/chat/completions",
            json={"model": model, "messages": messages},
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
            },
            timeout=60,
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    scheduler = start_scheduler()
    try:
        app.run(host="0.0.0.0", port=5000, debug=False)
    finally:
        scheduler.shutdown()
