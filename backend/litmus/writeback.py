"""Findings back to Papiers, two ways.

1. Verdict highlights: each claim Litmus tested gets a highlight over the original passage, coloured by its latest
   verdict, with a note listing every result. The human approves which ones in the UI before anything is written.
2. Export: the full findings as Markdown to paste into a Papiers note (the CLI cannot write notes), which later
   sessions then find with `papiers search`.
"""

from pydantic import BaseModel

from litmus import papiers_client
from litmus.config import EXPORTS_DIR
from litmus.engine.agent import agent_name
from litmus.models import Claim, SessionState, Star

POINTS = 100
INSTRUCTIONS = ("The Papiers CLI cannot write notes, so Litmus exported your findings as Markdown. In Papiers, create a "
                "new note and paste findings.md (or abstract.md). Papiers indexes notes, so the next Litmus session will "
                "find these results when it searches your library.")
# Highlighter tints of the verdict colours, light enough to read the passage through.
VERDICT_COLORS = {"confirmed": "#9fd8a4", "refuted": "#f6a8a0", "inconclusive": "#d6d6de"}
QUOTE_WORDS = 8  # --start / --end: enough words to be unique on the page
PREDICTED = {"improves": "a gain", "hurts": "a loss", "no_effect": "no change"}
SIMULATED = "Litmus demo: simulated results, not real training runs."


def _pts(x: float) -> str:
    return f"{x * POINTS:+.2f}"


def _finding(s: Star, parent: Star | None) -> str:
    g = s.grade
    claims = [p for p in s.provenance if p.kind in ("highlight", "passage", "conversation", "note")]
    claim_line = "; ".join(f"\"{p.text[:220]}\" ({p.doc_title}, {p.id})" for p in claims) or s.hypothesis
    return "\n".join([
        f"### {s.id}: {s.title}",
        f"- **Claim:** {claim_line}",
        f"- **Our test:** changed {s.knob_changes} relative to {parent.id if parent else 'nothing'} "
        f"(predicted: {s.predicted}), {g.n} paired seeds, airbench94 on CIFAR-10.",
        f"- **Result:** {g.mean_child * POINTS:.2f}% vs {g.mean_parent * POINTS:.2f}%, delta {_pts(g.delta)} points, "
        f"95% CI [{_pts(g.ci_low)}, {_pts(g.ci_high)}], p = {g.p_value:.3g}"
        + ("" if g.practical else " (below the 0.05-point practical threshold)"),
        f"- **Verdict:** {g.verdict} (grader {g.grader_version})",
        f"- **What it means:** {s.reflection or '—'}",
    ])


def findings_markdown(state: SessionState) -> str:
    by_id = {s.id: s for s in state.stars}
    graded = [s for s in state.stars if s.grade and s.grade.verdict != "baseline" and s.chosen_by != "shadow"]
    root = state.stars[0] if state.stars else None
    lines = [f"# Litmus findings — {state.goal}", "",
             f"Session `{state.id}` · {len(graded)} graded experiments · GPU {state.budget_used:.0f}s"]
    if root and root.grade:
        lines += ["", f"Baseline {root.id}: {root.grade.mean_child * POINTS:.2f}% "
                      f"(95% CI {root.grade.ci_low * POINTS:.2f}–{root.grade.ci_high * POINTS:.2f}, n={root.grade.n})."]
    lines += ["", "## Findings", ""]
    lines += [_finding(s, by_id.get(s.parent_id)) + "\n" for s in graded]
    shadows = [s for s in state.stars if s.chosen_by == "shadow" and s.grade]
    if shadows:
        lines += ["## What the agent would have found alone (shadow branches)", ""]
        lines += [_finding(s, by_id.get(s.parent_id)) + "\n" for s in shadows]
    human = [d for d in state.decisions if d.changed_trajectory]
    if human:
        lines += ["## Where human judgment changed the course", ""]
        lines += [f"- {d.id} ({d.kind} on {d.star_id}): agent would have chosen **{d.agent_recommendation}**; "
                  f"human chose **{d.human_choice}**. {d.note}" for d in human]
        lines.append("")
    if state.abstract:
        lines += ["## Abstract", "", state.abstract.text, ""]
    return "\n".join(lines)


def abstract_markdown(state: SessionState) -> str:
    if not state.abstract:
        return ""
    return "\n".join([f"# Litmus abstract — {state.goal}", "", state.abstract.text, "", "## Findings", ""]
                     + [f"- {f}" for f in state.abstract.findings])


def export(state: SessionState) -> str:
    """Write exports/<session>/findings.md and abstract.md; return the directory path."""
    directory = EXPORTS_DIR / state.id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "findings.md").write_text(findings_markdown(state))
    (directory / "abstract.md").write_text(abstract_markdown(state))
    return str(directory)


class VerdictHighlight(BaseModel):
    claim_id: str
    doc_id: str
    doc_title: str
    summary: str
    page: int | None
    start: str
    end: str | None
    verdict: str
    color: str
    note: str
    star_ids: list[str]


def _result_line(state: SessionState, s: Star) -> str:
    g = s.grade
    return (f"{agent_name(state, s)} ({s.title}): {g.verdict}, {_pts(g.delta)} pts, 95% CI [{_pts(g.ci_low)}, "
            f"{_pts(g.ci_high)}], {g.n} paired seeds" + (f"; predicted: {PREDICTED[s.predicted]}." if s.predicted else "."))


def verdict_highlights(state: SessionState, claims: list[Claim], simulated: bool) -> list[VerdictHighlight]:
    """One highlight per tested highlight-claim, coloured by the latest verdict on it, its note listing every result."""
    by_claim: dict[str, list[Star]] = {}
    for s in state.stars:
        if s.grade and s.grade.verdict in VERDICT_COLORS and s.chosen_by != "shadow":
            for p in s.provenance:
                if p.kind == "highlight":
                    by_claim.setdefault(p.id, []).append(s)
    highlights = []
    for claim in claims:
        stars = by_claim.get(claim.id)
        if not stars or claim.provenance[0].kind != "highlight":
            continue
        words = claim.text.split()
        long = len(words) > 2 * QUOTE_WORDS
        verdict = stars[-1].grade.verdict
        note = "\n".join([*([SIMULATED] if simulated else []), "Litmus tested this on airbench94, CIFAR-10:",
                          *(f"- {_result_line(state, s)}" for s in stars)])
        highlights.append(VerdictHighlight(
            claim_id=claim.id, doc_id=claim.doc_id, doc_title=claim.doc_title, summary=claim.summary or claim.text[:80],
            page=claim.page, start=" ".join(words[:QUOTE_WORDS]) if long else claim.text,
            end=" ".join(words[-QUOTE_WORDS:]) if long else None,
            verdict=verdict, color=VERDICT_COLORS[verdict], note=note, star_ids=[s.id for s in stars]))
    return highlights


async def write_highlights(highlights: list[VerdictHighlight]) -> list[dict]:
    """Write each approved highlight; one that Papiers refuses (passage not found, no permission) does not stop the rest.
    Raises PapiersUnavailable when the CLI is missing or not answering."""
    results = []
    for h in highlights:
        try:
            await papiers_client.highlight(h.doc_id, h.start, h.end, h.page, h.note, h.color)
            results.append({"claim_id": h.claim_id, "ok": True})
        except papiers_client.PapiersUnavailable:
            raise
        except papiers_client.PapiersError as error:
            results.append({"claim_id": h.claim_id, "ok": False, "error": str(error)})
    return results
