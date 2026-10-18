"""Drives the graph per session and applies human actions.

Human actions are recorded on the session snapshot first (instant UI feedback, persisted), then the driver
"kicks" the graph: it derives every resolvable interrupt's resume value from the snapshot and resumes. Because
resume values come from the snapshot, a server restart can always pick up where it left off.
"""

import asyncio
import logging
import random
import uuid

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from pydantic import ValidationError

from litmus import store
from litmus.config import DATA_DIR
from litmus.engine import agent, graph, ops
from litmus.experiments.knobs import DEFAULT_SEEDS, EXTRA_SEEDS
from litmus.experiments.service import estimate_gpu_seconds
from litmus.llm import LLMError
from litmus.library import session_library
from litmus.models import ChatTurn, Library, Proposal, Provenance, SessionState, apply_changes

log = logging.getLogger(__name__)

CHECKPOINT_PATH = DATA_DIR / "checkpoints.sqlite"
DEFAULT_GOAL = "Which of the training tricks I highlighted actually hold for a ~10-epoch CIFAR-10 run?"
ABSTRACT_WAIT_SECONDS = 240
ABSTRACT_POLL_SECONDS = 0.5
FRESH_SEED_STRIDE = 1000  # seed lists stay disjoint between fresh sessions (each uses < 1000 seeds)
FRESH_SEED_BUCKETS = 100_000

_graph = None
_saver_context = None
_tasks: dict[str, asyncio.Task] = {}
_timers: dict[str, asyncio.TimerHandle] = {}


class ActionError(ValueError):
    """A human action that conflicts with the session's state (maps to HTTP 409)."""


async def startup() -> None:
    global _graph, _saver_context
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _saver_context = AsyncSqliteSaver.from_conn_string(str(CHECKPOINT_PATH))
    _graph = graph.build_graph(await _saver_context.__aenter__())
    for summary in store.list_sessions():
        if summary["status"] != "done" and not summary["replay"]:
            log.info("recovering session %s", summary["id"])
            kick(summary["id"])


async def shutdown() -> None:
    for task in _tasks.values():
        task.cancel()
    if _saver_context:
        await _saver_context.__aexit__(None, None, None)


def _thread(session_id: str) -> dict:
    return {"configurable": {"thread_id": session_id}}


# ---------------------------------------------------------------- graph driving

def create_session(goal: str | None, budget: float, auto_mode: bool, auto_timeout_seconds: float | None,
                   max_waves: int = graph.MAX_WAVES, fresh: bool = False, library: Library | None = None) -> SessionState:
    state = SessionState(id=f"ses_{uuid.uuid4().hex[:10]}", goal=goal or DEFAULT_GOAL, budget_total=budget, library=library)
    seed_offset = random.randrange(1, FRESH_SEED_BUCKETS) * FRESH_SEED_STRIDE if fresh else 0
    store.create_session(state, {"auto_mode": auto_mode, "auto_timeout_seconds": auto_timeout_seconds,
                                 "max_waves": max_waves, "seed_offset": seed_offset})
    store.emit(state.id, "session.started", {"goal": state.goal, "replay": False})
    kick(state.id, first=True)
    return state


def kick(session_id: str, first: bool = False) -> None:
    """Advance the graph if it is idle. A running advance re-checks resumable interrupts when it finishes."""
    task = _tasks.get(session_id)
    if task and not task.done():
        return
    _tasks[session_id] = asyncio.create_task(_advance(session_id, first))


def _resume_values(state: SessionState, interrupts) -> dict:
    values = {}
    for item in interrupts:
        kind = item.value.get("kind")
        if kind == "selection":
            stars = [s.id for s in state.stars if s.wave == item.value["wave"] and s.chosen_by in ("human", "auto")]
            if stars or state.finish_requested:
                values[item.id] = {"star_ids": stars}
        elif kind == "start":
            if state.start_claim_ids:
                values[item.id] = {"claim_ids": state.start_claim_ids}
        elif kind == "question":
            if ops.question(state, item.value["question_id"]).status == "answered":
                values[item.id] = {"answered": True}
    return values


async def _advance(session_id: str, first: bool) -> None:
    config = _thread(session_id)
    command = {"session_id": session_id, "wave_star_ids": [], "done_branches": []} if first else None
    try:
        while True:
            if command is not None or first:
                await _graph.ainvoke(command, config)
            snapshot = await _graph.aget_state(config)
            if not snapshot.next:
                return
            state = store.get(session_id)
            if state.status == "paused":
                return
            if not snapshot.interrupts:
                await _graph.ainvoke(None, config)  # recovering a run interrupted by a restart
                continue
            values = _resume_values(state, snapshot.interrupts)
            if not values:
                _schedule_auto(session_id, snapshot.interrupts)
                return
            command, first = Command(resume=values), False
    except Exception as error:  # task boundary: report any engine crash to the UI instead of dying silently
        log.exception("engine crashed for %s", session_id)
        store.emit(session_id, "error", {"message": f"Engine error: {type(error).__name__}: {error}"})


def _schedule_auto(session_id: str, interrupts) -> None:
    """Optional auto-mode timeout: if the human doesn't respond, the agent proceeds with its own choice."""
    seconds = store.config(session_id).get("auto_timeout_seconds")
    if not seconds or session_id in _timers:
        return

    def fire() -> None:
        _timers.pop(session_id, None)
        state = store.get(session_id)
        for item in interrupts:
            if item.value.get("kind") == "selection":
                firsts = list(ops.first_options(state).values())[:graph.MAX_BRANCHES]
                if firsts:
                    ops.think(state, f"No response in {seconds:g}s, so I'm running each agent's first option.")
                    ops.dispatch(state, [{"proposal_id": p.id} for p in firsts], "auto")
            elif item.value.get("kind") == "question":
                q = ops.question(state, item.value["question_id"])
                if q.status == "open":
                    ops.think(state, f"No answer in {seconds:g}s, so I'm going with my leaning.", q.star_id)
                    ops.apply_answer(state, q, q.agent_leaning or q.options[0].id, None, "auto")
        kick(session_id)

    _timers[session_id] = asyncio.get_running_loop().call_later(seconds, fire)


def _cancel_timer(session_id: str) -> None:
    timer = _timers.pop(session_id, None)
    if timer:
        timer.cancel()


# ---------------------------------------------------------------- human actions

def dispatch(session_id: str, star_id: str, selections: list[dict], instruction: str | None) -> None:
    state = store.get(session_id)
    ops.star(state, star_id)
    if state.finish_requested or state.status == "done":
        raise ActionError("this session is finishing; nothing new will run")
    if not selections:
        raise ActionError("select at least one proposal")
    if len(selections) > graph.MAX_BRANCHES:
        raise ActionError(f"at most {graph.MAX_BRANCHES} branches run at once")
    estimate = 0.0
    for selection in selections:
        p = ops.proposal(state, selection["proposal_id"])
        if p.status == "skipped":
            raise ActionError(f"{p.id} was passed over when another option on its card was chosen")
        parent = ops.star(state, p.parent_star_id or p.star_id)
        try:
            knobs = apply_changes(parent.knobs.model_dump(), {**p.knob_changes, **(selection.get("knob_overrides") or {})})
        except ValidationError as error:
            raise ActionError(f"invalid knob_overrides for {p.id}: {error.errors()[0]['msg']}") from error
        estimate += estimate_gpu_seconds(knobs, len(DEFAULT_SEEDS)) * 2
    if all(ops.proposal(state, s["proposal_id"]).status == "dispatched" for s in selections):
        return  # idempotent repeat
    new = sum(ops.proposal(state, s["proposal_id"]).status == "open" for s in selections)
    if len(graph.research_stars(state)) + new > graph.MAX_STARS:
        raise ActionError(f"this session is capped at {graph.MAX_STARS} stars")
    if ops.budget_left(state) < estimate:
        store.emit(session_id, "error", {"message": f"Dispatch refused: needs ~{estimate:.0f} GPU-s, "
                                                    f"{ops.budget_left(state):.0f} left in the budget."})
        raise ActionError("GPU budget exceeded")
    _cancel_timer(session_id)
    if instruction:
        ops.think(state, f"Noted your instruction: \"{instruction}\".")
    ops.dispatch(state, selections, "human", instruction)
    kick(session_id)


def start(session_id: str, claim_ids: list[str], known: set[str]) -> None:
    """The human's answer to "Where should we start?": the claims the first agents test."""
    state = store.get(session_id)
    if state.start_claim_ids:
        if state.start_claim_ids == claim_ids:
            return
        raise ActionError("this session already started")
    if len(claim_ids) != 1:
        raise ActionError("choose exactly one claim to start from")
    unknown = [c for c in claim_ids if c not in known]
    if unknown:
        raise ActionError(f"unknown claims: {', '.join(unknown)}")
    state.start_claim_ids = claim_ids
    ops.emit(state, "start.chosen", {"claim_ids": claim_ids})
    ops.refresh_status(state)
    kick(session_id)


def pivot(session_id: str, claim) -> None:
    """The human turns to a claim no agent has tested: Litmus drafts its plain test, and it runs as a new agent
    (in the next wave if one is running)."""
    state = store.get(session_id)
    if not state.start_claim_ids:
        raise ActionError("choose where to start first")
    if state.finish_requested or state.status == "done":
        raise ActionError("this session is finishing; nothing new will run")
    if ops.target_wave(state) > store.config(session_id)["max_waves"]:
        raise ActionError("no waves left in this session")
    if any(p.id == claim.id for s in state.stars for p in s.provenance):
        raise ActionError(f"{claim.id} is already being tested")
    if len(graph.research_stars(state)) >= graph.MAX_STARS:
        raise ActionError(f"this session is capped at {graph.MAX_STARS} stars")
    ops.think(state, f"Pivoting to \"{claim.summary or claim.text[:80]}\", as you asked: drafting its test from the baseline.")
    ops.spawn(_pivot(session_id, claim))


async def _pivot(session_id: str, claim) -> None:
    state = store.get(session_id)
    try:
        await graph.open_claim(state, claim)
    except (agent.ProposalError, LLMError) as error:
        store.emit(session_id, "error", {"message": f"Could not draft a test for that claim: {error}"})
        return
    kick(session_id)


def answer(session_id: str, question_id: str, option_id: str, comment: str | None) -> None:
    state = store.get(session_id)
    q = ops.question(state, question_id)
    if option_id not in {o.id for o in q.options}:
        raise ActionError(f"{option_id} is not an option of {question_id}")
    if q.status == "answered":
        if q.answer and q.answer.option_id == option_id:
            return
        raise ActionError(f"{question_id} was already answered with {q.answer.option_id}")
    _cancel_timer(session_id)
    ops.apply_answer(state, q, option_id, comment, "human")
    kick(session_id)


def feedback(session_id: str, star_id: str, kind: str, text: str) -> None:
    state = store.get(session_id)
    ops.star(state, star_id)
    store.emit(session_id, "feedback.received", {"star_id": star_id, "kind": kind, "text": text})
    ops.spawn(_handle_feedback(session_id, star_id, kind, text))


def _current_plan(state: SessionState) -> str:
    open_props = [p.title for p in state.proposals if p.status == "open"]
    if open_props:
        return f"wait for you to choose among: {', '.join(open_props)}"
    return f"plan wave {state.wave + 1} building on {ops.best_star(state).id}"


async def _handle_feedback(session_id: str, star_id: str, kind: str, text: str) -> None:
    state = store.get(session_id)
    s = ops.star(state, star_id)
    ops.think(state, f"Reconsidering {s.id} because you said: \"{text}\"", s.id)
    try:
        r = await agent.replan(state, s, kind, text, _current_plan(state))
    except LLMError as error:
        r = None
        log.warning("replan failed: %s", error)
    human = Provenance(kind="human", id=f"feedback:{star_id}:{len(state.decisions) + 1}", text=text)
    action = r.action if r else "note"
    change = r.change if r else "I'll carry your feedback into the next wave's planning."

    if action == "more_seeds" and not (s.status == "done" and s.grade and s.grade.n < agent.MAX_SEEDS):
        action, change = "note", f"{s.id} already has {s.grade.n if s.grade else 0} seeds, so I'll weigh your doubt when planning the next wave."
    if action == "add_proposal" and r and r.proposal:
        added = _add_feedback_proposal(state, r.proposal, human)
        if not added:
            action = "note"

    ops.add_decision(state, star_id=star_id, kind="feedback",
                     agent_recommendation=r.agent_was_going_to if r else _current_plan(state),
                     human_choice=f"{kind}: {text}", changed_trajectory=action != "note" or kind != "challenge",
                     note=change)
    store.emit(session_id, "agent.replanned", {"star_id": star_id, "because": f"you said \"{text}\"", "change": change})
    if action == "more_seeds":
        await ops.run_star(session_id, star_id, EXTRA_SEEDS)
        s = ops.star(store.get(session_id), star_id)
        if s.grade:
            ops.think(state, f"With {s.grade.n} seeds, {s.id} is {s.grade.verdict}: delta {agent.points(s.grade.delta):+.2f} "
                             f"points, 95% CI [{agent.points(s.grade.ci_low):+.2f}, {agent.points(s.grade.ci_high):+.2f}].", s.id)
    elif action in ("deprioritize", "note"):
        ops.add_agenda(state, source="feedback", star_id=star_id,
                       text=(f"Do not build on {star_id} next wave. " if action == "deprioritize" else "") + f"Human feedback ({kind}): {text}",
                       provenance=[human])


def _add_feedback_proposal(state: SessionState, draft, human: Provenance) -> bool:
    """A human-suggested experiment becomes an option on the card of the agent it builds on."""
    try:
        parent = ops.star(state, draft.parent_star_id)
        changes = agent._changes(draft.knob_changes)
        knobs = apply_changes(parent.knobs.model_dump(), changes)
    except (KeyError, ValidationError) as error:
        log.warning("feedback proposal invalid: %s", error)
        return False
    if not changes or ops.existing_config(state, knobs):
        return False
    state.proposals.append(Proposal(id=f"P{len(state.proposals) + 1}", star_id=parent.id, parent_star_id=parent.id,
                                    title=draft.title, hypothesis=draft.hypothesis, predicted=draft.predicted,
                                    knob_changes=changes, condition_notes=draft.condition_notes,
                                    provenance=[human], agent_recommended=False, wave=state.wave))
    ops.proposals_ready(state, parent.id)
    kick(state.id)  # the graph may be idle at a selection with nothing else open
    return True


def pause(session_id: str) -> None:
    state = store.get(session_id)
    if state.status == "done":
        raise ActionError("session is done")
    ops.gate(session_id).clear()
    ops.set_status(state, "paused")


def resume(session_id: str) -> None:
    state = store.get(session_id)
    if state.status == "paused":
        ops.gate(session_id).set()
        state.status = "running"
        ops.emit(state, "session.status", {"status": "running"})
        ops.refresh_status(state)
    kick(session_id)


def stop_branch(session_id: str, star_id: str) -> None:
    state = store.get(session_id)
    s = ops.star(state, star_id)
    if not ops.stop_star(session_id, star_id):
        raise ActionError(f"{s.id} is not running (status {s.status})")


async def finish(session_id: str) -> SessionState:
    """Stop launching waves, let running branches finish, and return once the abstract is written."""
    state = store.get(session_id)
    if state.abstract is None:
        state.finish_requested = True
        store.save(state)
        _cancel_timer(session_id)
        kick(session_id)
        for _ in range(int(ABSTRACT_WAIT_SECONDS / ABSTRACT_POLL_SECONDS)):
            if store.get(session_id).abstract is not None:
                break
            await asyncio.sleep(ABSTRACT_POLL_SECONDS)
        else:
            raise ActionError("the abstract is still being written; it will arrive as abstract.ready")
    return store.get(session_id)


async def explain(state: SessionState, star_id: str | None, question: str | None,
                  history: list[ChatTurn]) -> tuple[str, list[Provenance]]:
    """Litmus's chat: about one star when one is open, else about the whole research. `state` is a stored session or
    the demo's own (the in-browser practice session sends its snapshot)."""
    if star_id is None:
        _, claims = await session_library(state)
        return await agent.chat_research(state, claims, question or "Where does the research stand?", history)
    s = ops.star(state, star_id)
    return await agent.chat(state, s, question or "Why did this come out the way it did, and what does it mean?", history)


async def autoresearch(state: SessionState, star_id: str | None) -> tuple[str, list[dict]]:
    """Explore this topic further: related papers the human has not read (works on a stored or a demo session)."""
    documents, _ = await session_library(state)
    return await agent.autoresearch(state, ops.star(state, star_id) if star_id else None, documents)


async def suggest_questions(state: SessionState, star_id: str | None, asked: list[str]) -> list[str]:
    return await agent.suggest_questions(state, ops.star(state, star_id) if star_id else None, asked)
