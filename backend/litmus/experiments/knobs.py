"""Training knobs: the only things an experiment may change. Dependency-free so the server can import it.

Baseline values are the true defaults of airbench94 (legacy/airbench94.py, the paper version).
"""

import hashlib
import json

BASELINE_KNOBS = {
    "label_smoothing": 0.2,
    "epochs": 9.9,
    "tta_level": 2,
    "flip": "alternating",
    "mixup_alpha": 0.0,
    "cutout": 0,
    "lr_scale": 1.0,
    "whiten": True,
    "dirac_init": True,
    "translate": 2,
}

FLIP_MODES = ("random", "alternating", "none")
DEFAULT_SEEDS = [0, 1, 2, 3, 4]
EXTRA_SEEDS = [5, 6, 7, 8, 9]


def normalize_knobs(knobs: dict) -> dict:
    """Full knob set with canonical types, so 10 and 10.0 epochs are the same config."""
    full = {**BASELINE_KNOBS, **knobs}
    return {k: type(BASELINE_KNOBS[k])(full[k]) for k in BASELINE_KNOBS}


def config_hash(knobs: dict) -> str:
    """Stable id for a full knob set, used to cache (config, seed) results."""
    canonical = json.dumps(normalize_knobs(knobs), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]
