"""The LLM side of Litmus and its agents. Litmus is the lead researcher: it sees the whole tree, plans when no
agent has a next step, answers the human's questions, and writes the abstract. Each star has its own agent, named
for the idea it tests; when its experiment is graded, the agent reflects and suggests where to go next, reading its
siblings' results so the agents build on each other. Every call is a structured output that code then validates: ids must exist,
knob changes must pass the knob schema, and numbers always come from the grader, never from the model.
"""

import re
from typing import Literal

from pydantic import BaseModel, ValidationError

from litmus import arxiv, papiers_client, store
from litmus.engine import ops
from litmus.experiments.knobs import BASELINE_KNOBS, config_hash
from litmus.llm import structured
from litmus.models import ChatTurn, Claim, Document, Proposal, Provenance, SessionState, Star, apply_changes

MAX_PROPOSALS = 4
MAX_SEEDS = 10
MAX_SUGGESTIONS = 3
POINTS = 100  # grader works in fractions; prompts and prose use accuracy points

# An agent is named for the idea its star tests (mirrors the frontend's agentName).
AGENT_NAMES = {"label_smoothing": "Smoothing", "epochs": "Long training", "tta_level": "TTA", "flip": "Flip",
               "mixup_alpha": "Mixup", "cutout": "Cutout", "lr_scale": "Learning rate", "whiten": "Whitening",
               "dirac_init": "Identity init", "translate": "Translate"}

KNOB_SCHEMA = {
    "label_smoothing": f"float 0..0.5 (baseline {BASELINE_KNOBS['label_smoothing']})",
    "tta_level": "0 none | 1 mirror | 2 mirror+translate (baseline 2)",
    "flip": "'random' | 'alternating' | 'none' (baseline 'alternating', the airbench paper's trick)",
    "mixup_alpha": "float 0..2, 0 = off (baseline 0)",
    "cutout": "int px 0..16, 0 = off (baseline 0)",
    "lr_scale": "float 0.1..3 (baseline 1.0)",
    "whiten": "bool, patch-whitening first layer (baseline true)",
    "dirac_init": "bool, identity init of convs (baseline true)",
    "translate": "int px 0..4 random-crop translation (baseline 2)",
}


class KnobChanges(BaseModel):
    label_smoothing: float | None = None
    epochs: float | None = None
    tta_level: Literal[0, 1, 2] | None = None
    flip: Literal["random", "alternating", "none"] | None = None
    mixup_alpha: float | None = None
    cutout: int | None = None
    lr_scale: float | None = None
    whiten: bool | None = None
    dirac_init: bool | None = None
    translate: int | None = None

    def changes(self) -> dict:
        return self.model_dump(exclude_none=True)


class ProposalDraft(BaseModel):
    title: str
    hypothesis: str
    predicted: Literal["improves", "hurts", "no_effect"]
    parent_star_id: str
    knob_changes: KnobChanges
    condition_notes: str
    claim_ids: list[str]
    agenda_ids: list[str]


class ProposalSet(BaseModel):
    thinking: str
    proposals: list[ProposalDraft]


class AgentSuggestions(BaseModel):
    take: str
    proposals: list[ProposalDraft]


class Reflection(BaseModel):
    reflection: str
    surprising: bool
    action: Literal["accept", "more_seeds", "search_library"]
    reason: str
    search_query: str | None


class OptionDraft(BaseModel):
    label: str
    consequence: str
    directive: str
    parent_star_id: str | None
    knob_changes: KnobChanges | None


class FollowUp(BaseModel):
    title: str
    directive: str
    parent_star_id: str | None
    knob_changes: KnobChanges | None


class ConflictCheck(BaseModel):
    explanation: str
    cited_hit_ids: list[str]
    conflict: bool
    question: str | None
    options: list[OptionDraft]
    agent_leaning_index: int | None
    follow_up: FollowUp | None


class ReplanProposal(BaseModel):
    parent_star_id: str
    title: str
    hypothesis: str
    predicted: Literal["improves", "hurts", "no_effect"]
    knob_changes: KnobChanges
    condition_notes: str


class Replan(BaseModel):
    action: Literal["more_seeds", "add_proposal", "deprioritize", "note"]
    change: str
    agent_was_going_to: str
    proposal: ReplanProposal | None


class Explanation(BaseModel):
    answer: str
    cited_ids: list[str]


class AbstractDraft(BaseModel):
    text: str
    findings: list[str]


class ProposalError(RuntimeError):
    """The model could not produce a valid proposal set even after repair."""


# ---------------------------------------------------------------- prompt context

def points(x: float | None) -> float | None:
    return None if x is None else round(x * POINTS, 3)


def grade_summary(s: Star) -> dict | None:
    if not s.grade:
        return None
    g = s.grade
    return {"verdict": g.verdict, "metric": g.metric, "mean_parent": points(g.mean_parent),
            "mean_child": points(g.mean_child), "delta": points(g.delta), "ci": [points(g.ci_low), points(g.ci_high)],
            "p_value": round(g.p_value, 4), "n": g.n, "practical": g.practical}


def _base_name(s: Star) -> str:
    if not s.parent_id:
        return "Baseline"
    method = next((k for k in s.knob_changes if k != "epochs"), "epochs")
    return f"{AGENT_NAMES[method]} agent"


def agent_name(state: SessionState, s: Star) -> str:
    """The agent's name; agents that share one get A, B, C… in the order they started (mirrors the frontend)."""
    base = _base_name(s)
    same = [x.id for x in state.stars if x.parent_id and _base_name(x) == base]
    return f"{base} {chr(ord('A') + same.index(s.id))}" if len(same) > 1 else base


def star_summary(state: SessionState, s: Star) -> dict:
    return {"id": s.id, "agent": agent_name(state, s), "parent": s.parent_id, "title": s.title, "status": s.status,
            "chosen_by": s.chosen_by, "knob_changes": s.knob_changes, "predicted": s.predicted, "grade": grade_summary(s),
            "reflection": s.reflection, "suggestion": s.suggestion, "error": s.error}


def tree(state: SessionState) -> list[dict]:
    return [star_summary(state, s) for s in state.stars]


def claim_summary(c: Claim) -> dict:
    return {"id": c.id, "rank": c.rank, "paper": c.doc_title, "claim": c.text[:400], "human_note": c.annotation,
            "conditions": c.conditions}


def provenance_text(items: list[Provenance]) -> list[dict]:
    return [{"kind": p.kind, "id": p.id, "paper": p.doc_title, "text": p.text[:400]} for p in items]


def _changes(knob_changes: KnobChanges | None) -> dict:
    return knob_changes.changes() if knob_changes else {}


# ---------------------------------------------------------------- propose

def _validate_proposals(drafts: ProposalSet | AgentSuggestions, state: SessionState, claims: dict[str, Claim], slots: int,
                        required: set[str], anchor: str | None = None) -> tuple[list[Proposal], list[str]]:
    """Valid proposals and the problems found (unknown ids, invalid knobs, duplicates, no-op changes, required
    agenda items left out). An agent's proposals are anchored on its own star, whatever parent they change."""
    problems, proposals = [], []
    seen = {config_hash(apply_changes(ops.star(state, p.parent_star_id or p.star_id).knobs.model_dump(), p.knob_changes))
            for p in state.proposals if p.status == "open"}
    agenda = {a.id: a for a in state.agenda}
    star_ids = {s.id for s in state.stars if s.status == "done"}
    base = len(state.proposals)
    for draft in drafts.proposals:
        if len(proposals) == slots:
            break
        if draft.parent_star_id not in star_ids:
            problems.append(f"'{draft.title}': parent_star_id {draft.parent_star_id} is not a finished star")
            continue
        parent = ops.star(state, draft.parent_star_id)
        changes = {k: v for k, v in draft.knob_changes.changes().items() if parent.knobs.model_dump()[k] != v}
        if not changes:
            problems.append(f"'{draft.title}': knob_changes change nothing relative to {parent.id}")
            continue
        try:
            knobs = apply_changes(parent.knobs.model_dump(), changes)
        except ValidationError as error:
            problems.append(f"'{draft.title}': invalid knob values: {error.errors()[0]['msg']}")
            continue
        key = config_hash(knobs)
        if "epochs" in changes:
            problems.append(f"'{draft.title}': training length is fixed at {BASELINE_KNOBS['epochs']} epochs for every "
                            "experiment (apples-to-apples comparisons); change a method knob instead")
            continue
        if ops.existing_config(state, knobs) or key in seen:
            problems.append(f"'{draft.title}': this configuration was already run or proposed")
            continue
        seen.add(key)
        provenance = [p for cid in draft.claim_ids if cid in claims for p in claims[cid].provenance]
        for aid in draft.agenda_ids:
            if aid in agenda:
                provenance.extend(agenda[aid].provenance)
        if not provenance:
            problems.append(f"'{draft.title}': cites no known claim_ids or agenda_ids")
            continue
        proposals.append(Proposal(
            id=f"P{base + len(proposals) + 1}", star_id=anchor or parent.id, parent_star_id=parent.id, title=draft.title,
            hypothesis=draft.hypothesis, predicted=draft.predicted, knob_changes=changes,
            condition_notes=draft.condition_notes, provenance=provenance, agent_recommended=False, wave=state.wave,
        ))
    implemented = {aid for d in drafts.proposals for aid in d.agenda_ids}
    for aid in required - implemented:
        problems.append(f"agenda item {aid} ({agenda[aid].text[:80]}) from the human is not implemented by any proposal")
    return proposals, problems


def human_agenda(state: SessionState, star_id: str | None = None) -> list:
    """Unconsumed answers and feedback from the human, optionally only those about one star."""
    return [a for a in state.agenda if not a.consumed and a.source in ("answer", "feedback")
            and (star_id is None or a.star_id == star_id)]


def _agenda_view(items) -> list[dict]:
    return [a.model_dump(include={"id", "source", "star_id", "text", "knob_changes", "parent_star_id"}) for a in items]


def _repair(values: dict, problems: list[str], fewest: int) -> dict:
    return dict(values, instruction=(values["instruction"] + "\n\nYOUR PREVIOUS PROPOSALS HAD PROBLEMS, FIX THEM:\n- "
                                     + "\n- ".join(problems or [f"fewer than {fewest} valid proposals"])))


async def propose(state: SessionState, claims: list[Claim], instruction: str | None, max_waves: int, slots: int) -> tuple[list[Proposal], str]:
    """Litmus plans: up to `slots` validated proposals grounded in the library and agenda. Repairs once."""
    by_id = {c.id: c for c in claims}
    fewest = min(2, slots)
    required = {a.id for a in human_agenda(state)}
    values = dict(goal=state.goal, wave=str(state.wave), max_waves=str(max_waves), fewest=str(fewest), slots=str(slots),
                  knob_schema=KNOB_SCHEMA, claims=[claim_summary(c) for c in claims], tree=tree(state),
                  agenda=_agenda_view(a for a in state.agenda if not a.consumed) or "(empty)", instruction=instruction or "(none)")
    drafts = await structured("propose", ProposalSet, **values)
    proposals, problems = _validate_proposals(drafts, state, by_id, slots, required)
    if problems or len(proposals) < fewest:
        drafts = await structured("propose", ProposalSet, **_repair(values, problems, fewest))
        proposals, problems = _validate_proposals(drafts, state, by_id, slots, required)
    if not proposals:
        raise ProposalError("; ".join(problems) or "no valid proposals")
    return proposals, drafts.thinking


async def suggest(state: SessionState, s: Star, claims: list[Claim], conditions: str) -> tuple[list[Proposal], str]:
    """The star's agent, right after its verdict: its take and up to 3 next steps, reading its siblings' results and
    the other agents' open suggestions so they build on each other instead of repeating. Repairs once."""
    by_id = {c.id: c for c in claims}
    mine = human_agenda(state, s.id)
    siblings = [star_summary(state, x) for x in state.stars if x.id != s.id and x.wave == s.wave and x.parent_id]
    others = [{"agent": agent_name(state, ops.star(state, p.star_id)), "title": p.title, "knob_changes": p.knob_changes}
              for p in state.proposals if p.status == "open"]
    values = dict(agent=agent_name(state, s), goal=state.goal, star=star_summary(state, s), grade=grade_summary(s),
                  provenance=provenance_text(s.provenance), conditions=conditions or "(unknown)", siblings=siblings or "(none yet)",
                  others=others or "(none)", tree=tree(state), claims=[claim_summary(c) for c in claims],
                  knob_schema=KNOB_SCHEMA, agenda=_agenda_view(mine) or "(empty)", most=str(MAX_SUGGESTIONS),
                  instruction="(none)")
    drafts = await structured("suggest", AgentSuggestions, **values)
    proposals, problems = _validate_proposals(drafts, state, by_id, MAX_SUGGESTIONS, {a.id for a in mine}, anchor=s.id)
    if problems or not proposals:
        drafts = await structured("suggest", AgentSuggestions, **_repair(values, problems, 1))
        proposals, problems = _validate_proposals(drafts, state, by_id, MAX_SUGGESTIONS, {a.id for a in mine}, anchor=s.id)
    if proposals:
        for a in mine:
            a.consumed = True
    return proposals, drafts.take


# ---------------------------------------------------------------- reflect / conflicts

async def reflect(state: SessionState, s: Star, conditions: str, budget_left: float) -> Reflection:
    return await structured("reflect", Reflection, star=star_summary(state, s), grade=grade_summary(s),
                            provenance=provenance_text(s.provenance), conditions=conditions or "(unknown)",
                            tree=tree(state), n=str(s.grade.n if s.grade else 0), max_seeds=str(MAX_SEEDS),
                            budget_left=f"{budget_left:.0f}")


async def detect_conflict(state: SessionState, s: Star, query: str, hits: list[Provenance], may_ask: bool) -> ConflictCheck:
    hit_lines = "\n".join(f"{h.id} ({h.doc_title}): {h.text[:400]}" for h in hits) or "(no hits)"
    check = await structured("detect_conflict", ConflictCheck, knob_schema=KNOB_SCHEMA, star=star_summary(state, s), grade=grade_summary(s),
                             provenance=provenance_text(s.provenance), query=query, hits=hit_lines,
                             tree=tree(state), may_ask=str(may_ask).lower())
    drop_epoch_options(check)
    if check.conflict and (not may_ask or not check.question or len(check.options) < 2):
        demote_to_follow_up(check)
    return check


def drop_epoch_options(check: ConflictCheck) -> None:
    """Training length is fixed: an option (or follow-up) that changes epochs is not offered."""
    changes_epochs = lambda kc: kc is not None and kc.epochs is not None
    leaning = check.options[check.agent_leaning_index] if check.agent_leaning_index in range(len(check.options)) else None
    check.options = [o for o in check.options if not changes_epochs(o.knob_changes)]
    check.agent_leaning_index = check.options.index(leaning) if leaning in check.options else 0
    if check.follow_up and changes_epochs(check.follow_up.knob_changes):
        check.follow_up = None


def demote_to_follow_up(check: ConflictCheck) -> None:
    """No question allowed (one per wave): keep the agent's preferred option as a follow-up for the next wave."""
    check.conflict = False
    if check.follow_up or not check.options:
        return
    index = check.agent_leaning_index if check.agent_leaning_index in range(len(check.options)) else 0
    option = check.options[index]
    check.follow_up = FollowUp(title=option.label, directive=option.directive,
                               parent_star_id=option.parent_star_id, knob_changes=option.knob_changes)


async def replan(state: SessionState, s: Star, kind: str, text: str, plan: str) -> Replan:
    open_proposals = [p.model_dump(include={"id", "title", "knob_changes"}) for p in state.proposals
                      if p.status == "open" and p.wave == state.wave]
    return await structured("replan", Replan, kind=kind, text=text, star=star_summary(state, s), grade=grade_summary(s),
                            plan=plan, wave=str(state.wave), open_proposals=open_proposals or "(none)",
                            tree=tree(state), knob_schema=KNOB_SCHEMA, n=str(s.grade.n if s.grade else 0),
                            max_seeds=str(MAX_SEEDS))


# ---------------------------------------------------------------- explain / abstract

MAX_CHAT_TURNS = 12
# Library hits per (session, star): searched once, then reused for every turn of that star's chat.
_library_hits: dict[tuple[str, str], list[Provenance]] = {}


async def _hits_for(state: SessionState, s: Star) -> list[Provenance]:
    key = (state.id, s.id)
    if key not in _library_hits:
        try:
            _library_hits[key] = await papiers_client.search(s.title[:200])
        except papiers_client.PapiersError:
            return []
    return _library_hits[key]


async def chat(state: SessionState, s: Star, question: str, history: list[ChatTurn]) -> tuple[str, list[Provenance]]:
    """One turn of the human's chat about a star. Stable context first, then the conversation, so OpenAI's prompt
    cache serves the shared prefix on every later turn."""
    compared = ops.star(state, s.parent_id) if s.parent_id else None
    hits = await _hits_for(state, s)
    runs = {"this": [(r.seed, points(r.tta_val_acc or r.val_acc)) for r in s.runs],
            "graded_against": [(r.seed, points(r.tta_val_acc or r.val_acc)) for r in s.parent_runs]}
    turns = "\n".join(f"{'Human' if t.role == 'human' else 'Litmus'}: {t.text}" for t in history[-MAX_CHAT_TURNS:])
    result = await structured("chat_star", Explanation, tree=tree(state), star=star_summary(state, s), knobs=s.knobs.model_dump(),
                              parent=star_summary(state, compared) if compared else "(none: this is the baseline)", runs=runs,
                              provenance=provenance_text(s.provenance),
                              hits="\n".join(f"{h.id} ({h.doc_title}): {h.text[:300]}" for h in hits) or "(none)",
                              history=turns or "(this is the first message)", question=question)
    known = {p.id: p for p in s.provenance + hits}
    return result.answer, [known[i] for i in result.cited_ids if i in known]


async def chat_research(state: SessionState, claims: list[Claim], question: str,
                        history: list[ChatTurn]) -> tuple[str, list[Provenance]]:
    """One turn of the human's chat about the whole research (no star open)."""
    turns = "\n".join(f"{'Human' if t.role == 'human' else 'Litmus'}: {t.text}" for t in history[-MAX_CHAT_TURNS:])
    decisions = [d.model_dump(include={"kind", "star_id", "human_choice", "note"}) for d in state.decisions]
    open_questions = [q.text for q in state.questions if q.status == "open"]
    result = await structured("chat_research", Explanation, goal=state.goal, tree=tree(state), decisions=decisions,
                              questions=open_questions or "(none)", claims=[claim_summary(c) for c in claims],
                              history=turns or "(this is the first message)", question=question)
    known = {p.id: p for s in state.stars for p in s.provenance} | {c.id: c.provenance[0] for c in claims if c.provenance}
    return result.answer, [known[i] for i in result.cited_ids if i in known]


class SuggestedQuestions(BaseModel):
    questions: list[str]


MAX_SUGGESTED = 3
MAX_QUESTION_CHARS = 90


async def suggest_questions(state: SessionState, s: Star | None, asked: list[str]) -> list[str]:
    """The questions the human would most want to ask right now, about the open agent or the whole research."""
    focus = (f"The human has {agent_name(state, s)} ({s.id}) open: ask about that agent." if s and s.parent_id
             else "No agent is open: ask about the research as a whole.")
    result = await structured("suggest_questions", SuggestedQuestions, focus=focus, goal=state.goal, tree=tree(state),
                              questions=[q.text for q in state.questions if q.status == "open"] or "(none)",
                              asked=asked or "(nothing yet)")
    seen = {a.strip().lower() for a in asked}
    out: list[str] = []
    for q in (q.strip() for q in result.questions):
        if q and len(q) <= MAX_QUESTION_CHARS and q.lower() not in seen:
            seen.add(q.lower())
            out.append(q)
    return out[:MAX_SUGGESTED]


class AutoresearchQueries(BaseModel):
    queries: list[str]


class Pick(BaseModel):
    id: str
    why_read: str


class ReadingList(BaseModel):
    intro: str
    picks: list[Pick]


MAX_QUERIES = 2
MAX_READING = 3


async def autoresearch(state: SessionState, s: Star | None, documents: list[Document]) -> tuple[str, list[dict]]:
    """Explore the topic further: search arXiv for papers the human has not read, and pick the few worth reading next."""
    focus = (f"{agent_name(state, s)} ({s.id}): {s.title}" if s and s.parent_id else "the research as a whole")
    drafted = await structured("autoresearch_query", AutoresearchQueries, goal=state.goal, focus=focus, tree=tree(state))
    found: dict[str, arxiv.Paper] = {}
    for query in [q.strip() for q in drafted.queries if q.strip()][:MAX_QUERIES]:
        for paper in await arxiv.search(query):
            found.setdefault(paper.id, paper)
    read = {d.title.strip().lower() for d in documents}
    fresh = [p for p in found.values() if p.title.strip().lower() not in read]
    if not fresh:
        return "I searched arXiv but found nothing new beyond what is already in your library.", []
    results = "\n".join(f"{p.id} | {p.title} | {p.year} | {p.abstract}" for p in fresh)
    picked = await structured("autoresearch_pick", ReadingList, goal=state.goal, focus=focus, tree=tree(state),
                              library=[d.title for d in documents], results=results)
    by_id = {p.id: p for p in fresh}
    papers = [{"title": by_id[k.id].title, "url": by_id[k.id].url, "pdf": by_id[k.id].pdf, "authors": by_id[k.id].authors[:3],
               "year": by_id[k.id].year, "why": k.why_read.strip()} for k in picked.picks if k.id in by_id][:MAX_READING]
    return picked.intro.strip(), papers


CITATION = re.compile(r"\[([A-Za-z0-9_#:\-]+)\]")


async def write_abstract(state: SessionState) -> tuple[str, list[str], list[Provenance]]:
    evidence: dict[str, Provenance] = {}
    for s in state.stars:
        for p in s.provenance:
            evidence.setdefault(p.id, p)
    for q in state.questions:
        for p in q.evidence:
            evidence.setdefault(p.id, p)
    decisions = [d.model_dump(include={"kind", "star_id", "agent_recommendation", "human_choice", "changed_trajectory", "note"})
                 for d in state.decisions]
    mode = ("AUTO MODE: no human made choices in this session; do not credit human judgment."
            if store.config(state.id).get("auto_mode") else "Human-in-the-loop session.")
    draft = await structured("write_abstract", AbstractDraft, goal=state.goal, mode=mode, tree=tree(state), decisions=decisions,
                             evidence="\n".join(f"{p.id} ({p.doc_title or p.kind}): {p.text[:300]}" for p in evidence.values()))
    known = {s.id for s in state.stars} | set(evidence)

    def drop_unknown(text: str) -> str:
        # The model occasionally cites an id we never gave it; a citation must point at real evidence or go.
        return CITATION.sub(lambda m: m.group(0) if m.group(1) in known else "", text)

    text, findings = drop_unknown(draft.text), [drop_unknown(f) for f in draft.findings]
    cited = {m for t in [text, *findings] for m in CITATION.findall(t)}
    return text, findings, [evidence[i] for i in sorted(cited) if i in evidence]
