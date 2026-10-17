"""Replay mode: re-stream a recorded real session through the same WebSocket, flagged replay: true.

The offline fallback for judging and the frontend's mock data. Nothing is generated: every event is the recorded
one, re-sequenced under a new session id with compressed timing.
"""

import asyncio
import json
import uuid
from datetime import datetime

from litmus import store
from litmus.config import SHARED_DIR
from litmus.models import Event, SessionState, now_iso

DEMO_PATH = SHARED_DIR / "demo-session.json"
MAX_GAP_SECONDS = 1.5  # long GPU waits are compressed so a 5-minute session replays in about 2
PROGRESS_GAP_SECONDS = 0.02

_tasks: set[asyncio.Task] = set()


class ReplayError(RuntimeError):
    """No usable recording."""


def record(session_id: str, path=None) -> dict:
    """Write a finished session's snapshot and full event log to shared/demo-session.json."""
    path = path or DEMO_PATH
    state = store.get(session_id)
    events = store.events_after(session_id, 0)
    recording = {"recorded_at": now_iso(), "source_session_id": session_id,
                 "snapshot": state.model_copy(update={"last_seq": len(events)}).model_dump(),
                 "events": [e.model_dump() for e in events]}
    path.write_text(json.dumps(recording, indent=1))
    return {"path": str(path), "events": len(events), "stars": len(state.stars)}


def _gap(previous: Event, current: Event) -> float:
    if current.type == "experiment.progress":
        return PROGRESS_GAP_SECONDS
    seconds = (datetime.fromisoformat(current.ts) - datetime.fromisoformat(previous.ts)).total_seconds()
    return max(0.0, min(seconds, MAX_GAP_SECONDS))


async def _stream(session_id: str, events: list[Event], snapshot: dict, speed: float) -> None:
    previous = events[0]
    for event in events:
        await asyncio.sleep(_gap(previous, event) / speed)
        payload = {**event.payload, "replay": True} if event.type == "session.started" else event.payload
        store.emit(session_id, event.type, payload)
        previous = event
    final = SessionState.model_validate({**snapshot, "id": session_id, "replay": True, "last_seq": store.last_seq(session_id)})
    store.put(final)


def start(speed: float = 1.0, path=None) -> str:
    """Create a replay session and start streaming it; returns the new session id."""
    path = path or DEMO_PATH
    if not path.exists():
        raise ReplayError(f"no recording at {path}; run `uv run litmus record-demo <session_id>`")
    recording = json.loads(path.read_text())
    events = [Event.model_validate(e) for e in recording["events"]]
    if not events:
        raise ReplayError("the recording has no events")
    snapshot = recording["snapshot"]
    state = SessionState(id=f"rpl_{uuid.uuid4().hex[:10]}", goal=snapshot["goal"], budget_total=snapshot["budget_total"],
                         replay=True)
    store.create_session(state, {"replay": True, "source_session_id": recording["source_session_id"]})
    task = asyncio.create_task(_stream(state.id, events, snapshot, speed))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return state.id
