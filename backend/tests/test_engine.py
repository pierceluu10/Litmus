"""Engine tests with a fake trainer and fake LLM: the real LangGraph, store, grader, and driver run end to end."""

import asyncio
import random

import pytest

from litmus import store
from litmus.engine import agent, driver, graph, ops
from litmus.experiments import service
from litmus.experiments.knobs import BASELINE_KNOBS
from litmus.models import Claim, Document, Provenance, Star


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


# ---------------------------------------------------------------- integration fixtures

CLAIMS = [
    Claim(id="hl_mixup", text="mixup significantly outperforms ERM on CIFAR-10", doc_id="doc_m", doc_title="mixup",
          annotation="200 epochs here. Does it hold at 10?", weight=3, rank=1,
          provenance=[Provenance(kind="highlight", id="hl_mixup", doc_id="doc_m", doc_title="mixup", text="mixup wins")]),
    Claim(id="hl_tta", text="more crops improve performance", doc_id="doc_a", doc_title="airbench", weight=2, rank=2,
          provenance=[Provenance(kind="highlight", id="hl_tta", doc_id="doc_a", doc_title="airbench", text="TTA helps")]),
]
EFFECTS = {"mixup_alpha": -0.004, "tta_level": -0.008}  # fake ground truth, accuracy fraction per changed knob


async def fake_stream_runs(knobs, seeds):
    for seed in seeds:
        await asyncio.sleep(0.01)
        acc = 0.94 + sum(v for k, v in EFFECTS.items() if knobs[k] != BASELINE_KNOBS[k])
        acc += 0.002 * (knobs["epochs"] > 15) + random.Random(seed).gauss(0, 0.0005)
        yield {"type": "progress", "seed": seed, "epoch": 1, "train_acc": 0.5, "val_acc": acc - 0.01}
        yield {"type": "run", "seed": seed, "val_acc": acc - 0.005, "tta_val_acc": acc, "time_seconds": 4.2}


def draft(title, parent, predicted, claim_ids=(), agenda_ids=(), recommended=False, **changes):
    return agent.ProposalDraft(title=title, hypothesis=title, predicted=predicted, parent_star_id=parent,
                               knob_changes=agent.KnobChanges(**changes), condition_notes="", claim_ids=list(claim_ids),
                               agenda_ids=list(agenda_ids), agent_recommended=recommended)


async def fake_structured(prompt_name, schema, **values):
    state = next(store.get(s["id"]) for s in store.list_sessions())
    if prompt_name == "propose":
        if state.wave == 1:
            return agent.ProposalSet(thinking="Testing your doubts.", recommendation_reason="biggest doubt", proposals=[
                draft("Mixup", "S0", "improves", ["hl_mixup"], recommended=True, mixup_alpha=0.2),
                draft("No TTA", "S0", "hurts", ["hl_tta"], tta_level=0),
                draft("Mixup strong", "S0", "improves", ["hl_mixup"], mixup_alpha=1.0),
                draft("Bad", "S9", "improves", ["hl_tta"], cutout=4),  # unknown parent: must be dropped
            ])
        agenda = [a.id for a in state.agenda if a.source == "answer"]
        return agent.ProposalSet(thinking="Following your answer.", recommendation_reason="you asked", proposals=[
            draft("Mixup + longer", "S0", "improves", ["hl_mixup"], agenda, recommended=True, mixup_alpha=0.2, epochs=20),
            draft("Cutout", "S0", "improves", ["hl_tta"], cutout=8),
        ])
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
    raise AssertionError(prompt_name)


async def fake_search(query, limit=6):
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
    monkeypatch.setattr(graph, "get_library", fake_library)
    monkeypatch.setattr(graph.writeback, "EXPORTS_DIR", tmp_path / "exports")


async def wait_for(session_id, predicate, timeout=20):
    for _ in range(int(timeout / 0.05)):
        if predicate(store.get(session_id)):
            return store.get(session_id)
        await asyncio.sleep(0.05)
    events = [(e.type, e.payload.get("message") or e.payload.get("text")) for e in store.events_after(session_id, 0)]
    raise AssertionError(f"timed out; last events: {events[-15:]}")


async def test_full_session_with_question_mid_branch(engine):
    await driver.startup()
    try:
        state = driver.create_session(None, 1800, auto_mode=False, auto_timeout_seconds=None, max_waves=2)
        sid = state.id
        state = await wait_for(sid, lambda s: any(p.wave == 1 for p in s.proposals))
        wave1 = [p for p in state.proposals if p.wave == 1]
        assert [p.title for p in wave1] == ["Mixup", "No TTA", "Mixup strong"]  # invalid parent dropped
        assert sum(p.agent_recommended for p in wave1) == 1
        assert state.status == "waiting_human"

        # Human skips the agent's pick (Mixup)? No: picks both, so no shadow. Then a question arrives mid-branch.
        everything = [{"proposal_id": p.id} for p in wave1]
        driver.dispatch(sid, "S0", everything, "focus on doubts")
        driver.dispatch(sid, "S0", everything, None)  # idempotent
        state = await wait_for(sid, lambda s: any(q.status == "open" for q in s.questions))
        assert len([s for s in state.stars if s.wave == 1]) == 3
        state = await wait_for(sid, lambda s: all(x.status in ("done", "waiting") for x in s.stars))
        assert len(state.questions) == 1  # two refuted mixup branches raced; only one may ask per wave
        q = state.questions[0]
        mixup = ops.star(state, q.star_id)
        assert mixup.grade.verdict == "refuted" and mixup.status == "waiting"
        other = next(s for s in state.stars if s.title.startswith("Mixup") and s.id != mixup.id)
        state = await wait_for(sid, lambda s: any(a.star_id == other.id for a in s.agenda))  # its idea is kept, not asked
        assert q.star_id == mixup.id and q.agent_leaning == "O2" and any(e.id == "hl_bot" for e in q.evidence)

        # The other branch kept running and finished while the mixup line waited.
        state = await wait_for(sid, lambda s: next(x for x in s.stars if x.title == "No TTA").status == "done")
        assert next(x for x in state.stars if x.title == "No TTA").grade.verdict == "confirmed"

        # Human overrides the agent's leaning: the next wave must implement the answer.
        driver.answer(sid, q.id, "O1", "BoT says so")
        state = await wait_for(sid, lambda s: any(p.wave == 2 for p in s.proposals))
        answer_decision = next(d for d in state.decisions if d.kind == "answer")
        assert answer_decision.changed_trajectory and answer_decision.agent_recommendation == "Drop mixup"
        wave2 = [p for p in state.proposals if p.wave == 2]
        longer = next(p for p in wave2 if p.title == "Mixup + longer")
        assert any(p.kind == "human" for p in longer.provenance)

        # Human skips the agent's pick (Mixup + longer is recommended) → shadow branch runs the agent's choice.
        cutout = next(p for p in wave2 if p.title == "Cutout")
        driver.dispatch(sid, "S0", [{"proposal_id": cutout.id}], None)
        state = await wait_for(sid, lambda s: s.status == "done")
        shadow = next(s for s in state.stars if s.chosen_by == "shadow")
        assert shadow.title == "Mixup + longer"
        dispatch2 = [d for d in state.decisions if d.kind == "dispatch"][-1]
        assert dispatch2.changed_trajectory and shadow.shadow_of == dispatch2.id
        assert "[bogus_id]" not in state.abstract.text and "[S1]" in state.abstract.text
        assert {c.id for c in state.abstract.citations} == {"hl_mixup"}

        # Snapshot and event log agree; seqs are gapless.
        events = store.events_after(sid, 0)
        assert [e.seq for e in events] == list(range(1, len(events) + 1))
        assert {"question.asked", "question.answered", "library.search", "shadow.created", "abstract.ready",
                "papiers.export_ready", "agent.replanned"} <= {e.type for e in events}
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
