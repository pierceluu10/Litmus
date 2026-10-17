"""Pydantic models mirroring shared/contract.md exactly. The contract is the source of truth."""

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from litmus.experiments.knobs import BASELINE_KNOBS, FLIP_MODES

Prediction = Literal["improves", "hurts", "no_effect"]
Verdict = Literal["confirmed", "refuted", "inconclusive", "baseline"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Provenance(BaseModel):
    kind: Literal["highlight", "note", "conversation", "passage", "document", "search", "human"]
    id: str
    doc_id: str | None = None
    doc_title: str | None = None
    text: str
    papiers_url: str | None = None


class Document(BaseModel):
    id: str
    title: str
    authors: list[str] = []
    year: int | None = None
    url: str | None = None
    highlight_count: int = 0
    note_count: int = 0
    papiers_url: str | None = None


class Claim(BaseModel):
    id: str
    text: str
    doc_id: str
    doc_title: str
    annotation: str | None = None
    weight: float
    rank: int = 0
    conditions: str | None = None
    page: int | None = None
    provenance: list[Provenance]


class Knobs(BaseModel):
    label_smoothing: float = Field(BASELINE_KNOBS["label_smoothing"], ge=0, le=0.5)
    epochs: float = Field(BASELINE_KNOBS["epochs"], ge=1, le=40)
    tta_level: Literal[0, 1, 2] = BASELINE_KNOBS["tta_level"]
    flip: Literal[FLIP_MODES] = BASELINE_KNOBS["flip"]  # type: ignore[valid-type]
    mixup_alpha: float = Field(BASELINE_KNOBS["mixup_alpha"], ge=0, le=2)
    cutout: int = Field(BASELINE_KNOBS["cutout"], ge=0, le=16)
    lr_scale: float = Field(BASELINE_KNOBS["lr_scale"], ge=0.1, le=3)
    whiten: bool = BASELINE_KNOBS["whiten"]
    dirac_init: bool = BASELINE_KNOBS["dirac_init"]
    translate: int = Field(BASELINE_KNOBS["translate"], ge=0, le=4)


def apply_changes(knobs: dict, changes: dict) -> dict:
    """Validated full knob dict = knobs with changes applied. Raises pydantic.ValidationError on bad values."""
    return Knobs(**{**knobs, **changes}).model_dump()


class Proposal(BaseModel):
    id: str
    star_id: str
    title: str
    hypothesis: str
    predicted: Prediction
    knob_changes: dict[str, Any]
    condition_notes: str
    provenance: list[Provenance]
    agent_recommended: bool
    status: Literal["open", "dispatched", "skipped"] = "open"


class RunResult(BaseModel):
    seed: int
    val_acc: float
    tta_val_acc: float | None = None
    time_seconds: float


class Grade(BaseModel):
    metric: Literal["val_acc", "tta_val_acc"]
    mean_parent: float
    mean_child: float
    delta: float
    sd_parent: float
    sd_child: float
    n: int
    ci_low: float
    ci_high: float
    p_value: float
    verdict: Verdict
    practical: bool
    grader_version: str


class Progress(BaseModel):
    seed: int
    epoch: int
    val_acc: float


class Star(BaseModel):
    id: str
    parent_id: str | None
    depth: int
    title: str
    hypothesis: str
    knobs: Knobs
    knob_changes: dict[str, Any]
    provenance: list[Provenance]
    chosen_by: Literal["human", "agent", "auto", "shadow"]
    status: Literal["queued", "running", "done", "failed", "waiting"] = "queued"
    predicted: Prediction | None = None
    proposal_id: str | None = None
    shadow_of: str | None = None
    progress: list[Progress] = []
    runs: list[RunResult] = []
    parent_runs: list[RunResult] = []
    grade: Grade | None = None
    reflection: str | None = None
    error: str | None = None
    created_at: str = Field(default_factory=now_iso)
    finished_at: str | None = None


class QuestionOption(BaseModel):
    id: str
    label: str
    consequence: str


class Answer(BaseModel):
    option_id: str
    comment: str | None = None


class Question(BaseModel):
    id: str
    star_id: str
    text: str
    evidence: list[Provenance]
    options: list[QuestionOption]
    agent_leaning: str | None = None
    status: Literal["open", "answered"] = "open"
    answer: Answer | None = None


class Decision(BaseModel):
    id: str
    star_id: str
    kind: Literal["dispatch", "answer", "feedback"]
    agent_recommendation: str
    human_choice: str
    agent_recommendation_ids: list[str] = []
    human_choice_ids: list[str] = []
    changed_trajectory: bool
    note: str = ""
    created_at: str = Field(default_factory=now_iso)


class Abstract(BaseModel):
    text: str
    findings: list[str]
    citations: list[Provenance]


class SessionState(BaseModel):
    id: str
    goal: str
    status: Literal["running", "paused", "waiting_human", "done"] = "running"
    stars: list[Star] = []
    proposals: list[Proposal] = []
    questions: list[Question] = []
    decisions: list[Decision] = []
    abstract: Abstract | None = None
    budget_used: float = 0.0
    budget_total: float
    replay: bool = False
    created_at: str = Field(default_factory=now_iso)


EventType = Literal[
    "session.started", "library.loaded", "agent.thinking", "proposals.ready", "human.dispatched",
    "star.created", "experiment.started", "experiment.progress", "experiment.run_done", "star.graded",
    "star.updated", "star.failed", "library.search", "question.asked", "question.answered",
    "feedback.received", "agent.replanned", "shadow.created", "abstract.ready", "papiers.written",
    "papiers.export_ready", "budget.updated", "session.status", "error",
]


class Event(BaseModel):
    seq: int
    ts: str
    session_id: str
    type: EventType
    payload: dict[str, Any]
