import sqlite3
import os
from backend.config import DB_PATH


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                remaining REAL NOT NULL,
                gift REAL NOT NULL DEFAULT 0
            )
        """)
        conn.commit()


def insert_reading(ts: str, remaining: float, gift: float):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO readings (ts, remaining, gift) VALUES (?, ?, ?)",
            (ts, remaining, gift)
        )
        conn.commit()


def query_readings(since_iso: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ts, remaining, gift FROM readings WHERE ts >= ? ORDER BY ts ASC",
            (since_iso,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_latest():
    with get_conn() as conn:
        row = conn.execute(
            "SELECT ts, remaining, gift FROM readings ORDER BY ts DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None
