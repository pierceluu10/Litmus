import math

import pytest

from litmus.grader import GRADER_VERSION, baseline_grade, grade, verdict

PARENT = [0.940, 0.938, 0.941, 0.939, 0.942]
CHILD = [0.942, 0.941, 0.942, 0.941, 0.945]


def test_paired_worked_example_matches_hand_computation():
    # By hand: d = [.002, .003, .001, .002, .003], d̄ = .0022
    # Σ(d - d̄)² = (.04 + .64 + 1.44 + .04 + .64)e-6 = 2.8e-6 → s_d = √(2.8e-6 / 4) = 8.3666e-4
    # se = s_d / √5 = 3.7417e-4; t(.975, 4) = 2.776445 → half-width = 1.03887e-3
    # CI = [1.16113e-3, 3.23887e-3]; t = .0022 / 3.7417e-4 = 5.8797 → p(two-sided, df=4) ≈ 0.00418
    g = grade(PARENT, CHILD, "improves", "tta_val_acc")
    print(g)
    assert g["delta"] == pytest.approx(0.0022, abs=1e-12)
    assert g["ci_low"] == pytest.approx(1.16113e-3, abs=1e-7)
    assert g["ci_high"] == pytest.approx(3.23887e-3, abs=1e-7)
    assert g["p_value"] == pytest.approx(0.00418, abs=5e-5)
    assert g["sd_parent"] == pytest.approx(math.sqrt(10e-6 / 4), rel=1e-6)  # devs 0,-2,1,-1,2 (e-3)
    assert g["n"] == 5 and g["metric"] == "tta_val_acc" and g["grader_version"] == GRADER_VERSION
    assert g["verdict"] == "confirmed" and g["practical"] is True


def test_pairing_matters_vs_welch():
    # Seed-to-seed noise is large but the paired difference is consistent: paired is decisive, Welch is not.
    parent = [0.930, 0.945, 0.935, 0.950, 0.940]
    child = [p + 0.001 for p in parent]
    assert grade(parent, child, "improves", "val_acc")["verdict"] == "confirmed"
    welch = grade(parent, child, "improves", "val_acc", paired=False)
    print(welch)
    assert welch["verdict"] == "inconclusive"


def test_direction_rules():
    assert verdict("improves", -0.003, -0.004, -0.001) == "refuted"
    assert verdict("improves", 0.0005, -0.001, 0.002) == "inconclusive"
    assert verdict("hurts", -0.003, -0.004, -0.001) == "confirmed"
    assert verdict("hurts", 0.003, 0.001, 0.004) == "refuted"
    assert verdict("no_effect", 0.0002, -0.001, 0.0015) == "confirmed"
    assert verdict("no_effect", 0.003, 0.002, 0.004) == "refuted"
    assert verdict("no_effect", 0.0001, -0.003, 0.003) == "inconclusive"


def test_significant_but_negligible_is_flagged_not_practical():
    parent = [0.9400, 0.9410, 0.9420, 0.9430, 0.9440]
    child = [p + 0.0002 + j * 1e-6 for j, p in enumerate(parent)]
    g = grade(parent, child, "improves", "val_acc")
    assert g["verdict"] == "confirmed" and g["practical"] is False


def test_identical_differences_do_not_divide_by_zero():
    g = grade([0.94, 0.95], [0.95, 0.96], "improves", "val_acc")
    assert g["ci_low"] == pytest.approx(0.01) and g["p_value"] == 0.0 and g["verdict"] == "confirmed"


def test_invalid_inputs_raise():
    with pytest.raises(ValueError):
        grade([0.9], [0.9], "improves", "val_acc")
    with pytest.raises(ValueError):
        grade(PARENT, CHILD[:4], "improves", "val_acc")
    with pytest.raises(ValueError):
        grade(PARENT, CHILD, "better", "val_acc")


def test_baseline_grade():
    g = baseline_grade(PARENT, "tta_val_acc")
    assert g["verdict"] == "baseline" and g["ci_low"] < g["mean_child"] < g["ci_high"]
