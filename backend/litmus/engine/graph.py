"""The LangGraph research loop.

    intake → baseline → propose → select ⟂ → Send(branch) ×N → join → propose | abstract → END
    branch: run → reflect → (run with 5 more seeds) | (ask ⟂) | END

⟂ = interrupt(). Interrupts resume with values the driver derives from the session snapshot (the API records
the human's action first), so every node is safe to re-run after a restart: runs come from the result cache and
decisions are already on the snapshot.
"""

import logging
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send, interrupt

from litmus import grader, papiers_client, store, writeback
from litmus.engine import agent, ops
from litmus.experiments.knobs import DEFAULT_SEEDS, EXTRA_SEEDS
from litmus.experiments.service import estimate_gpu_seconds
from litmus.library import get_library
from litmus.llm import LLMError
from litmus.models import Abstract, Proposal, Provenance, QuestionOption

log = logging.getLogger(__name__)

MAX_WAVES = 3
MAX_STARS = 12
MAX_BRANCHES = 4


class EngineState(TypedDict):
    session_id: str
    wave_star_ids: list[str]
    done_branches: Annotated[list[str], operator.add]


class BranchState(TypedDict, total=False):
    session_id: str
    star_id: str
    extra_seeds: bool
    next: str
    question_id: str


def session_config(session_id: str) -> dict:
    return store.config(session_id)


def research_stars(state) -> list:
    return [s for s in state.stars if s.chosen_by != "shadow"]


# ---------------------------------------------------------------- main loop nodes

async def intake(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    ops.think(state, "Reading your Papiers library: highlights, your notes on them, and conversations.")
    documents, claims = await get_library()
    store.emit(state.id, "library.loaded", {"documents": [d.model_dump() for d in documents],
                                            "claims": [c.model_dump() for c in claims]})
    annotated = [c for c in claims if c.annotation]
    ops.think(state, f"Found {len(claims)} claims across {len(documents)} papers. {len(annotated)} carry your own "
                     f"notes, so I'll test those doubts first.")
    return {}


async def baseline(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    if not state.stars:
        ops.think(state, "Running the baseline: airbench94 exactly as published, on 5 seeds.")
        ops.new_star(state, parent=None, title="Baseline (airbench94)",
                     hypothesis="airbench94's published configuration reaches about 94% on CIFAR-10.",
                     knobs=ops.baseline_knobs(), knob_changes={}, chosen_by="agent", predicted=None,
                     provenance=[Provenance(kind="human", id="testbed",
                                            text="Testbed: airbench94 with its paper defaults (label smoothing 0.2, "
                                                 "alternating flip, 2px translate, whitening, TTA level 2, 9.9 epochs).")])
    root = state.stars[0]
    if root.status != "done":
        root = await ops.run_star(state.id, root.id, DEFAULT_SEEDS)
    if root.status == "failed":
        store.emit(state.id, "error", {"message": f"Baseline failed: {root.error}"})
        state.finish_requested = True
    return {}


async def propose(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    if state.finish_requested:
        return {}
    current = [p for p in state.proposals if p.wave == state.wave]
    if current and all(p.status == "open" for p in current):
        return {}  # re-run after a restart: these proposals are still waiting for the human
    await ops.gate(state.id).wait()
    state.wave += 1
    anchor = ops.best_star(state)
    ops.think(state, f"Wave {state.wave}: choosing what to test next from your highlights and the results so far.",
              anchor.id)
    slots = min(MAX_BRANCHES, MAX_STARS - len(research_stars(state)))
    _, claims = await get_library()
    instruction = next((d.note for d in reversed(state.decisions) if "Instruction:" in d.note), None)
    try:
        proposals, thinking = await agent.propose(state, claims, instruction, session_config(state.id)["max_waves"], slots)
    except (agent.ProposalError, LLMError) as error:
        log.warning("propose failed: %s", error)
        proposals, thinking = _fallback_proposals(state), "I couldn't draft new proposals, so I'm re-offering the strongest ones you skipped earlier."
        if not proposals:
            store.emit(state.id, "error", {"message": f"Could not propose a next wave: {error}"})
            state.finish_requested = True
            store.save(state)
            return {}
    state.proposals.extend(proposals)
    for item in state.agenda:
        item.consumed = True
    ops.think(state, thinking, anchor.id)
    ops.proposals_ready(state, anchor.id)
    return {}


def _fallback_proposals(state) -> list[Proposal]:
    """The agent's previous proposal set: skipped proposals whose configs were never run, re-offered this wave."""
    out = []
    for p in state.proposals:
        if p.status != "skipped":
            continue
        parent = ops.star(state, p.parent_star_id or p.star_id)
        knobs = {**parent.knobs.model_dump(), **p.knob_changes}
        if ops.existing_config(state, knobs) or len(out) == MAX_BRANCHES:
            continue
        out.append(p.model_copy(update={"id": f"P{len(state.proposals) + len(out) + 1}", "status": "open",
                                        "wave": state.wave, "agent_recommended": not out}))
    return out


async def select(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    wave_stars = [s.id for s in state.stars if s.wave == state.wave and s.chosen_by in ("human", "auto")]
    if state.finish_requested or wave_stars:
        return {"wave_star_ids": [] if state.finish_requested and not wave_stars else wave_stars}
    if session_config(state.id)["auto_mode"]:
        wave = [p for p in state.proposals if p.wave == state.wave and p.status == "open"][:MAX_BRANCHES]
        ops.think(state, f"Auto mode: no human in the loop, so I'm running all {len(wave)} proposals.")
        return {"wave_star_ids": [s.id for s in ops.dispatch(state, [{"proposal_id": p.id} for p in wave], "auto")]}
    value = interrupt({"kind": "selection", "wave": state.wave})
    return {"wave_star_ids": value.get("star_ids", [])}


def fan_out(es: EngineState):
    if not es["wave_star_ids"]:
        return "join"
    return [Send("branch", {"session_id": es["session_id"], "star_id": sid}) for sid in es["wave_star_ids"]]


async def join(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    wave = [s for s in state.stars if s.wave == state.wave and s.chosen_by != "shadow" and s.grade]
    if wave:
        verdicts = ", ".join(f"{s.id} {s.grade.verdict}" for s in wave)
        ops.think(state, f"Wave {state.wave} finished: {verdicts}.")
    ops.refresh_status(state)
    return {}


def after_join(es: EngineState) -> str:
    state = store.get(es["session_id"])
    max_waves = session_config(state.id)["max_waves"]
    if state.finish_requested or state.wave >= max_waves or len(research_stars(state)) >= MAX_STARS:
        return "abstract"
    if ops.budget_left(state) < 2 * estimate_gpu_seconds(ops.baseline_knobs(), len(DEFAULT_SEEDS)):
        store.emit(state.id, "error", {"message": "GPU budget exhausted: writing up what we have."})
        return "abstract"
    return "propose"


def after_baseline(es: EngineState) -> str:
    return "abstract" if store.get(es["session_id"]).finish_requested else "propose"


async def abstract(es: EngineState) -> dict:
    state = store.get(es["session_id"])
    if state.abstract is None:
        ops.think(state, "Writing up what we learned, citing every star and highlight it rests on.")
        try:
            text, findings, citations = await agent.write_abstract(state)
        except LLMError as error:
            log.warning("abstract failed: %s", error)
            text, findings, citations = (f"(The abstract agent failed: {error}. The findings below are generated "
                                         f"directly from the graded stars.)"), [], []
        state.abstract = Abstract(text=text, findings=findings, citations=citations)
        ops.emit(state, "abstract.ready", {"abstract": state.abstract.model_dump()})
    path = writeback.export(state)
    if await papiers_client.supports_write():
        log.warning("Papiers CLI now has write commands; Litmus still exports (update writeback.py)")
    store.emit(state.id, "papiers.export_ready", {"path": path, "instructions": writeback.INSTRUCTIONS})
    ops.set_status(state, "done")
    return {}


# ---------------------------------------------------------------- branch subgraph

async def run(bs: BranchState) -> dict:
    state = store.get(bs["session_id"])
    s = ops.star(state, bs["star_id"])
    if bs.get("extra_seeds"):
        if not s.grade or s.grade.n < len(DEFAULT_SEEDS) + len(EXTRA_SEEDS):
            await ops.run_star(state.id, s.id, EXTRA_SEEDS)
    elif s.status != "done":
        await ops.run_star(state.id, s.id, DEFAULT_SEEDS)
    return {}


def _conditions(claims, s) -> str:
    by_id = {c.id: c for c in claims}
    return " ".join(by_id[p.id].conditions for p in s.provenance if p.id in by_id and by_id[p.id].conditions)


async def reflect(bs: BranchState) -> dict:
    state = store.get(bs["session_id"])
    s = ops.star(state, bs["star_id"])
    if s.status != "done" or not s.grade:
        return {"next": "end"}
    if s.reflection and not bs.get("extra_seeds"):
        return {"next": "end"}  # already reflected before a restart
    ops.think(state, f"Interpreting {s.id}: {s.grade.verdict}, delta {agent.points(s.grade.delta):+.2f} points.", s.id)
    _, claims = await get_library()
    try:
        r = await agent.reflect(state, s, _conditions(claims, s), ops.budget_left(state))
    except LLMError as error:
        log.warning("reflect failed: %s", error)
        s.reflection = f"Verdict {s.grade.verdict} (the reflection agent was unavailable: {error})."
        ops.update_star(state, s)
        return {"next": "end"}

    inconclusive = s.grade.verdict == "inconclusive"
    can_add_seeds = (inconclusive and s.grade.n < agent.MAX_SEEDS and not bs.get("extra_seeds")
                     and ops.budget_left(state) > 2 * estimate_gpu_seconds(s.knobs.model_dump(), len(EXTRA_SEEDS)))
    action = r.action
    reason = r.reason
    if can_add_seeds and abs(s.grade.delta) >= grader.PRACTICAL_THRESHOLD and action != "more_seeds":
        # Deterministic autoresearch rule: a non-negligible effect whose interval still straddles zero gets
        # 5 more paired seeds before anyone moves on.
        action = "more_seeds"
        reason = (f"The effect ({agent.points(s.grade.delta):+.2f} points) is bigger than the "
                  f"{agent.points(grader.PRACTICAL_THRESHOLD):.2f}-point practical threshold, but its interval includes "
                  f"zero, so 5 more paired seeds could decide it.")
    if action == "more_seeds" and not can_add_seeds:
        action = "search_library" if inconclusive or r.surprising else "accept"
        reason = (f"Still {s.grade.verdict} after {s.grade.n} paired seeds, so I'm looking in your library for an explanation."
                  if action == "search_library" else "The verdict stands.")
    if s.grade.verdict == "refuted" and action == "accept":
        action = "search_library"  # a refuted claim always gets an explanation from the library
        reason = "The paper's claim failed here, so I'm looking in your library for why."
    s.reflection = r.reflection

    if action == "more_seeds":
        ops.update_star(state, s)
        store.emit(state.id, "agent.replanned", {"star_id": s.id, "because": "the result is inconclusive and near the noise floor",
                                                 "change": f"Running 5 more paired seeds on {s.id} before deciding. {reason}"})
        return {"next": "more_seeds"}

    if action == "search_library":
        query = r.search_query or s.title
        ops.think(state, f"Searching your library: \"{query}\". {reason}", s.id)
        try:
            hits = await papiers_client.search(query)
        except papiers_client.PapiersError as error:
            log.warning("search failed: %s", error)
            hits = []
        store.emit(state.id, "library.search", {"star_id": s.id, "query": query, "hits": [h.model_dump() for h in hits]})
        if hits:
            final_wave = state.wave >= session_config(state.id)["max_waves"] or state.finish_requested
            may_ask = not final_wave and not any(q.wave == state.wave for q in state.questions)
            try:
                check = await agent.detect_conflict(state, s, query, hits, may_ask)
            except LLMError as error:
                log.warning("detect_conflict failed: %s", error)
                check = None
            if check:
                s.reflection = f"{r.reflection} {check.explanation}"
                cited = [h for h in hits if h.id in check.cited_hit_ids] or hits[:2]
                # Re-check synchronously: a sibling branch may have asked while we awaited the LLM (one question per wave).
                if check.conflict and not final_wave and not any(q.wave == state.wave for q in state.questions):
                    return _ask(state, s, check, cited)
                if check.conflict:
                    agent.demote_to_follow_up(check)
                if check.follow_up:
                    ops.add_agenda(state, source="reflection", star_id=s.id, text=check.follow_up.directive,
                                   knob_changes=agent._changes(check.follow_up.knob_changes),
                                   parent_star_id=check.follow_up.parent_star_id, provenance=cited)
                    ops.think(state, f"From your library, a next step for {s.id}: {check.follow_up.title}.", s.id)
    ops.update_star(state, s)
    return {"next": "end"}


def _ask(state, s, check, cited) -> dict:
    claim_evidence = [p for p in s.provenance if p.kind in ("highlight", "note")]
    options = [QuestionOption(id=f"O{i + 1}", label=o.label, consequence=o.consequence, directive=o.directive,
                              parent_star_id=o.parent_star_id, knob_changes=agent._changes(o.knob_changes) or None)
               for i, o in enumerate(check.options[:3])]
    leaning = options[check.agent_leaning_index].id if check.agent_leaning_index is not None and 0 <= check.agent_leaning_index < len(options) else None
    s.status = "waiting"
    ops.update_star(state, s)
    q = ops.add_question(state, star_id=s.id, text=check.question, evidence=claim_evidence + cited,
                         options=options, agent_leaning=leaning)
    ops.think(state, f"The evidence conflicts, so I'm asking you. Only {s.id}'s line waits; other branches keep running.", s.id)
    return {"next": "ask", "question_id": q.id}


async def ask(bs: BranchState) -> dict:
    state = store.get(bs["session_id"])
    q = next(q for q in reversed(state.questions) if q.star_id == bs["star_id"])
    if q.status == "open":
        if session_config(state.id)["auto_mode"]:
            option = q.agent_leaning or q.options[0].id
            ops.apply_answer(state, q, option, None, "auto")
        else:
            interrupt({"kind": "question", "question_id": q.id})
    s = ops.star(state, bs["star_id"])
    s.status = "done"
    ops.update_star(state, s)
    ops.refresh_status(state)
    return {}


def after_reflect(bs: BranchState) -> str:
    return {"more_seeds": "more_seeds", "ask": "ask"}.get(bs.get("next", "end"), END)


async def more_seeds(bs: BranchState) -> dict:
    return {"extra_seeds": True}


def build_branch():
    g = StateGraph(BranchState)
    g.add_node("run", run)
    g.add_node("reflect", reflect)
    g.add_node("more_seeds", more_seeds)
    g.add_node("ask", ask)
    g.add_edge(START, "run")
    g.add_edge("run", "reflect")
    g.add_conditional_edges("reflect", after_reflect, ["more_seeds", "ask", END])
    g.add_edge("more_seeds", "run")
    g.add_edge("ask", END)
    return g.compile()


BRANCH = build_branch()


async def branch(bs: BranchState) -> dict:
    await BRANCH.ainvoke(bs)
    return {"done_branches": [bs["star_id"]]}


def build_graph(checkpointer):
    g = StateGraph(EngineState)
    for name, fn in [("intake", intake), ("baseline", baseline), ("propose", propose), ("select", select),
                     ("branch", branch), ("join", join), ("abstract", abstract)]:
        g.add_node(name, fn)
    g.add_edge(START, "intake")
    g.add_edge("intake", "baseline")
    g.add_conditional_edges("baseline", after_baseline, ["propose", "abstract"])
    g.add_edge("propose", "select")
    g.add_conditional_edges("select", fan_out, ["branch", "join"])
    g.add_edge("branch", "join")
    g.add_conditional_edges("join", after_join, ["propose", "abstract"])
    g.add_edge("abstract", END)
    return g.compile(checkpointer=checkpointer)
