"""Environment config. Reads the repo-root .env (and backend/.env if present)."""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
EXPORTS_DIR = BACKEND_DIR / "exports"
SHARED_DIR = REPO_DIR / "shared"

load_dotenv(BACKEND_DIR / ".env")
load_dotenv(REPO_DIR / ".env")

DEFAULT_BUDGET_GPU_SECONDS = 1800.0


def openai_model() -> str:
    model = os.environ.get("OPENAI_MODEL") or os.environ.get("OPENAI_MODEL_NAME")
    if not model:
        raise RuntimeError("Set OPENAI_MODEL in .env")
    return model


def budget_gpu_seconds() -> float:
    return float(os.environ.get("LITMUS_BUDGET_GPU_SECONDS", DEFAULT_BUDGET_GPU_SECONDS))
