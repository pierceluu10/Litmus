from litmus import writeback
from litmus.experiments.knobs import BASELINE_KNOBS
from litmus.models import Abstract, Decision, Grade, Provenance, SessionState, Star


def star(sid, parent, chosen_by, delta, verdict, **changes):
    g = Grade(metric="tta_val_acc", mean_parent=0.94, mean_child=0.94 + delta, delta=delta, sd_parent=0.001,
              sd_child=0.001, n=5, ci_low=delta - 0.001, ci_high=delta + 0.001, p_value=0.01, verdict=verdict,
              practical=abs(delta) >= 0.0005, grader_version="1.0.0")
    return Star(id=sid, parent_id=parent, depth=1 if parent else 0, title=f"title {sid}", hypothesis="h",
                knobs={**BASELINE_KNOBS, **changes}, knob_changes=changes, chosen_by=chosen_by, grade=g,
                predicted="improves", reflection=f"meaning {sid}",
                provenance=[Provenance(kind="highlight", id=f"hl_{sid}", doc_title="Paper", text=f"claim {sid}")])


def test_findings_cover_research_shadow_human_and_abstract(tmp_path, monkeypatch):
    state = SessionState(id="ses_t", goal="goal", budget_total=100, stars=[
        star("S0", None, "agent", 0.0, "baseline"),
        star("S1", "S0", "human", -0.0164, "refuted", mixup_alpha=1.0),
        star("S2", "S0", "shadow", 0.0026, "confirmed", mixup_alpha=0.2, epochs=40),
    ], decisions=[Decision(id="D1", star_id="S0", kind="dispatch", agent_recommendation="Mixup 40ep",
                           human_choice="Mixup α=1", changed_trajectory=True, note="skipped")],
        abstract=Abstract(text="We found [S1][hl_S1].", findings=["S1 refuted [S1]"], citations=[]))
    md = writeback.findings_markdown(state)
    print(md)
    assert "### S1: title S1" in md and "-1.64 points" in md and "[-1.74, -1.54]" in md and "refuted" in md
    assert "\"claim S1\" (Paper, hl_S1)" in md and "meaning S1" in md
    assert md.index("shadow branches") < md.index("### S2")  # shadow kept apart from the human-guided path
    assert "agent would have chosen **Mixup 40ep**; human chose **Mixup α=1**" in md
    assert "We found [S1][hl_S1]." in md
    monkeypatch.setattr(writeback, "EXPORTS_DIR", tmp_path)
    path = writeback.export(state)
    assert (tmp_path / "ses_t" / "findings.md").read_text() == md
    assert "- S1 refuted [S1]" in (tmp_path / "ses_t" / "abstract.md").read_text() and path.endswith("ses_t")
