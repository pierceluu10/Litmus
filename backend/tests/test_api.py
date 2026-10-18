"""API + contract conformance: every event payload validates against the contract models, WS replays from seq."""

import time

import pytest
from fastapi.testclient import TestClient

from litmus import api, store
from litmus.models import (Abstract, Decision, Document, Claim, Event, Grade, Proposal, Provenance, Question, RunResult,
                           SessionState, Star)
from tests.test_engine import engine, fake_library  # noqa: F401  (fixture: fake trainer + fake LLM, temp DB)

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
    "library.loaded": {"documents", "claims"}, "proposals.ready": {"star_id", "proposals"}, "start.chosen": {"claim_ids"},
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


def test_api_flow_and_every_event_matches_the_contract(engine, monkeypatch):  # noqa: F811
    monkeypatch.setattr(api, "get_library", fake_library)
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={"max_waves": 2}).json()["session_id"]
        snap = wait(client, sid, lambda s: s["status"] == "waiting_human")
        SessionState.model_validate(snap)
        assert snap["last_seq"] == store.last_seq(sid)
        assert client.post(f"/api/sessions/{sid}/start", json={"claim_ids": ["hl_nope"]}).status_code == 409
        assert client.post(f"/api/sessions/{sid}/start", json={"claim_ids": ["hl_tta"]}).json() == {"ok": True}

        # The agent's own card arrives once its experiment is graded.
        snap = wait(client, sid, lambda s: any(p["status"] == "open" for p in s["proposals"]))
        option = next(p for p in snap["proposals"] if p["status"] == "open")
        assert client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": option["star_id"], "selections": [
            {"proposal_id": option["id"], "knob_overrides": {"tta_level": 7}}]}).status_code == 409
        assert client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": "S99", "selections": [
            {"proposal_id": option["id"]}]}).status_code == 404
        ok = client.post(f"/api/sessions/{sid}/dispatch", json={"star_id": option["star_id"], "selections": [
            {"proposal_id": option["id"]}], "instruction": "TTA first"})
        assert ok.json() == {"ok": True}
        snap = wait(client, sid, lambda s: len(s["stars"]) > 2 and all(x["status"] in ("done", "waiting") for x in s["stars"]))
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


def test_library_import_is_served_and_survives_refresh(monkeypatch):
    from litmus import library
    monkeypatch.setattr(library, "_memory", None)
    monkeypatch.setattr(library, "_imported", False)

    async def papiers_must_not_be_read(progress):
        raise AssertionError("an imported library must not be replaced by Papiers")
    monkeypatch.setattr(library.papiers_client, "fetch_library", papiers_must_not_be_read)

    doc = {"id": "doc_u", "title": "Uploaded", "authors": [], "highlight_count": 1, "note_count": 0}
    claim = {"id": "hl_u", "text": "Mixup helps.", "doc_id": "doc_u", "doc_title": "Uploaded", "weight": 2.0, "rank": 1,
             "provenance": []}
    with TestClient(api.app) as client:
        assert client.post("/api/library/import", json={"documents": [doc], "claims": []}).status_code == 422
        assert client.post("/api/library/import", json={"documents": [doc], "claims": [claim]}).json() == {"ok": True}
        served = client.get("/api/library", params={"refresh": True}).json()
    assert [c["id"] for c in served["claims"]] == ["hl_u"]
    library.use_papiers()


def test_library_connect_validates_token_and_resumes_reading_papiers(monkeypatch):
    from litmus import library, papiers_client
    monkeypatch.setattr(papiers_client, "_token", None)
    library.use_imported([], [])
    seen = []

    async def fake_cli(*args, stdin=None):
        seen.append((papiers_client._token, args))
        if papiers_client._token == "bad":
            raise papiers_client.PapiersError("401 unauthorized")
        return {"items": []}
    monkeypatch.setattr(papiers_client, "run_cli", fake_cli)

    with TestClient(api.app) as client:
        assert client.post("/api/library/connect", json={"token": "  "}).status_code == 422
        rejected = client.post("/api/library/connect", json={"token": "bad"})
        assert rejected.status_code == 401 and papiers_client._token is None
        assert client.post("/api/library/connect", json={"token": "pap_live_x"}).json() == {"ok": True}
    assert papiers_client._token == "pap_live_x" and library._imported is False


def test_health_reports_missing_openai_key_instead_of_crashing(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setattr(api, "_health", {"at": 0.0})

    async def no_papiers():
        return False
    monkeypatch.setattr(api.papiers_client, "doctor", no_papiers)
    with TestClient(api.app) as client:
        body = client.get("/api/health").json()
    assert body["ok"] is True and body["openai_ok"] is False and body["papiers_ok"] is False
