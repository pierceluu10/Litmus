"""SQLite persistence: session snapshots, the append-only event log, and the (config, seed) result cache.

Everything runs on one asyncio loop and every mutation is synchronous (read, modify, save, emit with no
await in between), so no locks are needed. A server restart loses nothing: snapshots and events are on disk.
"""

import asyncio
import json
import sqlite3
from collections import defaultdict

from litmus.config import DATA_DIR
from litmus.models import Event, SessionState, now_iso

DB_PATH = DATA_DIR / "litmus.sqlite"
SUBSCRIBER_QUEUE_SIZE = 10000

_db: sqlite3.Connection | None = None
_sessions: dict[str, SessionState] = {}
_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def db() -> sqlite3.Connection:
    global _db
    if _db is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        _db.execute("PRAGMA journal_mode=WAL")
        _db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, config TEXT NOT NULL,
                                                 created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL,
                                               type TEXT NOT NULL, payload TEXT NOT NULL,
                                               PRIMARY KEY (session_id, seq));
            CREATE TABLE IF NOT EXISTS results (config_hash TEXT NOT NULL, seed INTEGER NOT NULL, knobs TEXT NOT NULL,
                                                result TEXT NOT NULL, created_at TEXT NOT NULL,
                                                PRIMARY KEY (config_hash, seed));
        """)
    return _db


# ---------------------------------------------------------------- sessions

def create_session(state: SessionState, config: dict) -> None:
    db().execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
                 (state.id, state.model_dump_json(), json.dumps(config), state.created_at))
    _sessions[state.id] = state


def get(session_id: str) -> SessionState:
    """The live session object. Mutate it, then call save()."""
    if session_id not in _sessions:
        row = db().execute("SELECT state FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise KeyError(session_id)
        _sessions[session_id] = SessionState.model_validate_json(row[0])
    return _sessions[session_id]


def config(session_id: str) -> dict:
    row = db().execute("SELECT config FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if row is None:
        raise KeyError(session_id)
    return json.loads(row[0])


def save(state: SessionState) -> None:
    db().execute("UPDATE sessions SET state = ? WHERE id = ?", (state.model_dump_json(), state.id))


def list_sessions() -> list[dict]:
    rows = db().execute("SELECT id, state FROM sessions ORDER BY created_at DESC").fetchall()
    out = []
    for session_id, raw in rows:
        state = _sessions.get(session_id) or SessionState.model_validate_json(raw)
        out.append({"id": session_id, "goal": state.goal, "status": state.status,
                    "created_at": state.created_at, "replay": state.replay})
    return out


# ---------------------------------------------------------------- events

def last_seq(session_id: str) -> int:
    row = db().execute("SELECT MAX(seq) FROM events WHERE session_id = ?", (session_id,)).fetchone()
    return row[0] or 0


def emit(session_id: str, type_: str, payload: dict, ts: str | None = None) -> Event:
    """Persist an event with the next seq and push it to every live subscriber."""
    event = Event(seq=last_seq(session_id) + 1, ts=ts or now_iso(), session_id=session_id, type=type_,
                  payload=payload)
    db().execute("INSERT INTO events VALUES (?, ?, ?, ?, ?)",
                 (session_id, event.seq, event.ts, event.type, json.dumps(event.payload, default=str)))
    for queue in list(_subscribers[session_id]):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            _subscribers[session_id].discard(queue)  # a stuck client reconnects with from_seq
    return event


def events_after(session_id: str, from_seq: int) -> list[Event]:
    rows = db().execute("SELECT seq, ts, type, payload FROM events WHERE session_id = ? AND seq > ? ORDER BY seq",
                        (session_id, from_seq)).fetchall()
    return [Event(seq=s, ts=ts, session_id=session_id, type=t, payload=json.loads(p)) for s, ts, t, p in rows]


def subscribe(session_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    _subscribers[session_id].add(queue)
    return queue


def unsubscribe(session_id: str, queue: asyncio.Queue) -> None:
    _subscribers[session_id].discard(queue)


# ---------------------------------------------------------------- result cache

def cached_result(config_hash: str, seed: int) -> dict | None:
    row = db().execute("SELECT result FROM results WHERE config_hash = ? AND seed = ?", (config_hash, seed)).fetchone()
    return json.loads(row[0]) if row else None


def cache_result(config_hash: str, seed: int, knobs: dict, result: dict) -> None:
    db().execute("INSERT OR REPLACE INTO results VALUES (?, ?, ?, ?, ?)",
                 (config_hash, seed, json.dumps(knobs), json.dumps(result), now_iso()))
