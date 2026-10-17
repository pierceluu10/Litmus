# AGENTS.md — Litmus

Get productive in 5 minutes. Keep this file accurate; update it in the same commit as the change.

## What Litmus is
Litmus turns the claims a human highlighted in research papers (in their **Papiers** library) into real
experiments, runs them with parallel AI agents on **Modal** A100s, grades them with a locked stats
module, and lets the human steer at every branch point. The research is a constellation: each **star**
is a training configuration that was actually run (5+ seeds) and graded; each **line** is one change,
traced to a highlight, note, or human decision. Findings go back to Papiers.

Testbed: Keller Jordan's airbench (≈94% CIFAR-10 in seconds). Built for the Papiers Human-Centred
Autoresearch Challenge, Hack the Valley 11.

## Architecture
```
Papiers CLI ──read──▶ papiers_client ──▶ library context (judgment-weighted claims)
                                              │
FastAPI (REST + WS) ◀──events── LangGraph engine (SQLite checkpoints, thread = session)
   ▲    │                           │  intake → baseline → propose → [interrupt: human selects]
   │    └── human actions ──────────┘    → fan-out → branch ×N: plan → run → grade → reflect
   │        dispatch/answer/feedback        (reflect: library search, question, follow-ups)
   │                                     → join → budget → loop | abstract → write-back
Frontend (React)                 Modal app "litmus": train(knobs, seed) on A100, streams epochs
Grader (pure stats) ◀── seeds ── results (cached by config hash in SQLite)
```

## Repo map
| Path | Owner | What |
|---|---|---|
| `shared/contract.md` | shared | API + event contract. Source of truth. Additive changes only, on `main`. |
| `shared/demo-session.json` | backend | Recorded real session for replay + frontend mock mode. |
| `backend/` | backend agent | Python 3.11 package `litmus` (uv). Frontend agent never edits here. |
| `frontend/` | frontend agent | React + TS + Vite. Backend agent never edits here. |

## Running the backend
```bash
cd backend
uv sync
cp ../.env.example .env   # fill OPENAI_API_KEY, OPENAI_MODEL
uv run litmus --help
```

## Env vars (`backend/.env`, gitignored)
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | LLM calls (structured outputs) |
| `PAPIERS_TOKEN` | Papiers CLI auth (optional if `papiers auth login` was run) |
| `LITMUS_BUDGET_GPU_SECONDS` | default per-session GPU budget |

## Setup facts
- Use `uv` (installed via Homebrew). System Python is 3.9: do not use it.
- `modal` is not on PATH globally: use `uv run modal ...` inside `backend/`. Auth is `~/.modal.toml`.
- Modal workspace `pierceluu10`, Starter plan, 10 concurrent GPUs max.
- Volume `cifar-data` holds `/cifar-10-python.tar.gz` (md5 `c58f30108f718f92721af3b95e74349a`).
  **Never download CIFAR inside Modal** (≈40 KB/s). Mount the volume.
- Papiers CLI `papiers` (npm, v0.1.5) is **read-only**: search, list, read, browse, auth, tokens,
  doctor. There is no write command, so findings are exported as Markdown for manual import.

## Conventions
- Branches: `main` ← `backend` (integration) ← `feat/<feature>`. Feature branches merge into `backend`
  with `--no-ff`. `backend` merges into `main` only when the human says so.
- Contract changes: small `docs(contract): ...` commit on `main`, push, Changelog line.
- Conventional Commits: `feat(modal): ...`, `fix(grader): ...`, `test(papiers): ...`, `docs(agents): ...`.
- Never commit secrets. `.env` is gitignored.

## Backend

### Experiments (`backend/litmus/experiments/`, `backend/litmus/modal_app.py`)
- Trainer = airbench94 **paper version** (`legacy/airbench94.py`, MIT, vendored with attribution in
  `trainer.py` + `LICENSE-airbench`). Chosen over `airbench94_muon.py` because it has no `torch.compile`
  (no autotune warmup) and every paper feature we test is a real hyperparameter there.
- Knobs and **true baseline defaults** (`knobs.py: BASELINE_KNOBS`):
  `label_smoothing=0.2, epochs=9.9, tta_level=2, flip="alternating", mixup_alpha=0, cutout=0,
  lr_scale=1.0, whiten=True, dirac_init=True, translate=2`. Added by us: mixup, cutout, `flip="random"|"none"`,
  `whiten=False` (trainable first conv), `dirac_init=False`. So "label smoothing" tests vary ε around 0.2 and
  "TTA"/"flip"/"whitening" tests are ablations.
- Metric: `tta_val_acc` = final accuracy at the config's own `tta_level` (equals `val_acc` at level 0).
- Modal: deployed app `litmus`, class `Trainer` (`train(knobs, seeds)` generator, `ping()`). Deploy with
  `cd backend && uv run modal deploy litmus/modal_app.py` after changing trainer code. Seeds run sequentially
  per call (one container per branch), `max_containers=8`, `scaledown_window=600`.
- CIFAR is cached as `train.pt`/`test.pt` on the `cifar-data` volume (created on first container start).

### Commands
| Command | What |
|---|---|
| `uv run litmus smoke [--seeds 0 1]` | baseline on Modal, streams epochs |
| `uv run litmus warmup` | start a warm container |
| `uv run pytest` | tests (CPU only) |

## Gotchas
- Local `torch` is a dev dependency for CPU tests only; the server never imports the trainer.
- `train_run` is a generator so per-epoch progress streams live through `remote_gen`.

## Verification log
- 2026-10-16 modal-runner: `uv run litmus smoke --seeds 0 1` → seed 0 tta_val_acc 0.9389, seed 1 0.9401;
  **4.2 GPU-s per seed**, cold start ≈17s (container boot + data load + cudnn warmup), warm ≈4.5s/seed wall.
  All 11 knob variants ran in parallel on 8 containers: e.g. mixup α=0.2 @9.9ep 0.9369, mixup @20ep 0.9457,
  no whitening 0.9284, flip none 0.9338 (single seed each).

## Frontend
(owned by frontend agent)
