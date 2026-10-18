"""Engine tests with a fake trainer and fake LLM: the real LangGraph, store, grader, and driver run end to end."""

import asyncio
import random

import pytest

from litmus import library, store
from litmus.engine import agent, driver, graph, ops
from litmus.experiments import service
from litmus.experiments.knobs import BASELINE_KNOBS
from litmus.models import ChatTurn, Claim, Document, Provenance, Star


# ---------------------------------------------------------------- pure logic

def make_star(sid, parent, **changes):
    return Star(id=sid, parent_id=parent, depth=0, title=sid, hypothesis="", knobs={**BASELINE_KNOBS, **changes},
                knob_changes=changes, provenance=[], chosen_by="human")


def test_comparison_isolates_the_method_at_the_child_epoch_count():
    root = make_star("S0", None)
    mixup_long = make_star("S1", "S0", mixup_alpha=0.2, epochs=20)
    assert ops.comparison_knobs(mixup_long, root) == {**BASELINE_KNOBS, "epochs": 20.0}
    longer_only = make_star("S2", "S0", epochs=20)
    assert ops.comparison_knobs(longer_only, root) == root.knobs.model_dump()  # never compare a star with itself


def test_agents_that_share_a_name_get_letters_in_start_order():
    state = driver.SessionState(id="s", goal="g", budget_total=1, stars=[
        make_star("S0", None), make_star("S1", "S0", mixup_alpha=1.0), make_star("S2", "S0", tta_level=0),
        make_star("S3", "S0", mixup_alpha=0.2, epochs=20)])
    assert [agent.agent_name(state, s) for s in state.stars] == ["Baseline", "Mixup agent A", "TTA agent", "Mixup agent B"]


# ---------------------------------------------------------------- integration fixtures

CLAIMS = [
    Claim(id="hl_mixup", text="mixup significantly outperforms ERM on CIFAR-10", doc_id="doc_m", doc_title="mixup",
          annotation="200 epochs here. Does it hold at 10?", weight=3, rank=1,
          provenance=[Provenance(kind="highlight", id="hl_mixup", doc_id="doc_m", doc_title="mixup", text="mixup wins")]),
    Claim(id="hl_tta", text="more crops improve performance", doc_id="doc_a", doc_title="airbench", weight=2, rank=2,
          provenance=[Provenance(kind="highlight", id="hl_tta", doc_id="doc_a", doc_title="airbench", text="TTA helps")]),
    Claim(id="hl_mix_strong", text="alpha=1 works best", doc_id="doc_m", doc_title="mixup", weight=2, rank=3,
          provenance=[Provenance(kind="highlight", id="hl_mix_strong", doc_id="doc_m", doc_title="mixup", text="alpha 1")]),
]
EFFECTS = {"mixup_alpha": -0.004, "tta_level": -0.008}  # fake ground truth, accuracy fraction per changed knob


async def fake_stream_runs(knobs, seeds):
    for seed in seeds:
        await asyncio.sleep(0.01)
        acc = 0.94 + sum(v for k, v in EFFECTS.items() if knobs[k] != BASELINE_KNOBS[k])
        acc += 0.002 * (knobs["epochs"] > 15) + random.Random(seed).gauss(0, 0.0005)
        yield {"type": "progress", "seed": seed, "epoch": 1, "train_acc": 0.5, "val_acc": acc - 0.01}
        yield {"type": "run", "seed": seed, "val_acc": acc - 0.005, "tta_val_acc": acc, "time_seconds": 4.2}


def draft(title, parent, predicted, claim_ids=(), agenda_ids=(), **changes):
    return agent.ProposalDraft(title=title, hypothesis=title, predicted=predicted, parent_star_id=parent,
                               knob_changes=agent.KnobChanges(**changes), condition_notes="", claim_ids=list(claim_ids),
                               agenda_ids=list(agenda_ids))


async def fake_structured(prompt_name, schema, **values):
    if prompt_name == "propose":  # Litmus drafting the first tests from the claims the human chose
        PROPOSE_PROMPTS.append(values)
        return agent.ProposalSet(thinking="Testing your doubts.", proposals=[
            draft("Bad", "S9", "improves", ["hl_tta"], cutout=4),  # unknown parent: must be dropped
            draft("Mixup", "S0", "improves", ["hl_mixup"], mixup_alpha=0.2),
            draft("No TTA", "S0", "hurts", ["hl_tta"], tta_level=0),
            draft("Mixup strong", "S0", "improves", ["hl_mix_strong"], mixup_alpha=1.0),
        ])
    if prompt_name == "suggest":  # each agent's own next steps; a human answer about its star must be implemented
        SUGGEST_PROMPTS.append(values)
        star, agenda = values["star"], [a["id"] for a in values["agenda"]] if values["agenda"] != "(empty)" else []
        options = {"Mixup": [draft("Mixup + longer", "S0", "improves", ["hl_mixup"], agenda, mixup_alpha=0.2, epochs=20),
                             draft("Cutout", "S0", "improves", ["hl_tta"], cutout=8),
                             draft("No TTA", "S0", "hurts", ["hl_tta"], tta_level=0)]}
        return agent.AgentSuggestions(take=f"{values['agent']} would go on.", proposals=options.get(
            star["title"], [draft("Stronger cutout", star["id"], "improves", ["hl_tta"], agenda, cutout=12)]))
    if prompt_name == "reflect":
        return agent.Reflection(reflection="Measured.", surprising=False, action="accept", reason="clear", search_query=None)
    if prompt_name == "detect_conflict":
        return agent.ConflictCheck(
            explanation="Bag of Tricks says mixup needs more epochs.", cited_hit_ids=["hl_bot"], conflict=True,
            question="Test mixup with longer training, or drop it?", agent_leaning_index=1, follow_up=None,
            options=[agent.OptionDraft(label="Longer training", consequence="run mixup at 20 epochs",
                                       directive="Test mixup at 20 epochs vs baseline at 20", parent_star_id="S0",
                                       knob_changes=agent.KnobChanges(mixup_alpha=0.2, epochs=20)),
                     agent.OptionDraft(label="Drop mixup", consequence="stop", directive="Drop mixup",
                                       parent_star_id=None, knob_changes=None)])
    if prompt_name == "write_abstract":
        return agent.AbstractDraft(text="Mixup failed at 10 epochs [S1][hl_mixup][bogus_id].", findings=["S1 refuted [S1]"])
    if prompt_name == "chat_star":
        CHAT_PROMPTS.append(values)
        return agent.Explanation(answer="Five paired seeds against the baseline.", cited_ids=["hl_bot", "hl_invented"])
    raise AssertionError(prompt_name)


CHAT_PROMPTS: list[dict] = []
PROPOSE_PROMPTS: list[dict] = []
SUGGEST_PROMPTS: list[dict] = []


SEARCHES: list[str] = []


async def fake_search(query, limit=6):
    SEARCHES.append(query)
    return [Provenance(kind="highlight", id="hl_bot", doc_id="doc_b", doc_title="Bag of Tricks", text="increase epochs")]


async def fake_library(refresh=False):
    return [Document(id="doc_m", title="mixup")], CLAIMS


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "litmus.sqlite")
    monkeypatch.setattr(store, "_db", None)
    monkeypatch.setattr(store, "_sessions", {})
    monkeypatch.setattr(driver, "CHECKPOINT_PATH", tmp_path / "checkpoints.sqlite")
    monkeypatch.setattr(service, "stream_runs", fake_stream_runs)
    monkeypatch.setattr(agent, "structured", fake_structured)
    monkeypatch.setattr(graph.papiers_client, "search", fake_search)

    async def no_write():
        return False
    monkeypatch.setattr(graph.papiers_client, "supports_write", no_write)
    monkeypatch.setattr(library, "get_library", fake_library)  # graph and api read it through session_library
    monkeypatch.setattr(graph.writeback, "EXPORTS_DIR", tmp_path / "exports")


async def wait_for(session_id, predicate, timeout=20):
    for _ in range(int(timeout / 0.05)):
        if predicate(store.get(session_id)):
            return store.get(session_id)
        await asyncio.sleep(0.05)
    events = [(e.type, e.payload.get("message") or e.payload.get("text")) for e in store.events_after(session_id, 0)]
    raise AssertionError(f"timed out; last events: {events[-15:]}")


async def test_session_starts_from_one_claim_and_agents_suggest_their_own_next_steps(engine):
    await driver.startup()
    try:
        state = driver.create_session(None, 1800, auto_mode=False, auto_timeout_seconds=None, max_waves=3)
        sid = state.id
        state = await wait_for(sid, lambda s: s.status == "waiting_human" and s.stars[0].status == "done")
        assert state.wave == 0 and not state.proposals, "nothing runs until the human says where to start"
        known = {c.id for c in CLAIMS}
        for bad in (["hl_nope"], ["hl_mixup", "hl_tta"], []):
            with pytest.raises(driver.ActionError):
                driver.start(sid, bad, known)

        # "Where should we start?" → one claim, so Litmus drafts one plain test and it runs at once.
        PROPOSE_PROMPTS.clear()
        SUGGEST_PROMPTS.clear()
        driver.start(sid, ["hl_mixup"], known)
        state = await wait_for(sid, lambda s: any(x.wave == 1 for x in s.stars))
        assert [x.title for x in state.stars if x.wave == 1] == ["Mixup"]  # invalid parent dropped, capped at one
        assert [c["id"] for c in PROPOSE_PROMPTS[0]["claims"]] == ["hl_mixup"] and PROPOSE_PROMPTS[0]["slots"] == "1"

        # Mixup is refuted: its agent asks; the human overrides its leaning, and its own card must implement the answer.
        state = await wait_for(sid, lambda s: any(q.status == "open" for q in s.questions))
        q = state.questions[0]
        mixup = ops.star(state, q.star_id)
        assert mixup.grade.verdict == "refuted" and mixup.status == "waiting" and q.agent_leaning == "O2"
        driver.answer(sid, q.id, "O1", "BoT says so")
        state = await wait_for(sid, lambda s: any(p.star_id == mixup.id for p in s.proposals))
        answer_decision = next(d for d in state.decisions if d.kind == "answer")
        assert answer_decision.changed_trajectory and answer_decision.agent_recommendation == "Drop mixup"
        card = [p for p in state.proposals if p.star_id == mixup.id]
        assert any(x.kind == "human" for x in card[0].provenance) and mixup.id == state.stars[1].id
        assert ops.star(state, mixup.id).suggestion == "Mixup agent would go on."

        # Two picks from one card run as wave 2; each new agent reads the other.
        picks = [p for p in card if p.title in ("Cutout", "No TTA")]
        driver.dispatch(sid, mixup.id, [{"proposal_id": p.id} for p in picks], None)
        state = store.get(sid)
        assert next(p for p in state.proposals if p.title == "Mixup + longer").status == "skipped"
        wave2 = [x for x in state.stars if x.wave == 2]
        assert {x.title for x in wave2} == {"Cutout", "No TTA"}

        # A pick from the first wave-2 card queues for wave 3, whatever the other agent is doing.
        state = await wait_for(sid, lambda s: any(p.status == "open" and p.star_id in {x.id for x in wave2} for p in s.proposals))
        option = next(p for p in state.proposals if p.status == "open" and p.star_id in {x.id for x in wave2})
        driver.dispatch(sid, option.star_id, [{"proposal_id": option.id}], None)
        queued = next(x for x in store.get(sid).stars if x.proposal_id == option.id)
        assert queued.wave == 3 and queued.parent_id == option.star_id
        state = await wait_for(sid, lambda s: {v["star"]["id"] for v in SUGGEST_PROMPTS} >= {x.id for x in wave2})
        for v in (v for v in SUGGEST_PROMPTS if v["star"]["id"] in {x.id for x in wave2}):
            assert {x["id"] for x in v["siblings"]} == {x.id for x in wave2} - {v["star"]["id"]}, "agents read each other"

        # The last wave runs; finishing closes every card and refuses new work.
        state = await wait_for(sid, lambda s: s.status == "done")
        assert ops.star(state, queued.id).grade is not None
        assert all(p.status != "open" for p in state.proposals), "finishing closes every agent's card"
        with pytest.raises(driver.ActionError):
            driver.dispatch(sid, mixup.id, [{"proposal_id": card[0].id}], None)
        assert not any(s.chosen_by == "shadow" for s in state.stars)
        assert "[bogus_id]" not in state.abstract.text and "[S1]" in state.abstract.text

        events = store.events_after(sid, 0)
        assert [e.seq for e in events] == list(range(1, len(events) + 1))
        assert {"start.chosen", "question.asked", "question.answered", "library.search", "abstract.ready",
                "papiers.export_ready"} <= {e.type for e in events}
    finally:
        await driver.shutdown()


async def test_pivot_to_an_untested_claim_runs_it_as_a_new_agent(engine):
    await driver.startup()
    try:
        state = driver.create_session(None, 1800, auto_mode=False, auto_timeout_seconds=None, max_waves=2)
        sid = state.id
        await wait_for(sid, lambda s: s.status == "waiting_human" and s.stars[0].status == "done")
        tta = next(c for c in CLAIMS if c.id == "hl_tta")
        with pytest.raises(driver.ActionError):
            driver.pivot(sid, tta)  # nothing to pivot from before the start
        driver.start(sid, ["hl_mixup"], {c.id for c in CLAIMS})
        state = await wait_for(sid, lambda s: any(q.status == "open" for q in s.questions))
        with pytest.raises(driver.ActionError):
            driver.pivot(sid, CLAIMS[0])  # mixup is already on the tree

        # Mid-wave, the pivot queues for the next wave: a new agent from the baseline, testing the new claim.
        driver.pivot(sid, tta)
        state = await wait_for(sid, lambda s: any(p.id == "hl_tta" for x in s.stars for p in x.provenance))
        pivoted = next(x for x in state.stars if any(p.id == "hl_tta" for p in x.provenance))
        assert pivoted.parent_id == "S0" and pivoted.wave == 2 and pivoted.status == "queued"

        driver.answer(sid, state.questions[0].id, "O2", None)
        state = await wait_for(sid, lambda s: s.status == "done")
        assert ops.star(state, pivoted.id).grade is not None
    finally:
        await driver.shutdown()


async def test_chat_about_a_star_carries_history_and_searches_the_library_once(engine):
    await driver.startup()
    try:
        state = driver.create_session(None, 1800, auto_mode=True, auto_timeout_seconds=None, max_waves=1)
        state = await wait_for(state.id, lambda s: s.status == "done", timeout=30)
        star = next(s for s in state.stars if s.parent_id)
        SEARCHES.clear()
        CHAT_PROMPTS.clear()
        answer, cited = await driver.explain(state.id, star.id, "What did you run?", [])
        history = [ChatTurn(role="human", text="What did you run?"), ChatTurn(role="litmus", text=answer)]
        await driver.explain(state.id, star.id, "Is that enough seeds?", history)
        assert [p.id for p in cited] == ["hl_bot"], "ids the model invents must be dropped"
        assert SEARCHES == [star.title], "the library is searched once per star, then reused"
        assert CHAT_PROMPTS[0]["history"] == "(this is the first message)"
        assert "Human: What did you run?\nLitmus: Five paired seeds" in CHAT_PROMPTS[1]["history"]
        assert CHAT_PROMPTS[1]["question"] == "Is that enough seeds?"
    finally:
        await driver.shutdown()


async def test_long_training_child_reruns_parent_at_same_epochs(engine):
    await driver.startup()
    try:
        state = driver.create_session(None, 1800, auto_mode=True, auto_timeout_seconds=None, max_waves=2)
        state = await wait_for(state.id, lambda s: s.status == "done", timeout=30)
        longer = next(s for s in state.stars if s.title == "Mixup + longer")
        # Parent runs are the baseline at 20 epochs (fake +0.002 for long training), not the 9.9-epoch baseline.
        assert all(r.tta_val_acc > 0.9405 for r in longer.parent_runs)
        assert longer.grade.delta == pytest.approx(-0.004, abs=0.001)
    finally:
        await driver.shutdown()


async def test_concurrent_requests_for_the_same_star_train_once(engine, monkeypatch):
    calls = []

    async def counting_stream(knobs, seeds):
        calls.append(tuple(seeds))
        async for event in fake_stream_runs(knobs, seeds):
            yield event

    monkeypatch.setattr(service, "stream_runs", counting_stream)
    state = driver.SessionState(id="ses_x", goal="g", budget_total=1000)
    store.create_session(state, {"auto_mode": False, "max_waves": 1})
    root = ops.new_star(state, parent=None, title="root", hypothesis="", knobs=ops.baseline_knobs(), knob_changes={},
                        provenance=[], chosen_by="agent", predicted=None)
    first, second = await asyncio.gather(ops.run_star("ses_x", root.id), ops.run_star("ses_x", root.id))
    assert calls == [(0, 1, 2, 3, 4)] and first.grade and len(first.runs) == 5
    assert len([e for e in store.events_after("ses_x", 0) if e.type == "experiment.run_done"]) == 5
