"""API + contract conformance: every event payload validates against the contract models, WS replays from seq."""

import time

import pytest
from fastapi.testclient import TestClient

from litmus import api, store
from litmus.models import (Abstract, Decision, Document, Claim, Event, Grade, Proposal, Provenance, Question, RunResult,
                           SessionState, Star)
from tests.test_engine import CLAIMS, engine, fake_library  # noqa: F401  (fixture: fake trainer + fake LLM, temp DB)

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


def test_connect_keeps_a_good_token_in_memory_and_rejects_a_bad_one(engine, monkeypatch):  # noqa: F811
    from litmus import papiers_client
    monkeypatch.setattr(papiers_client, "_token", None)
    tried: list[str | None] = []

    async def fake_cli(*args, stdin=None, token=None):
        tried.append(token)
        if token == "pap_down":
            raise papiers_client.PapiersUnavailable("papiers list timed out after 30s")
        if token != "pap_live_good":
            raise papiers_client.PapiersError("papiers list exited 1: 401 auth_invalid")
        return {"items": []}
    monkeypatch.setattr(papiers_client, "run_cli", fake_cli)
    with TestClient(api.app) as client:
        bad = client.post("/api/library/connect", json={"token": "pap_live_bad"})
        assert bad.status_code == 401 and "pap_live_bad" not in bad.text
        assert papiers_client._token is None
        assert client.post("/api/library/connect", json={"token": "pap_down"}).status_code == 503
        assert client.post("/api/library/connect", json={"token": ""}).status_code == 422
        assert client.post("/api/library/connect", json={"token": " pap_live_good "}).json() == {}
    assert tried == ["pap_live_bad", "pap_down", "pap_live_good"]
    assert papiers_client._env(None)["PAPIERS_TOKEN"] == "pap_live_good"


def test_an_imported_library_is_what_the_next_session_works_from(engine, monkeypatch):  # noqa: F811
    monkeypatch.setattr(api, "_imported", None)
    only_tta = next(c for c in CLAIMS if c.id == "hl_tta")
    with TestClient(api.app) as client:
        assert client.post("/api/library/import", json={"documents": [], "claims": []}).status_code == 422
        body = {"documents": [Document(id="doc_a", title="airbench").model_dump()], "claims": [only_tta.model_dump()]}
        assert client.post("/api/library/import", json=body).json() == {"claims": 1}
        sid = client.post("/api/sessions", json={}).json()["session_id"]
        snap = wait(client, sid, lambda s: s["status"] == "waiting_human")
        assert [c["id"] for c in snap["library"]["claims"]] == ["hl_tta"]
        loaded = next(e for e in store.events_after(sid, 0) if e.type == "library.loaded")
        assert [c["id"] for c in loaded.payload["claims"]] == ["hl_tta"]
        # a claim outside the imported library cannot start this session; one inside can
        assert client.post(f"/api/sessions/{sid}/start", json={"claim_ids": ["hl_mixup"]}).status_code == 409
        assert client.post(f"/api/sessions/{sid}/start", json={"claim_ids": ["hl_tta"]}).json() == {"ok": True}
        # the import is used once: the next session reads the whole library again
        other = client.post("/api/sessions", json={}).json()["session_id"]
        assert wait(client, other, lambda s: s["status"] == "waiting_human")["library"] is None


def test_chat_about_the_whole_research_and_generated_questions(engine, monkeypatch):  # noqa: F811
    monkeypatch.setattr(api, "_imported", None)
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={}).json()["session_id"]
        wait(client, sid, lambda s: s["status"] == "waiting_human")
        whole = client.post(f"/api/sessions/{sid}/explain", json={"question": "Where are we?"}).json()
        assert whole["answer"].startswith("Across agents")
        assert [p["id"] for p in whole["provenance"]] == ["hl_mixup"]  # invented ids are dropped
        got = client.post(f"/api/sessions/{sid}/questions", json={"asked": ["What next?"]}).json()["questions"]
        # case-insensitive duplicates, blanks, over-long ones and already-asked ones are dropped; at most three
        assert got == ["Why did mixup lose?", "Which is solid?", "One too many?"]
        assert client.post(f"/api/sessions/{sid}/questions", json={"star_id": "S99"}).status_code == 404
