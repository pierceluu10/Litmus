"""Findings back to Papiers. The installed CLI is read-only, so we export Markdown the human pastes into a
Papiers note (notes render Markdown); once there, future sessions find these findings with `papiers search`.
"""

from litmus.config import EXPORTS_DIR
from litmus.models import SessionState, Star

POINTS = 100
INSTRUCTIONS = ("The Papiers CLI is read-only, so Litmus exported your findings as Markdown. In Papiers, create a new "
                "note and paste findings.md (or abstract.md). Papiers indexes notes, so the next Litmus session will "
                "find these results when it searches your library.")


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
