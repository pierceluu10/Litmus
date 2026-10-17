"""The grader: pure statistics, no LLM. LOCKED — the agent path reads its output and never edits it.

Bump GRADER_VERSION on any change to the math or the verdict rules; every star records it.

Accuracies are fractions in [0, 1]. delta = child - parent.

Paired (same seeds for child and parent), d_i = child_i - parent_i:
    d̄ = mean(d),  s_d = sd(d, ddof=1),  se = s_d / √n,  df = n - 1
    CI95 = d̄ ± t(0.975, df) · se,   t = d̄ / se,   p = 2 · (1 - T_df(|t|))

Welch (unpaired fallback):
    se = √(s_c²/n_c + s_p²/n_p)
    df = se⁴ / ((s_c²/n_c)²/(n_c-1) + (s_p²/n_p)²/(n_p-1))
    CI95 = (c̄ - p̄) ± t(0.975, df) · se

Verdicts are relative to the claim's predicted direction:
    improves:  confirmed if ci_low > 0;   refuted if ci_high < 0;   else inconclusive
    hurts:     confirmed if ci_high < 0;  refuted if ci_low > 0;    else inconclusive
    no_effect: confirmed if the whole CI lies inside ±EQUIVALENCE_MARGIN;
               refuted if the CI excludes 0 and |delta| ≥ PRACTICAL_THRESHOLD; else inconclusive
practical = |delta| ≥ PRACTICAL_THRESHOLD, so a significant but negligible effect is flagged.
"""

import math
import statistics

from scipy import stats

GRADER_VERSION = "1.0.0"
CONFIDENCE = 0.95
PRACTICAL_THRESHOLD = 0.0005  # 0.05 accuracy points
EQUIVALENCE_MARGIN = 0.002  # 0.2 points: a "no effect" claim holds if the effect is surely smaller than this
PREDICTIONS = ("improves", "hurts", "no_effect")


def _interval(delta: float, se: float, df: float) -> tuple[float, float, float]:
    """(ci_low, ci_high, p_value) for an estimate with standard error se on df degrees of freedom."""
    if se == 0:
        # Identical differences on every seed: no spread, so the estimate is exact.
        return delta, delta, 1.0 if delta == 0 else 0.0
    half = stats.t.ppf(0.5 + CONFIDENCE / 2, df) * se
    p_value = 2 * stats.t.sf(abs(delta / se), df)
    return delta - half, delta + half, float(p_value)


def verdict(predicted: str, delta: float, ci_low: float, ci_high: float) -> str:
    if predicted == "improves":
        return "confirmed" if ci_low > 0 else "refuted" if ci_high < 0 else "inconclusive"
    if predicted == "hurts":
        return "confirmed" if ci_high < 0 else "refuted" if ci_low > 0 else "inconclusive"
    if predicted == "no_effect":
        if -EQUIVALENCE_MARGIN < ci_low and ci_high < EQUIVALENCE_MARGIN:
            return "confirmed"
        excludes_zero = ci_low > 0 or ci_high < 0
        return "refuted" if excludes_zero and abs(delta) >= PRACTICAL_THRESHOLD else "inconclusive"
    raise ValueError(f"predicted must be one of {PREDICTIONS}, got {predicted!r}")


def grade(parent: list[float], child: list[float], predicted: str, metric: str, paired: bool = True) -> dict:
    """Grade child accuracies against parent accuracies. Returns the contract's Grade dict.

    paired=True requires both lists in the same seed order.
    """
    if predicted not in PREDICTIONS:
        raise ValueError(f"predicted must be one of {PREDICTIONS}, got {predicted!r}")
    if len(parent) < 2 or len(child) < 2:
        raise ValueError(f"need at least 2 runs per side, got parent={len(parent)} child={len(child)}")
    if paired and len(parent) != len(child):
        raise ValueError(f"paired grading needs equal run counts, got {len(parent)} vs {len(child)}")

    mean_parent, mean_child = statistics.fmean(parent), statistics.fmean(child)
    sd_parent, sd_child = statistics.stdev(parent), statistics.stdev(child)
    delta = mean_child - mean_parent
    if paired:
        diffs = [c - p for c, p in zip(child, parent)]
        n = len(diffs)
        ci_low, ci_high, p_value = _interval(delta, statistics.stdev(diffs) / math.sqrt(n), n - 1)
    else:
        n = min(len(parent), len(child))
        vc, vp = sd_child**2 / len(child), sd_parent**2 / len(parent)
        se = math.sqrt(vc + vp)
        df = (vc + vp) ** 2 / (vc**2 / (len(child) - 1) + vp**2 / (len(parent) - 1)) if se else 1.0
        ci_low, ci_high, p_value = _interval(delta, se, df)

    return {
        "metric": metric,
        "mean_parent": mean_parent, "mean_child": mean_child, "delta": delta,
        "sd_parent": sd_parent, "sd_child": sd_child, "n": n,
        "ci_low": ci_low, "ci_high": ci_high, "p_value": p_value,
        "verdict": verdict(predicted, delta, ci_low, ci_high),
        "practical": abs(delta) >= PRACTICAL_THRESHOLD,
        "grader_version": GRADER_VERSION,
    }


def baseline_grade(runs: list[float], metric: str) -> dict:
    """The root star has no parent: report its own mean and spread with verdict "baseline"."""
    mean = statistics.fmean(runs)
    sd = statistics.stdev(runs) if len(runs) > 1 else 0.0
    half = stats.t.ppf(0.5 + CONFIDENCE / 2, len(runs) - 1) * sd / math.sqrt(len(runs)) if len(runs) > 1 else 0.0
    return {
        "metric": metric, "mean_parent": mean, "mean_child": mean, "delta": 0.0,
        "sd_parent": sd, "sd_child": sd, "n": len(runs),
        "ci_low": mean - half, "ci_high": mean + half, "p_value": 1.0,
        "verdict": "baseline", "practical": False, "grader_version": GRADER_VERSION,
    }
