"""The LLM side of the scientist. Every call is a structured output that code then validates: ids must exist,
knob changes must pass the knob schema, and numbers always come from the grader, never from the model.
"""

import re
from typing import Literal

from pydantic import BaseModel, ValidationError

from litmus import papiers_client, store
from litmus.engine import ops
from litmus.experiments.knobs import BASELINE_KNOBS, config_hash
from litmus.llm import structured
from litmus.models import Claim, Proposal, Provenance, SessionState, Star, apply_changes

MAX_PROPOSALS = 4
MAX_SEEDS = 10
MIN_EPOCH_CHANGE = 2
POINTS = 100  # grader works in fractions; prompts and prose use accuracy points

KNOB_SCHEMA = {
    "label_smoothing": f"float 0..0.5 (baseline {BASELINE_KNOBS['label_smoothing']})",
    "epochs": f"float 1..40 (baseline {BASELINE_KNOBS['epochs']})",
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
    agent_recommended: bool


class ProposalSet(BaseModel):
    thinking: str
    recommendation_reason: str
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


def star_summary(s: Star) -> dict:
    return {"id": s.id, "parent": s.parent_id, "title": s.title, "status": s.status, "chosen_by": s.chosen_by,
            "knob_changes": s.knob_changes, "predicted": s.predicted, "grade": grade_summary(s),
            "reflection": s.reflection, "error": s.error}


def tree(state: SessionState) -> list[dict]:
    return [star_summary(s) for s in state.stars]


def claim_summary(c: Claim) -> dict:
    return {"id": c.id, "rank": c.rank, "paper": c.doc_title, "claim": c.text[:400], "human_note": c.annotation,
            "conditions": c.conditions}


def provenance_text(items: list[Provenance]) -> list[dict]:
    return [{"kind": p.kind, "id": p.id, "paper": p.doc_title, "text": p.text[:400]} for p in items]


def _changes(knob_changes: KnobChanges | None) -> dict:
    return knob_changes.changes() if knob_changes else {}


# ---------------------------------------------------------------- propose

def _validate_proposals(drafts: ProposalSet, state: SessionState, claims: dict[str, Claim], slots: int) -> tuple[list[Proposal], list[str]]:
    """Valid proposals and the problems found (unknown ids, invalid knobs, duplicates, no-op changes)."""
    problems, proposals, seen = [], [], set()
    agenda = {a.id: a for a in state.agenda}
    star_ids = {s.id for s in state.stars if s.status == "done"}
    base = len(state.proposals)
    for draft in drafts.proposals[:MAX_PROPOSALS]:
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
        if "epochs" in changes and abs(changes["epochs"] - parent.knobs.epochs) < MIN_EPOCH_CHANGE:
            problems.append(f"'{draft.title}': an epoch change under {MIN_EPOCH_CHANGE} is a near-duplicate; "
                            "more seeds on an existing star happen automatically, never via a new proposal")
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
            id=f"P{base + len(proposals) + 1}", star_id=parent.id, parent_star_id=parent.id, title=draft.title,
            hypothesis=draft.hypothesis, predicted=draft.predicted, knob_changes=changes,
            condition_notes=draft.condition_notes, provenance=provenance, agent_recommended=draft.agent_recommended,
            wave=state.wave,
        ))
    required = {a.id for a in state.agenda if not a.consumed and a.source in ("answer", "feedback")}
    implemented = {aid for d in drafts.proposals for aid in d.agenda_ids}
    for aid in required - implemented:
        problems.append(f"agenda item {aid} ({agenda[aid].text[:80]}) from the human is not implemented by any proposal")
    proposals = proposals[:max(slots, 2)]
    if sum(p.agent_recommended for p in proposals) != 1 and proposals:
        first = next((p for p in proposals if p.agent_recommended), proposals[0])
        for p in proposals:
            p.agent_recommended = p is first
    return proposals, problems


async def propose(state: SessionState, claims: list[Claim], instruction: str | None, max_waves: int, slots: int) -> tuple[list[Proposal], str]:
    """2-4 validated proposals grounded in the library and agenda. Repairs once with the problems listed."""
    by_id = {c.id: c for c in claims}
    open_agenda = [a.model_dump(include={"id", "source", "star_id", "text", "knob_changes", "parent_star_id"})
                   for a in state.agenda if not a.consumed]
    values = dict(goal=state.goal, wave=str(state.wave), max_waves=str(max_waves), slots=str(slots),
                  knob_schema=KNOB_SCHEMA, claims=[claim_summary(c) for c in claims], tree=tree(state),
                  agenda=open_agenda or "(empty)", instruction=instruction or "(none)", max_proposals=str(MAX_PROPOSALS))
    drafts = await structured("propose", ProposalSet, **values)
    proposals, problems = _validate_proposals(drafts, state, by_id, slots)
    if problems or len(proposals) < 2:
        repair = dict(values, instruction=(values["instruction"] + "\n\nYOUR PREVIOUS PROPOSALS HAD PROBLEMS, FIX THEM:\n- "
                                          + "\n- ".join(problems or ["fewer than 2 valid proposals"])))
        drafts = await structured("propose", ProposalSet, **repair)
        proposals, problems = _validate_proposals(drafts, state, by_id, slots)
    if len(proposals) < 1:
        raise ProposalError("; ".join(problems) or "no valid proposals")
    return proposals, f"{drafts.thinking} I'd pick \"{next(p.title for p in proposals if p.agent_recommended)}\": {drafts.recommendation_reason}"


# ---------------------------------------------------------------- reflect / conflicts

async def reflect(state: SessionState, s: Star, conditions: str, budget_left: float) -> Reflection:
    return await structured("reflect", Reflection, star=star_summary(s), grade=grade_summary(s),
                            provenance=provenance_text(s.provenance), conditions=conditions or "(unknown)",
                            tree=tree(state), n=str(s.grade.n if s.grade else 0), max_seeds=str(MAX_SEEDS),
                            budget_left=f"{budget_left:.0f}")


async def detect_conflict(state: SessionState, s: Star, query: str, hits: list[Provenance], may_ask: bool) -> ConflictCheck:
    hit_lines = "\n".join(f"{h.id} ({h.doc_title}): {h.text[:400]}" for h in hits) or "(no hits)"
    check = await structured("detect_conflict", ConflictCheck, knob_schema=KNOB_SCHEMA, star=star_summary(s), grade=grade_summary(s),
                             provenance=provenance_text(s.provenance), query=query, hits=hit_lines,
                             tree=tree(state), may_ask=str(may_ask).lower())
    if check.conflict and (not may_ask or not check.question or len(check.options) < 2):
        demote_to_follow_up(check)
    return check


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
    return await structured("replan", Replan, kind=kind, text=text, star=star_summary(s), grade=grade_summary(s),
                            plan=plan, wave=str(state.wave), open_proposals=open_proposals or "(none)",
                            tree=tree(state), knob_schema=KNOB_SCHEMA, n=str(s.grade.n if s.grade else 0),
                            max_seeds=str(MAX_SEEDS))


# ---------------------------------------------------------------- explain / abstract

async def explain(state: SessionState, s: Star, question: str) -> tuple[str, list[Provenance]]:
    parent = ops.star(state, s.parent_id) if s.parent_id else None
    query = f"{s.title} {question}"[:200]
    try:
        hits = await papiers_client.search(query)
    except papiers_client.PapiersError:
        hits = []
    runs = {"child": [(r.seed, points(r.tta_val_acc or r.val_acc)) for r in s.runs],
            "parent": [(r.seed, points(r.tta_val_acc or r.val_acc)) for r in s.parent_runs]}
    result = await structured("explain_star", Explanation, question=question, star=star_summary(s),
                              parent=star_summary(parent) if parent else "(none: this is the baseline)",
                              grade=grade_summary(s), runs=runs, provenance=provenance_text(s.provenance),
                              hits="\n".join(f"{h.id} ({h.doc_title}): {h.text[:300]}" for h in hits) or "(none)")
    known = {p.id: p for p in s.provenance + hits}
    return result.answer, [known[i] for i in result.cited_ids if i in known]


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
