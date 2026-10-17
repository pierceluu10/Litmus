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
   │    └── human actions ──────────┘    → fan-out → branch ×N: run (+fair parent re-run) → grade → reflect
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
cp ../.env.example ../.env   # repo-root .env (backend/.env also read); fill OPENAI_API_KEY, OPENAI_MODEL
uv run litmus --help
```

## Demo runbook (judging)
1. `cd backend && uv run litmus serve` (keep the terminal visible: it logs every engine step).
2. ~2 minutes before judging: `uv run litmus warmup` (or `POST /api/warmup`); `GET /api/health` should show
   `modal_warm, papiers_ok, openai_ok` all true. A container stays warm 10 minutes after its last use.
3. Live session: `POST /api/sessions {"fresh": true}` so every star trains live with epoch progress. Expect
   ~35s to the first proposals (library + baseline), ~1–2 min per wave, ~6 min for 3 waves, ≈300–500 GPU-s
   (≈$0.30 on an A100).
4. If Wi-Fi, Modal, or OpenAI fails: `GET /api/replay/demo` (the UI's "Replay demo") re-streams the recorded
   real session offline, flagged `replay: true`.
5. A crashed or restarted server resumes every unfinished session on startup (verified with `kill -9`).

## Env vars (repo-root `.env` or `backend/.env`, gitignored)
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | LLM calls (structured outputs). `OPENAI_MODEL_NAME` also accepted. |
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

### Grader (`backend/litmus/grader.py`) — LOCKED
- Pure stats, scipy only. Paired t-interval (same seeds), Welch fallback; formulas in the docstring.
- Verdict is relative to the claim's predicted direction (`improves|hurts|no_effect`).
  `PRACTICAL_THRESHOLD=0.0005` (0.05 points) flags significant-but-negligible effects;
  `EQUIVALENCE_MARGIN=0.002` (0.2 points) is how small an effect must surely be to confirm "no effect".
- Baseline star: `baseline_grade` — `ci_low/ci_high` are the CI of its own mean accuracy, not of a delta.
- Never edited by the agent path; bump `GRADER_VERSION` on any change.

### Papiers (`backend/litmus/papiers_client.py`, `backend/litmus/library.py`)
- Real shapes (see `backend/tests/fixtures/papiers/`): `list` → `{items:[{id, kind, title, preview, metadata}]}`;
  `read hl_…` → `items[].content` (highlighted text) and `items[].metadata.annotationText` (the human's note on
  it). The list `preview` is `"<annotation> — <text>"`, so never parse that; read the highlight.
  `search` → `results[]` per document with `evidence[]` (`{kind, id, snippet}`).
- Weights: annotated highlight 3.0 > standalone note / Ask Papiers conversation 2.5 > highlight 2.0
  (+0.25 if a note discusses its doc) > saved-but-unhighlighted doc 0.5. The demo library has 5 documents,
  12 highlights, 6 annotated, 0 standalone notes, 0 conversations (the code handles both).
- Conditions behind each highlight: `papiers read doc --pages N` + LLM (`prompts/extract_conditions.txt`),
  extracted once and cached in `backend/data/library_cache.json`. If Papiers is down, the cache is served.
- **No write-back via CLI**: v0.1.5 has no write command (`supports_write()` checks `papiers help --all`).
  Papiers is a desktop app with no web deep links, so `papiers_url` = the paper's source URL (arXiv).

### Engine (`backend/litmus/engine/`)
```
intake → baseline → propose → select ⟂ → Send(branch)×N → join → propose | abstract
branch subgraph: run → reflect → (run +5 seeds) | (ask ⟂) | END          ⟂ = interrupt()
```
- `graph.py` nodes, `ops.py` every state mutation (+ its event, same sync step), `agent.py` LLM calls with
  validation, `driver.py` runs the graph and applies human actions.
- **Source of truth for data = `store` snapshot** (SQLite `sessions` table). LangGraph state only carries control
  flow; the checkpointer (`data/checkpoints.sqlite`, AsyncSqliteSaver, thread = session id) makes the loop durable.
- Human actions are written to the snapshot first, then `driver.kick()` derives each interrupt's resume value
  from the snapshot (`_resume_values`). So answers that arrive while other branches are still running are
  applied as soon as that superstep ends, and a restarted server resumes exactly where it was.
- A question interrupt pauses only its branch; sibling branches finish (verified in `tests/test_engine.py`).
- Fair comparison: `ops.comparison_knobs` = parent at the child's epochs, unless the change is epochs alone.
- Adaptive seeds: inconclusive + |delta| ≥ 0.05 pts + n < 10 → 5 more paired seeds automatically, explained.
- Refuted → always searches the library; conflicts → one question per wave; answers/feedback land on the
  session `agenda`, and the next `propose` must implement every human agenda item (validated, repaired once).
- Shadow branch: when the human skips the agent's pick, the pick runs as `chosen_by:"shadow"` if budget allows.
- Auto mode dispatches all proposals (≤4) and answers questions with the agent's leaning.
- Limits: 4 branches per wave, 12 research stars, 3 waves (configurable), per-session GPU budget.
- Deviation from the original plan: events are emitted straight to the store (persist + broadcast) instead of
  LangGraph's stream writer, because feedback, shadows, and explain run outside the graph and need the same path.

### API (`backend/litmus/api.py`)
- Implements `shared/contract.md`. `GET /api/sessions/{id}` returns `last_seq`: open the WS with
  `from_seq=last_seq`. WS subscribes before reading the backlog, so nothing is lost between them.
- 404 unknown ids, 409 conflicting actions (bad knob override, skipped proposal, budget), 503 upstream down.
- `tests/test_api.py` validates every emitted event payload against the contract models.

### Abstract, explain, write-back (`engine/agent.py`, `writeback.py`)
- Abstract agent: ~150 words, every sentence cites `[S#][hl_…]`; citations to ids we never gave it are stripped.
- `POST /explain`: star evidence + per-seed numbers + a fresh library search → plain-language answer with provenance.
- Write-back = **export** (CLI is read-only): `backend/exports/<session>/findings.md` + `abstract.md`, also served by
  `GET /api/sessions/{id}/export`; event `papiers.export_ready` tells the UI to show "Add to Papiers" (paste into a
  Papiers note, which Papiers indexes, so later sessions' searches find it). Shadow branches get their own section.

### Replay (`backend/litmus/replay.py`)
- `uv run litmus record-demo <session_id>` writes `shared/demo-session.json` ({snapshot, events}).
- `GET /api/replay/demo?speed=1` creates `rpl_…` and re-emits every recorded event through the same WS
  (gaps capped at 1.5s ÷ speed; `session.started.replay = true`). Mid-replay the snapshot is empty with
  `last_seq: 0` (clients build from events); at the end it becomes the recorded final snapshot. Needs no network.
- Current recording: `ses_74aa24a8f2` — the canonical demo story (mixup refuted at ~10 epochs → library search →
  question → human overrides 20→30 epochs → confirmed +0.22; shadow 20-epoch ghost +0.15).
- `fresh: true` on session create offsets seeds so nothing comes from the cache: every star trains live with
  epoch progress. Use it for live judging.

### Commands
| Command | What |
|---|---|
| `uv run litmus serve` | API + WS on http://localhost:8000 (CORS for :5173) |
| `uv run litmus smoke [--seeds 0 1]` | baseline on Modal, streams epochs |
| `uv run litmus warmup` | start a warm container |
| `uv run litmus library [--refresh]` | ranked claims with notes and conditions |
| `uv run litmus run --auto [--waves N] [--fresh]` | headless end-to-end session, prints the tree |
| `uv run litmus record-demo <session_id>` | save a session to `shared/demo-session.json` |
| `uv run pytest` | tests (CPU only) |

## Gotchas
- One question per wave is enforced by a synchronous re-check right before `add_question` (branches run
  concurrently and the LLM call is an await). A losing branch's idea becomes an agenda follow-up.
- Results are cached by (config hash, seed) **across sessions**: re-running a demo is fast because repeated
  configs replay from cache (events carry `run.cached: true`). Delete `backend/data/litmus.sqlite` results
  table rows for a fully fresh run.
- Local `torch` is a dev dependency for CPU tests only; the server never imports the trainer.
- `train_run` is a generator so per-epoch progress streams live through `remote_gen`.

## Verification log
- 2026-10-16 modal-runner: `uv run litmus smoke --seeds 0 1` → seed 0 tta_val_acc 0.9389, seed 1 0.9401;
  **4.2 GPU-s per seed**, cold start ≈17s (container boot + data load + cudnn warmup), warm ≈4.5s/seed wall.
  All 11 knob variants ran in parallel on 8 containers: e.g. mixup α=0.2 @9.9ep 0.9369, mixup @20ep 0.9457,
  no whitening 0.9284, flip none 0.9338 (single seed each).
- 2026-10-16 papiers-client: `uv run litmus library --refresh` → 5 documents, 12 claims, the 6 annotated
  highlights ranked 1–6, conditions extracted for all 12 in ~10s (e.g. mixup: "200 epochs, PreAct ResNet-18…").
- 2026-10-17 langgraph-engine: `uv run litmus run --auto --waves 2` → real 9-star tree in 4m37s wall, 401 GPU-s:
  S1 mixup α=1 refuted (−1.64 [−2.12, −1.17]), S2 no-TTA confirmed hurts (−0.79), S3 random flip inconclusive
  at n=10 (−0.06 [−0.14, +0.01]), S4 no label smoothing hurts (−0.13), S7 mixup α=0.2 refuted (−0.26),
  S8 no whitening hurts (−1.24); mixup refutation → library search → question → answer → replanned; abstract
  with citations; export written. That run exposed and we fixed: epochs-only children compared with themselves,
  trivial epoch nudges to dodge dedupe, inconclusive results not getting more seeds.
- 2026-10-17 human-loop (scripted human over HTTP against `litmus serve`):
  `ses_4a61ce2ffe` — challenge "I think this is seed noise" on S2 (no TTA) → agent.replanned → 5 more seeds →
  "With 10 seeds, S2 is confirmed: −0.80 [−0.94, −0.66]". Human skipped the agent's pick twice → shadow S7
  (mixup α=0.2 @40 epochs) **confirmed +0.26 [+0.20, +0.32]** vs baseline@40, i.e. the ghost line found
  something the human path didn't. `ses_c39e548c59` — mixup α=1 refuted → library search → question → answer →
  wave 2 implements it (mixup @20 epochs) → wave-2 question → wave 3 (@40 epochs). Found and fixed a race where
  two branches both asked in one wave.
- 2026-10-17 abstract-and-writeback: `POST /api/sessions/ses_4a61ce2ffe/explain {"star_id":"S7"}` → 5.8s, answer
  quotes 94.79→95.05 (+0.26, CI 0.20–0.32) and cites hl_07db… (Bag of Tricks) + hl_50d0… (mixup).
  `GET …/export` → findings Markdown incl. shadow section.
- 2026-10-17 replay + hardening (final code, 3 full runs, 0 server errors):
  1. `ses_74aa24a8f2` (scripted human, fresh seeds): 11 stars, 3 waves; mixup α=1 −1.44 and α=0.2 −0.26 refuted
     at ~10 ep → question → human chose 30 ep over the agent's 20 → **+0.22 [+0.07, +0.37] confirmed**; shadow
     (agent's 20 ep) +0.15. No final-wave question. Recorded as the demo.
  2. `ses_…` second scripted run: α=0.2 mixup @40 ep **+0.33 [+0.17, +0.50]** (replicates), alternating flip
     confirmed without TTA (−0.20 for random).
  3. `ses_065433f008` (auto, fresh): **`kill -9` of the server mid-wave-1 with 4 branches running → restart →
     "recovering session" → finished**, 9 stars, no duplicates.
  Replay: `GET /api/replay/demo?speed=4` re-streamed 1083 events in 14s; final snapshot 11 stars + abstract.

## Frontend
Vite + React 19 + TypeScript (strict), Tailwind v4, `motion`, zustand, d3 (hierarchy/scale/shape). Lives in `frontend/`.

**Run**
```bash
cd frontend && npm install
npm run dev          # http://localhost:5173
npm test             # reducer unit tests
```
`frontend/.env`: `VITE_MOCK=1` (default) simulates the whole backend in the browser; `VITE_MOCK=0` + `VITE_API_URL=http://localhost:8000` talks to the real one. That is the only change needed to switch.

**Folder map** (`frontend/src`)
| Path | What |
|---|---|
| `types.ts` | Contract types, snake_case, mirrors `shared/contract.md` |
| `reducer.ts` | `applyEvent(state, event)`: the one pure reducer. Ignores `seq <= lastSeq`, logs unknown types |
| `store.ts` | zustand store: session state, selection, actions; picks the mock or real `api` |
| `transport/` | `api.ts` interface, `real.ts` (REST + WebSocket, reconnect from last `seq`), `mock.ts` |
| `mock/` | `server.ts` scripted backend (drives the demo tree, answers every action), `library.ts` demo library |
| `lib/` | `format.ts` (labels, colours, effect text), `layout.ts` (deterministic left-to-right tree) |
| `components/` | `StarMap`, `Library`, `Sidebar`, `PathChart`, `Dock` (proposals + question), `Feed`, `Timeline`, `AbstractPanel`, `TopBar`, `Legend`, `Prov` |

**State flow**: `begin()` creates a session, subscribes from `seq 0`, and every event goes through `applyEvent`. The snapshot endpoint is not used for first load because replaying all events rebuilds identical state (see Contract requests).

**Design tokens**: `frontend/src/index.css` (`@theme`). Cream paper background; verdict colours (`confirmed`, `refuted`, `inconclusive`, `baseline`), state colours (`running`, `waiting`), and actor colours (`human`, `agent`) are defined once and used by stars, chips, charts and the legend. Stars are labelled with Greek letters (`S0` = α).

**Animation conventions**: positions ease toward layout targets (new stars grow out of their parent), camera eases with "Follow activity" (any manual pan/zoom turns it off), CSS keyframes for pulse/breathe/bloom/line draw, `motion` for the dock. All motion is disabled under `prefers-reduced-motion`.

**Add an event type**: add a `case` in `reducer.ts`, add a test in `reducer.test.ts`, emit it from `mock/server.ts`, then render it.

**Known gaps**: no "rewind and branch" yet (selection is by star id, so it fits); mock mode does not load `shared/demo-session.json` yet; visual polish pass not done; layout below ~1000px is stacked rather than tuned.

### Contract requests
- `GET /api/sessions/{id}` should include the highest applied `seq`, so a client can load the snapshot and then subscribe from `seq + 1` instead of replaying everything.
