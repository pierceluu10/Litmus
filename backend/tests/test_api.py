"""API + contract conformance: every event payload validates against the contract models, WS replays from seq."""

import time

import pytest
from fastapi.testclient import TestClient

from litmus import api, store
from litmus.models import (Abstract, Decision, Document, Claim, Event, Grade, Proposal, Provenance, Question, RunResult,
                           SessionState, Star)
from tests.test_engine import engine  # noqa: F401  (fixture: fake trainer + fake LLM, temp DB)

PAYLOAD_MODELS = {
    "star.created": {"star": Star}, "star.updated": {"star": Star}, "shadow.created": {"star": Star},
    "star.graded": {"grade": Grade}, "experiment.run_done": {"run": RunResult},
    "question.asked": {"question": Question}, "question.answered": {"decision": Decision},
    "human.dispatched": {"decision": Decision}, "abstract.ready": {"abstract": Abstract},
}
LIST_MODELS = {"proposals.ready": ("proposals", Proposal), "library.search": ("hits", Provenance),
               "library.loaded": ("claims", Claim)}
REQUIRED_KEYS = {
    "session.started": {"goal", "replay"}, "agent.thinking": {"text"}, "experiment.started": {"star_id", "seeds"},
    "experiment.progress": {"star_id", "seed", "epoch", "val_acc"}, "star.failed": {"star_id", "error"},
    "feedback.received": {"star_id", "kind", "text"}, "agent.replanned": {"star_id", "because", "change"},
    "papiers.export_ready": {"path", "instructions"}, "budget.updated": {"used", "total"},
    "session.status": {"status"}, "error": {"message"}, "question.answered": {"question_id", "option_id"},
    "library.loaded": {"documents", "claims"}, "proposals.ready": {"star_id", "proposals"},
}


def validate(event: Event) -> None:
    for key, model in PAYLOAD_MODELS.get(event.type, {}).items():
        model.model_validate(event.payload[key])
    if event.type in LIST_MODELS:
        key, model = LIST_MODELS[event.type]
        for item in event.payload[key]:
            model.model_validate(item)
    if event.type == "library.loaded":
        for item in event.payload["documents"]:
            Document.model_validate(item)
    missing = REQUIRED_KEYS.get(event.type, set()) - set(event.payload)
    assert not missing, (event.type, missing)


def wait(client, sid, predicate, timeout=20):
    for _ in range(int(timeout / 0.05)):
        snapshot = client.get(f"/api/sessions/{sid}").json()
        if predicate(snapshot):
            return snapshot
        time.sleep(0.05)
    raise AssertionError(snapshot["status"])


def test_api_flow_and_every_event_matches_the_contract(engine):  # noqa: F811
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={"max_waves": 2}).json()["session_id"]
        snap = wait(client, sid, lambda s: any(p["wave"] == 1 for p in s["proposals"]))
        SessionState.model_validate(snap)
        assert snap["last_seq"] == store.last_seq(sid)
        proposals = [p for p in snap["proposals"] if p["wave"] == 1]

        assert client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": "S0", "selections": [
            {"proposal_id": proposals[1]["id"], "knob_overrides": {"tta_level": 7}}]}).status_code == 409
        assert client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": "S99", "selections": [
            {"proposal_id": proposals[1]["id"]}]}).status_code == 404
        # Human skips the agent's pick: only what the human chose runs (no shadow branch).
        ok = client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": "S0", "selections": [
            {"proposal_id": proposals[1]["id"]}], "instruction": "TTA first"})
        assert ok.json() == {"ok": True}
        snap = wait(client, sid, lambda s: len(s["stars"]) > 1 and all(x["status"] in ("done", "waiting") for x in s["stars"]))
        assert not any(x["chosen_by"] == "shadow" for x in snap["stars"])
        assert client.post(f"/api/sessions/{sid}/feedback", json={"star_id": "S1", "kind": "challenge",
                                                                   "text": "I think this is noise"}).status_code == 200
        assert client.get("/api/sessions/nope").status_code == 404

        # WS: replay from the middle, then everything after arrives exactly once and in order.
        with client.websocket_connect(f"/ws/sessions/{sid}?from_seq=3") as ws:
            first = Event.model_validate_json(ws.receive_text())
            assert first.seq == 4

        export = client.get(f"/api/sessions/{sid}/export")
        assert export.status_code == 200 and export.text.startswith("# Litmus findings")

        events = store.events_after(sid, 0)
        assert [e.seq for e in events] == list(range(1, len(events) + 1))
        for event in events:
            validate(event)
        assert "shadow.created" not in {e.type for e in events}


@pytest.mark.parametrize("path", ["/api/sessions/x/pause", "/api/sessions/x/resume"])
def test_unknown_session_is_404(engine, path):  # noqa: F811
    with TestClient(api.app) as client:
        assert client.post(path).status_code == 404


def test_replay_restreams_a_recording_with_the_replay_flag(engine, tmp_path, monkeypatch):  # noqa: F811
    from litmus import replay

    monkeypatch.setattr(replay, "MAX_GAP_SECONDS", 0.0)
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={"auto_mode": True, "max_waves": 1}).json()["session_id"]
        wait(client, sid, lambda s: s["status"] == "done")
        monkeypatch.setattr(replay, "DEMO_PATH", tmp_path / "demo.json")
        info = replay.record(sid, tmp_path / "demo.json")
        original = store.events_after(sid, 0)
        assert info["events"] == len(original)

        rid = client.get("/api/replay/demo?speed=100").json()["session_id"]
        snap = wait(client, rid, lambda s: s["status"] == "done" and s["stars"])
        assert snap["replay"] is True and snap["last_seq"] == len(original)
        replayed = store.events_after(rid, 0)
        assert [e.type for e in replayed] == [e.type for e in original]
        assert replayed[0].payload["replay"] is True and all(e.session_id == rid for e in replayed)
        with client.websocket_connect(f"/ws/sessions/{rid}?from_seq=0") as ws:
            assert Event.model_validate_json(ws.receive_text()).type == "session.started"
