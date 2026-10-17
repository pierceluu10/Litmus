"""Library intake end to end against recorded Papiers output: live stages, AI summaries, and the summary cache."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from litmus import api, library, papiers_client
from tests.test_engine import engine  # noqa: F401  (fixture: temp DB, fake trainer)

FIXTURES = Path(__file__).parent / "fixtures" / "papiers"
LISTINGS = {"document": "list_documents.json", "highlight": "list_highlights.json", "note": "list_notes.json",
            "conversation": "list_conversations.json"}


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


async def fake_cli(*args, stdin=None):
    if args[0] == "list":
        return fixture(LISTINGS[args[2]])
    if args[:2] == ("read", "@-"):
        return fixture("read_highlights.json") if stdin.startswith("hl_") else {"items": []}
    return fixture("read_document_page.json")


@pytest.fixture
def papiers(tmp_path, monkeypatch):
    calls = {"summarized": []}

    async def fake_structured(prompt_name, schema, **values):
        if schema is library.Conditions:
            return library.Conditions(conditions="200 epochs.", testbed_match="airbench trains ~10.")
        calls["summarized"].append([item["id"] for item in values["items"]])
        titles = [library.Summary(id=item["id"], summary=f"Title for {item['id'][-4:]}") for item in values["items"]]
        return library.Summaries(summaries=[*titles, library.Summary(id="hl_invented", summary="Not ours")])

    monkeypatch.setattr(papiers_client, "run_cli", fake_cli)
    monkeypatch.setattr(papiers_client, "CACHE_PATH", tmp_path / "library_cache.json")
    monkeypatch.setattr(library, "structured", fake_structured)
    monkeypatch.setattr(library, "_memory", None)
    return calls


async def test_stages_run_in_order_and_every_highlight_gets_a_summary(papiers):
    stages = []

    async def record(stage):
        stages.append(stage)
    documents, claims = await library.get_library(refresh=True, progress=record)
    assert stages == ["papers", "highlights", "notes", "summaries"]
    highlights = [c for c in claims if c.provenance[0].kind == "highlight"]
    assert highlights and all(c.summary == f"Title for {c.id[-4:]}" for c in highlights), [c.summary for c in claims]
    assert "hl_invented" not in {c.id for c in claims}
    assert all(c.conditions for c in highlights if c.page is not None)


async def test_summaries_are_reused_until_the_note_changes(papiers, monkeypatch):
    _, first = await library.get_library(refresh=True)
    await library.get_library(refresh=True)
    assert len(papiers["summarized"]) == 1, papiers["summarized"]

    edited = next(c for c in first if c.annotation)
    original_read = fixture("read_highlights.json")
    for item in original_read["items"]:
        if item["id"] == edited.id:
            item["metadata"]["annotationText"] = "A different doubt."

    async def cli_with_edit(*args, stdin=None):
        return original_read if args[:2] == ("read", "@-") and stdin.startswith("hl_") else await fake_cli(*args, stdin=stdin)
    monkeypatch.setattr(papiers_client, "run_cli", cli_with_edit)
    await library.get_library(refresh=True)
    assert papiers["summarized"][-1] == [edited.id]


def test_stream_sends_each_stage_then_the_library(engine, papiers):  # noqa: F811
    with TestClient(api.app) as client, client.stream("GET", "/api/library/stream") as response:
        events = [json.loads(line.removeprefix("data: ")) for line in response.iter_lines() if line.startswith("data: ")]
    assert [e["stage"] for e in events] == ["papers", "highlights", "notes", "summaries", "done"]
    assert all(c["summary"] for c in events[-1]["claims"] if c["provenance"][0]["kind"] == "highlight")
