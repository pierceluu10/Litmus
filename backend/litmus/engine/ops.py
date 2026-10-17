"""Session mutations. Each one changes the snapshot, saves it, and emits the matching contract event in the
same synchronous step, so the snapshot and the event log never disagree.
"""

import asyncio
import logging
import statistics

from litmus import grader, store
from litmus.experiments.knobs import BASELINE_KNOBS, DEFAULT_SEEDS, config_hash
from litmus.experiments.service import ExperimentError, estimate_gpu_seconds, run_config
from litmus.models import AgendaItem, Answer, Decision, Grade, apply_changes, Proposal, Provenance, Question, RunResult, SessionState, Star, now_iso

log = logging.getLogger(__name__)

METRIC = "tta_val_acc"  # final accuracy at each config's own tta_level, so TTA ablations compare fairly
STOPPED_BY_HUMAN = "stopped by human"

_gates: dict[str, asyncio.Event] = {}
_running: dict[tuple[str, str], asyncio.Task] = {}
_stopped: set[tuple[str, str]] = set()
_background: set[asyncio.Task] = set()


# ---------------------------------------------------------------- lookups

def star(state: SessionState, star_id: str) -> Star:
    for s in state.stars:
        if s.id == star_id:
            return s
    raise KeyError(star_id)


def proposal(state: SessionState, proposal_id: str) -> Proposal:
    for p in state.proposals:
        if p.id == proposal_id:
            return p
    raise KeyError(proposal_id)


def question(state: SessionState, question_id: str) -> Question:
    for q in state.questions:
        if q.id == question_id:
            return q
    raise KeyError(question_id)


def next_id(prefix: str, existing: list) -> str:
    return f"{prefix}{len(existing) + (0 if prefix == 'S' else 1)}"


def mean_accuracy(s: Star) -> float | None:
    values = [r.tta_val_acc if r.tta_val_acc is not None else r.val_acc for r in s.runs]
    return statistics.fmean(values) if values else None


def best_star(state: SessionState) -> Star:
    """Highest measured accuracy among finished non-shadow stars at the baseline epoch count, else the root."""
    done = [s for s in state.stars if s.status == "done" and s.chosen_by != "shadow" and s.runs]
    return max(done, key=lambda s: mean_accuracy(s) or 0.0) if done else state.stars[0]


# ---------------------------------------------------------------- events + status

def emit(state: SessionState, type_: str, payload: dict) -> None:
    store.save(state)
    store.emit(state.id, type_, payload)


def think(state: SessionState, text: str, star_id: str | None = None) -> None:
    store.emit(state.id, "agent.thinking", {"star_id": star_id, "text": text})


def refresh_status(state: SessionState) -> None:
    if state.status in ("done", "paused"):
        return
    waiting = any(q.status == "open" for q in state.questions) or any(
        p.status == "open" and p.wave == state.wave for p in state.proposals)
    busy = any(s.status in ("queued", "running") for s in state.stars)
    status = "waiting_human" if waiting and not busy else "running"
    if status != state.status:
        state.status = status
        emit(state, "session.status", {"status": status})


def set_status(state: SessionState, status: str) -> None:
    state.status = status
    emit(state, "session.status", {"status": status})


def update_star(state: SessionState, s: Star) -> None:
    emit(state, "star.updated", {"star": s.model_dump()})


def add_budget(state: SessionState, seconds: float) -> None:
    state.budget_used = round(state.budget_used + seconds, 2)
    emit(state, "budget.updated", {"used": state.budget_used, "total": state.budget_total})


def budget_left(state: SessionState) -> float:
    return state.budget_total - state.budget_used


def gate(session_id: str) -> asyncio.Event:
    """Set while the session may start new work; pause clears it."""
    if session_id not in _gates:
        _gates[session_id] = asyncio.Event()
        _gates[session_id].set()
    return _gates[session_id]


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)
    return task


# ---------------------------------------------------------------- stars

def new_star(state: SessionState, *, parent: Star | None, title: str, hypothesis: str, knobs: dict,
             knob_changes: dict, provenance: list[Provenance], chosen_by: str, predicted: str | None,
             proposal_id: str | None = None, shadow_of: str | None = None) -> Star:
    s = Star(id=next_id("S", state.stars), parent_id=parent.id if parent else None,
             depth=parent.depth + 1 if parent else 0, title=title, hypothesis=hypothesis, knobs=knobs,
             knob_changes=knob_changes, provenance=provenance, chosen_by=chosen_by, predicted=predicted,
             proposal_id=proposal_id, shadow_of=shadow_of, wave=state.wave)
    state.stars.append(s)
    emit(state, "shadow.created" if chosen_by == "shadow" else "star.created", {"star": s.model_dump()})
    return s


def existing_config(state: SessionState, knobs: dict) -> Star | None:
    key = config_hash(knobs)
    return next((s for s in state.stars if config_hash(s.knobs.model_dump()) == key and s.status != "failed"), None)


def _merge_runs(existing: list[RunResult], new: list[dict]) -> list[RunResult]:
    by_seed = {r.seed: r for r in existing}
    by_seed.update({r["seed"]: RunResult(**r) for r in new})
    return [by_seed[k] for k in sorted(by_seed)]


def _accuracies(runs: list[RunResult]) -> list[float]:
    return [r.tta_val_acc if r.tta_val_acc is not None else r.val_acc for r in runs]


def comparison_knobs(s: Star, parent: Star) -> dict:
    """The parent's config at the child's epoch count, unless the change IS the epoch count (then the parent itself).

    "Mixup + 20 epochs" is compared with "parent at 20 epochs", isolating mixup; "20 epochs" alone is compared
    with the parent as it ran.
    """
    child, base = s.knobs.model_dump(), parent.knobs.model_dump()
    others_changed = any(child[k] != base[k] for k in child if k != "epochs")
    return {**base, "epochs": child["epochs"]} if others_changed else base


async def run_star(session_id: str, star_id: str, seeds: list[int] = DEFAULT_SEEDS) -> Star:
    """Train the star and its comparison baseline on the same seeds, then grade. Never raises for Modal failures:
    the star is marked failed and other branches continue.

    The comparison baseline is the parent's config at the child's epoch count, so changing training length is
    always compared fairly (re-running the parent at the new length when needed, cached otherwise).
    """
    await gate(session_id).wait()
    state = store.get(session_id)
    s = star(state, star_id)
    parent = star(state, s.parent_id) if s.parent_id else None
    s.status = "running"
    emit(state, "experiment.started", {"star_id": s.id, "seeds": seeds})
    update_star(state, s)
    refresh_status(state)

    def on_child(event: dict) -> None:
        if event["type"] == "progress":
            s.progress.append({"seed": event["seed"], "epoch": event["epoch"], "val_acc": event["val_acc"]})
            emit(state, "experiment.progress", {k: event[k] for k in ("seed", "epoch", "val_acc")} | {"star_id": s.id})
        else:
            run = RunResult(**{k: v for k, v in event.items() if k != "type"})
            s.runs = _merge_runs(s.runs, [run.model_dump()])
            emit(state, "experiment.run_done", {"star_id": s.id, "run": run.model_dump(exclude_none=True)})
            if not run.cached:
                add_budget(state, run.time_seconds)

    def on_comparison(event: dict) -> None:
        if event["type"] == "run" and not event.get("cached"):
            add_budget(state, event["time_seconds"])

    jobs = [run_config(s.knobs.model_dump(), seeds, on_child)]
    if parent:
        comparison = comparison_knobs(s, parent)
        if comparison["epochs"] != parent.knobs.epochs:
            think(state, f"{s.id} trains {s.knobs.epochs:g} epochs, so I'm re-running its parent {parent.id} at "
                         f"{s.knobs.epochs:g} epochs on the same seeds for a fair comparison.", s.id)
        jobs.append(run_config(comparison, seeds, on_comparison))

    task = asyncio.ensure_future(asyncio.gather(*jobs))
    _running[(session_id, star_id)] = task
    try:
        results = await task
    except asyncio.CancelledError:
        if (session_id, star_id) not in _stopped:
            raise
        return fail_star(state, s, STOPPED_BY_HUMAN)
    except ExperimentError as error:
        log.warning("star %s failed: %s", star_id, error)
        return fail_star(state, s, str(error))
    finally:
        _running.pop((session_id, star_id), None)

    if parent:
        s.parent_runs = _merge_runs(s.parent_runs, results[1])
        s.grade = Grade(**grader.grade(_accuracies(s.parent_runs), _accuracies(s.runs), s.predicted or "improves", METRIC))
    else:
        s.grade = Grade(**grader.baseline_grade(_accuracies(s.runs), METRIC))
    s.status, s.finished_at = "done", now_iso()
    emit(state, "star.graded", {"star_id": s.id, "grade": s.grade.model_dump()})
    update_star(state, s)
    refresh_status(state)
    return s


def fail_star(state: SessionState, s: Star, error: str) -> Star:
    s.status, s.error, s.finished_at = "failed", error, now_iso()
    emit(state, "star.failed", {"star_id": s.id, "error": error})
    update_star(state, s)
    refresh_status(state)
    return s


def stop_star(session_id: str, star_id: str) -> bool:
    task = _running.get((session_id, star_id))
    if not task:
        return False
    _stopped.add((session_id, star_id))
    task.cancel()
    return True


# ---------------------------------------------------------------- human-facing records

def add_decision(state: SessionState, **fields) -> Decision:
    d = Decision(id=next_id("D", state.decisions), **fields)
    state.decisions.append(d)
    store.save(state)
    return d


def add_agenda(state: SessionState, **fields) -> AgendaItem:
    item = AgendaItem(id=next_id("A", state.agenda), **fields)
    state.agenda.append(item)
    store.save(state)
    return item


def add_question(state: SessionState, **fields) -> Question:
    q = Question(id=next_id("Q", state.questions), wave=state.wave, **fields)
    state.questions.append(q)
    emit(state, "question.asked", {"question": q.model_dump()})
    refresh_status(state)
    return q


def apply_answer(state: SessionState, q: Question, option_id: str, comment: str | None, chosen_by: str) -> Decision:
    """Record the answer, the agent-vs-human decision, and carry the chosen option into the next wave's agenda."""
    option = next(o for o in q.options if o.id == option_id)
    leaning = next((o for o in q.options if o.id == q.agent_leaning), None)
    q.status, q.answer = "answered", Answer(option_id=option_id, comment=comment)
    who = "You" if chosen_by == "human" else "Auto mode"
    decision = add_decision(
        state, star_id=q.star_id, kind="answer", agent_recommendation=leaning.label if leaning else "(no leaning)",
        human_choice=option.label, agent_recommendation_ids=[leaning.id] if leaning else [],
        human_choice_ids=[option.id], changed_trajectory=bool(leaning) and leaning.id != option.id,
        note=f"{who} answered \"{q.text}\" with \"{option.label}\"." + (f" Comment: {comment}" if comment else ""))
    human = Provenance(kind="human", id=f"answer:{q.id}", text=f"{who} chose \"{option.label}\""
                       + (f": {comment}" if comment else ""))
    add_agenda(state, source="answer", star_id=q.star_id, text=option.directive or option.label,
               knob_changes=option.knob_changes or {}, parent_star_id=option.parent_star_id,
               provenance=[human, *q.evidence])
    emit(state, "question.answered", {"question_id": q.id, "option_id": option_id, "decision": decision.model_dump()})
    emit(state, "agent.replanned", {"star_id": q.star_id, "because": f"you chose \"{option.label}\"",
                                    "change": option.directive or option.consequence})
    refresh_status(state)
    return decision


def proposals_ready(state: SessionState, anchor_id: str) -> None:
    current = [p.model_dump() for p in state.proposals if p.wave == state.wave]
    emit(state, "proposals.ready", {"star_id": anchor_id, "proposals": current})
    refresh_status(state)


def dispatch(state: SessionState, selections: list[dict], chosen_by: str, instruction: str | None = None) -> list[Star]:
    """Turn selected proposals into queued stars and record what the agent would have done alone.

    Idempotent: already-dispatched proposals return their existing star.
    """
    wave_proposals = [p for p in state.proposals if p.wave == state.wave]
    recommended = next((p for p in wave_proposals if p.agent_recommended), None)
    stars = []
    for selection in selections:
        p = proposal(state, selection["proposal_id"])
        if p.status == "dispatched":
            stars.extend(s for s in state.stars if s.proposal_id == p.id and s.chosen_by != "shadow")
            continue
        parent = star(state, p.parent_star_id or p.star_id)
        changes = {**p.knob_changes, **(selection.get("knob_overrides") or {})}
        knobs = apply_changes(parent.knobs.model_dump(), changes)
        provenance = list(p.provenance)
        if selection.get("knob_overrides"):
            provenance.append(Provenance(kind="human", id=f"override:{p.id}",
                                         text=f"Human edited the change: {selection['knob_overrides']}"))
        if instruction:
            provenance.append(Provenance(kind="human", id=f"instruction:{p.id}", text=instruction))
        p.status = "dispatched"
        stars.append(new_star(state, parent=parent, title=p.title, hypothesis=p.hypothesis, knobs=knobs,
                              knob_changes=changes, provenance=provenance, chosen_by=chosen_by,
                              predicted=p.predicted, proposal_id=p.id))
    if not stars:
        return stars
    for p in wave_proposals:
        if p.status == "open":
            p.status = "skipped"
    chosen = [p for p in wave_proposals if p.status == "dispatched"]
    agent_choice = recommended.title if recommended else "(no recommendation)"
    changed = bool(recommended) and recommended.status != "dispatched"
    decision = add_decision(
        state, star_id=chosen[0].star_id, kind="dispatch", agent_recommendation=agent_choice,
        human_choice=", ".join(p.title for p in chosen),
        agent_recommendation_ids=[recommended.id] if recommended else [], human_choice_ids=[p.id for p in chosen],
        changed_trajectory=changed,
        note=("Auto mode: the agent ran its own recommendation." if chosen_by == "auto" else
              f"The human dispatched {len(chosen)} of {len(wave_proposals)} proposals"
              + (f" and skipped the agent's pick ({agent_choice})." if changed else ", including the agent's pick.")
              + (f" Instruction: {instruction}" if instruction else "")),
    )
    emit(state, "human.dispatched", {"star_id": decision.star_id, "selections": selections,
                                     "decision": decision.model_dump()})
    refresh_status(state)
    if changed and chosen_by == "human":
        start_shadow(state, recommended, decision.id)
    return stars


def start_shadow(state: SessionState, p: Proposal, decision_id: str) -> None:
    """Run the agent's own pick as a low-priority ghost branch so the UI can compare agent-alone vs human-guided."""
    parent = star(state, p.parent_star_id or p.star_id)
    knobs = apply_changes(parent.knobs.model_dump(), p.knob_changes)
    if budget_left(state) < 2 * estimate_gpu_seconds(knobs, len(DEFAULT_SEEDS)):
        think(state, f"Not enough GPU budget left to also run my own pick ({p.title}) as a shadow branch.")
        return
    shadow = new_star(state, parent=parent, title=p.title, hypothesis=p.hypothesis, knobs=knobs,
                      knob_changes=p.knob_changes, provenance=p.provenance, chosen_by="shadow",
                      predicted=p.predicted, proposal_id=p.id, shadow_of=decision_id)
    think(state, f"You skipped my pick, \"{p.title}\". I'll run it quietly as a shadow branch ({shadow.id}) "
                 f"so we can compare what I would have found alone.", shadow.id)
    spawn(run_star(state.id, shadow.id))


def baseline_knobs() -> dict:
    return dict(BASELINE_KNOBS)
