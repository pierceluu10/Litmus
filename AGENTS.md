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
   ▲    │                           │  intake → baseline → [interrupt: human picks claims] → Litmus drafts tests
   │    └── human actions ──────────┘    → fan-out → agent ×N: run (+fair parent re-run) → grade → reflect
   │   start/dispatch/answer/feedback       (reflect: library search, question) → suggest (its own card)
   │                                     → join → Litmus fills gaps → loop | Litmus writes abstract → write-back
Frontend (React)                 Modal app "litmus": train(knobs, seed) on A100, streams epochs
Grader (pure stats) ◀── seeds ── results (cached by config hash in SQLite)
```

## Repo map
| Path | Owner | What |
|---|---|---|
| `shared/contract.md` | shared | API + event contract. Source of truth. Additive changes only, on `main`. |
| `shared/demo-session.json` | backend | Recorded real session for replay; calibrates the frontend's demo backend. |
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
0. `./dev.sh` from the repo root starts backend + frontend together (or run steps 1–2 by hand).
1. `cd backend && uv run litmus serve` (keep the terminal visible: it logs every engine step).
2. ~2 minutes before judging: `uv run litmus warmup` (or `POST /api/warmup`); `GET /api/health` should show
   `modal_warm, papiers_ok, openai_ok` all true. A container stays warm 10 minutes after its last use.
3. Live session: `POST /api/sessions {"fresh": true}` so every star trains live with epoch progress. Expect
   ~35s to the first proposals (library + baseline), ~1–2 min per wave, ~6 min for 3 waves, ≈300–500 GPU-s
   (≈$0.30 on an A100).
4. If Wi-Fi, Modal, or OpenAI fails: `GET /api/replay/demo` (not a button in the UI; the endpoint stays for the judging fallback) re-streams the recorded
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
- Papiers CLI `papiers` v0.1.6 (installed from the Papiers release tarball while npm is locked; checked: no install
  scripts, talks only to api.papiers.ai) reads and also writes: `highlight` and `import`/`import-status`. Each write needs
  its permission on the token ("Allow highlights", "Allow document imports"). It has no note command, so the full
  findings are still exported as Markdown.

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
- Summaries: one LLM call (`prompts/summarize_claims.txt`) titles every claim in 3–7 words (`Claim.summary`), cached
  in `library_cache.json` and rewritten only when the highlight or its note changes.
- `GET /api/library/stream` (SSE) reads Papiers live in stages (papers → highlights → notes → summaries) so the UI can
  show progress; the frontend calls it on every workspace launch, in the demo too.
- A `PAPIERS_TOKEN` in `.env` overrides `papiers auth login`; a revoked token fails every call with 401
  `auth_invalid` (the library then falls back to the cache), so leave it unset if you are logged in.
- Papiers.app registers `papiers://highlight/<uuid>` deep links, but the CLI only exposes public ids (`hl_…`), not
  those uuids, so "Source" links to the paper's URL.
- `POST /api/library/connect {token}`: a user's own Papiers token, checked with one `papiers list` call and then kept in
  memory (`papiers_client._token`, passed to every CLI call as `PAPIERS_TOKEN`; never logged or stored); 401 when Papiers
  rejects it (the previous login stays), 503 when the CLI is missing or times out.
- `POST /api/library/import {documents, claims}`: the next session created works from this library instead of Papiers
  (`SessionState.library`; `library.session_library(state)` is what the engine, `/start` and `/pivot` read). The sign-in
  page sends the highlights that match the person's topic. One pending import per server (fine for one person at a time).
- **Writes only after the human approves** (the CLI's own rule). **Verdict highlights** (`writeback.verdict_highlights`,
  `POST …/papiers/highlights`, demo `POST /api/demo/highlights`): one new highlight per tested highlight-claim over the
  same passage (`--start`/`--end` = its first/last `QUOTE_WORDS` words, `--pages` its page), tinted by the latest
  verdict on it (`VERDICT_COLORS`), with a note listing every result (agent, delta, CI, seeds, what was predicted). The
  call previews first; the top bar's **Highlight in Papiers** panel (`PapiersHighlights.tsx`) shows each note, the human
  unticks any, then writes. Demo results are simulated but the library is real, so each demo note starts with
  `writeback.SIMULATED`. A passage Papiers cannot find is reported per claim and does not stop the rest. **Import**:
  autoresearch's paper cards have **Add to Papiers** (`POST /api/papiers/import` with the arXiv PDF, then polls
  `import-status` every 2 s for up to 90 s).
  Papiers is a desktop app with no web deep links, so `papiers_url` = the paper's source URL (arXiv).

### Engine (`backend/litmus/engine/`)
```
intake → baseline → start ⟂ → select → Send(branch)×N → join → propose → select ⟂ … | abstract
branch subgraph (one agent): run → reflect → (run +5 seeds) | (ask ⟂ → suggest) | suggest → END     ⟂ = interrupt()
```
- **Litmus vs agents** (user decision, 2026-10-17): Litmus is the lead researcher. It drafts the first test from the
  one claim the human picked ("Where should we start?", `POST /start`), plans only when no agent left an open option or a
  human answer/feedback went unimplemented (`propose`), answers the chat, and writes the abstract, always from the
  whole tree. Each star has its own agent (`agent.agent_name`: "Smoothing agent", …). After its verdict the agent
  `suggest`s 1–3 next steps and a first-person `Star.suggestion`, reading its generation's siblings and the options
  other agents already offered, and must implement any human answer about its star. Its card ("Where should I
  proceed?") appears at once; a pick made mid-wave queues for the next wave (`ops.target_wave`), because LangGraph
  supersteps are a barrier anyway. Choosing from a card skips that card's other options only; finishing closes all cards.
  `POST /pivot {claim_id}` turns a claim no star has tested into a new agent from the baseline (`graph.open_claim`, shared
  with the start), queued like any other mid-wave pick.
- `graph.py` nodes, `ops.py` every state mutation (+ its event, same sync step), `agent.py` LLM calls with
  validation, `driver.py` runs the graph and applies human actions.
- **Source of truth for data = `store` snapshot** (SQLite `sessions` table). LangGraph state only carries control
  flow; the checkpointer (`data/checkpoints.sqlite`, AsyncSqliteSaver, thread = session id) makes the loop durable.
- Human actions are written to the snapshot first, then `driver.kick()` derives each interrupt's resume value
  from the snapshot (`_resume_values`). So answers that arrive while other branches are still running are
  applied as soon as that superstep ends, and a restarted server resumes exactly where it was.
- A question interrupt pauses only its branch; sibling branches finish (verified in `tests/test_engine.py`).
- **Training length is fixed** (user decision, 2026-10-18): every star trains the baseline's 9.9 epochs, so every
  comparison is apples to apples. `epochs` is not in the knob menu the LLM sees, `_validate_proposals` rejects any
  proposal that changes it (one repair round), and `drop_epoch_options` removes question options and follow-ups that
  do. "Needs longer training" claims are tested at their gentlest fixed-length form (e.g. mixup α=0.2) or dropped.
- Fair comparison: `ops.comparison_knobs` = parent at the child's epochs, unless the change is epochs alone (legacy:
  with fixed epochs the parent re-runs as it was).
- Adaptive seeds: inconclusive + |delta| ≥ 0.05 pts + n < 10 → 5 more paired seeds automatically, explained.
- Refuted → always searches the library; conflicts → one question per wave; answers/feedback land on the
  session `agenda`; the agent whose star it is implements them in its card, and Litmus's `propose` implements any
  left over (validated, repaired once).
- No agent's pick and no shadow branches (user decision, 2026-10-17): only what the human chose runs. `chosen_by:"shadow"`, `shadow.created` and `Proposal.agent_recommended` stay in the contract (additive only) but are never emitted or true.
- Auto mode starts from the top claim, runs each agent's first option (≤4), and answers questions with the agent's leaning.
- Limits: 4 branches per wave, 12 research stars, 3 waves (configurable), per-session GPU budget.
- Deviation from the original plan: events are emitted straight to the store (persist + broadcast) instead of
  LangGraph's stream writer, because feedback, shadows, and explain run outside the graph and need the same path.

### API (`backend/litmus/api.py`)
- Implements `shared/contract.md`. `GET /api/sessions/{id}` returns `last_seq`: open the WS with
  `from_seq=last_seq`. WS subscribes before reading the backlog, so nothing is lost between them.
- 404 unknown ids, 409 conflicting actions (bad knob override, skipped proposal, budget), 503 upstream down.
- `tests/test_api.py` validates every emitted event payload against the contract models.

### Abstract, explain, write-back (`engine/agent.py`, `writeback.py`)
- Chat (`POST /explain` with `history`): one turn of the human's chat, about a star (`prompts/chat_star.txt`) or, with no
  `star_id`, the research as a whole (`prompts/chat_research.txt`: tree, decisions, open questions, the session's claims).
- **Autoresearch** (`POST /autoresearch {star_id?}`, `agent.autoresearch`, `litmus/arxiv.py`): Litmus's "Explore this topic
  further", always offered in the chat in both modes. One cheap call (`autoresearch_query`, effort none) writes 2 arXiv
  queries naming the technique; the public arXiv API (no key) returns candidates; papers already in the library are
  dropped; `autoresearch_pick` (effort low) chooses up to 3 with one sentence each on why to read it. Ids the model
  invents are dropped. It adds reading to the human's loop: the papers are for them to read.
- **Demo mode chats for real**: `POST /api/demo/explain|questions|autoresearch` take the in-browser session's snapshot
  (`{session, star_id?, ...}`) and run the same Litmus calls on it, nothing stored; the demo backend (`transport/mock.ts`)
  falls back to its offline answers when the backend is unreachable. Demo mode is the main way to show Litmus without
  GPU time: experiments are simulated, Litmus is the real LLM.
- Suggested questions (`POST /questions {star_id?, asked}`, `prompts/suggest_questions.txt`, effort `none`): the 3 questions
  the human would most want to ask now, about the open agent or the whole research; deduped, capped, never one already asked.
- Chat about a star: context is
  the tree, the star's knobs, per-seed runs, claims and library hits (searched once per star, then reused).
- OpenAI: per-prompt reasoning effort in `llm.py` `EFFORT` (titles and conditions `none`, chat and conflict checks
  `low`, planning and abstract at the model default); every call logs latency, input, cached, output and reasoning
  tokens (`llm <prompt> …` in the server log). Automatic prompt caching only hit on byte-identical prompts on
  gpt-5.6-luna (2026-10-17), not on a shared prefix with a different ending, so no `prompt_cache_key` is set.
- Abstract (Litmus, `write_abstract.txt`): ~150 words, every sentence cites `[S#][hl_…]`; citations to ids we never gave it are stripped.
- `POST /explain`: star evidence + per-seed numbers + a fresh library search → plain-language answer with provenance.
- Write-back = verdict highlights (above) + **export** (the CLI cannot write notes): `backend/exports/<session>/findings.md` + `abstract.md`, also served by
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

- 2026-10-17 live end to end (`ses_da44e38d8c`, fresh seeds, topic-filtered import of 3 mixup claims): baseline 94.07 →
  Mixup agent α=1 **refuted −1.48 [−1.79, −1.17]** → library search → LLM question with 3 options → answered → the agent
  turned it into a 20-epoch α=0.2 option → dispatched → **inconclusive +0.06 [−0.02, +0.15] at n=10** (adaptive seeds).
  Generated questions named the real numbers ("Why did Mixup lose 1.48 points at 10 epochs?"); the whole-research chat and
  the abstract cited the real stars and highlights. 204.5 GPU-s.

## Frontend
Vite + React 19 + TypeScript (strict), Tailwind v4, three.js via `@react-three/fiber` + `drei`, `motion`, zustand, d3 (scale/shape), Geist + Geist Mono (self-hosted via `@fontsource-variable`). Lives in `frontend/`.

**Run**
```bash
cd frontend && npm install
npm run dev          # http://localhost:5173
npm test             # reducer, layout, simulator + grader-port tests
```
**Live by default, Demo mode on a switch** (user decision, 2026-10-17): the front page's nav has a **Demo mode** switch at the top right (remembered in `localStorage` as `litmus.demo`; `?demo=1` also turns it on). The guided tutorial was removed. Off, it is the real backend at `VITE_API_URL` (default `http://localhost:8000`), sessions created with `fresh: true` so every star trains live on Modal; the front page shows Modal/Papiers/OpenAI health. The practice backend is `src/mock/`. A session keeps the backend it started on (`sessionApi()` in `store.ts`); the workspace shows no badge either way.

**The library is always real**: on launch the claims rail streams `GET /api/library/stream` from the backend (Fetching papers… Fetching highlights… Gathering notes… Summarizing each highlight…, shown in the start bubble; each claim card's title is that summary), in the demo too, so run `uv run litmus serve`. If the backend is unreachable the demo falls back to `src/mock/library.json`, a snapshot of `backend/data/library_cache.json` with the same ids (refresh it by copying the cache).

**The demo backend** (`src/mock/`): `sim.ts` is a simulated airbench94 whose knob effects are calibrated from the recorded real session (`shared/demo-session.json`: mixup α=1 −1.44, α=0.2 +0.22 at 30 epochs, no TTA −0.75, no whitening −1.48, …) with seed-paired noise, plus a port of the locked grader (paired t-interval, verdict relative to prediction). `server.ts` emits the contract's events: any star can be branched (a catalog of moves tied to library highlights; none changes training length), there is no agent's pick and no shadow runs, inconclusive results get 5 more seeds, the first mixup refutation triggers library search + a question, the session waits for "Where should we start?" (one claim, one first agent), each agent offers its own card with a short take when its verdict lands, and Litmus plans from the best star only when no card is open. The demo's abstract is written by the backend's LLM through `POST /api/abstract` (body: the demo session snapshot; stateless, nothing stored), with a template fallback when the backend is down. `library.ts` maps the demo's moves onto highlights in that snapshot by their real ids. "Label smoothing hurts distillation" cannot run on airbench (no teacher or student), so its move tests the note on it ("So not a free win") with stronger smoothing, ε = 0.4.

**Folder map** (`frontend/src`)
| Path | What |
|---|---|
| `types.ts` | Contract types, snake_case, mirrors `shared/contract.md` (+ optional `Claim.summary`, frontend only) |
| `reducer.ts` | `applyEvent(state, event)`: the one pure reducer. Ignores `seq <= lastSeq`, logs unknown types |
| `store.ts` | zustand store: session state, selection, camera focus/follow, actions; picks the demo or real `api` |
| `transport/` | `api.ts` interface, `real.ts` (REST + WebSocket, reconnect from last `seq`), `mock.ts` |
| `lib/` | `format.ts` (agent names, numbers, colours), `layout.ts` (3D positions) |
| `App.tsx` | Hash router: home `Landing`, `#/login` and `#/signup` (`Auth`, demo account in `auth.ts`), then the workspace once a session exists |
| `components/Landing.tsx`, `LowPolyScene.tsx`, `thinker*.ts` | The home page is one pinned horizontal scene: the hero is panel 0, vertical scroll drives `x` (slides dwell in the middle of their range, `dwell()`), and as the first slide comes in from the right the temple plays its intro backwards (`LowPolyScene` `exit`: roof lifts, columns sink, the Thinker and sky settle into a faint backdrop that drifts behind the slides). The slides are plain-language cards that copy the real workspace (claims, proposal dock, tree, leaderboard, question card, write-up). Below 860px or with reduced motion the slides stack vertically. SVG low-poly temple with the Thinker |
| `components/Scene.tsx` | The 3D canvas: statue, blobs, edges, accuracy scale, follow camera |
| `components/` | `TopBar` (Generate abstract; the GPU budget is enforced but not shown), `Researching` (a card over the scene, left: the library loading stages, the claim each running agent is testing, and every highlight with its status, expandable into the old claim card, with "Pivot to this claim" (`POST /pivot`) for untested ones), `Inspector` (a rounded results card that floats over the scene on the right, and sits below it on narrow screens; results, rankings, "Where should we start?" before the first agents, one agent's detail with what its agent found and suggests, abstract; under it, a separate **Litmus card** with Litmus's face holds the conversation and the Ask Litmus box), `PathChart`, `Dock` (everything waiting on you: one tab per open question and per agent card, "Where should I proceed? — Flip agent", so you can branch from several agents at once), `Prov`, `Icons` |
| `components/LowPolyScene.tsx` `Facets` | The landing's faceted low-poly sky, reused as the rails' ground |
| `public/litmus-statue.glb` | The agent: SMK's public-domain scan of the Artemision Bronze (KAS2100, api.smk.dk), decimated to 1,200 faces, fingertip at the origin |

**The scene is a layered network**: x = generation (all stars of one generation share a column, like layers of a neural network) and y = accuracy, on one scale for every star (`lib/layout.ts`: `UNITS_PER_POINT`), so node heights match the accuracy graph: higher accuracy sits higher, the baseline is level with the fingertip, and a star that is still training sits level with its parent. Stars of one column whose accuracies are too close are nudged apart (`MIN_GAP`), keeping their order; stars above the baseline only move up and those below only down, so a refuted star never sits above the baseline. A graded card says what the claim predicted next to the verdict ("Confirmed · the claim expects a loss"): an ablation like TTA off confirms by losing accuracy. Node = experiment (a flat-shaded low-poly sphere that spins faster while training); ring = verdict colour (partial arc = training progress, amber = needs you); dashed edge = training. A finished experiment opens its own card in the results panel automatically (unless you are already reading one).

**Camera**: locked: no rotate or pan, zoom capped (170-480 units). At the start of a session it opens just behind the statue's head, looking over its shoulder along the arm, and glides once to the default view (`EAR_CAM`/`EAR_AIM`, `INTRO_SMOOTH` in `Scene.tsx`). The default view (`VIEW`) is swung a little toward the nodes' side so the tree is met head-on, aimed at the midpoint of the focused star and its parent. The camera frames the whole column of the focused star and zooms out (up to 760 units) when a generation gets tall. Focus = the newest star while following; dispatching, answering or branching turns following back on; clicking any star or claim re-centres on it and keeps your zoom. "Fit all" is a toggle (`fitAll` in the store): on frames every star, off returns to the default view. There is no pause button.

**Waiting text** (`components/Whimsy.tsx`): while Litmus or an agent works (the thinking pill, the chat, "Generating next steps", writing the abstract) the label says what is happening, then cycles playful verbs (Pondering… Tinkering… Percolating…); reduced motion keeps the plain label.

**Asking Litmus** (`ThoughtFlight.tsx`, restored at the user's request): your words in graphite bubbles, Litmus's in marble beside its low-poly face (`public/litmus-face.svg`, also the favicon). Sending a question folds the typed words into a pearl of marble light that arcs to the statue's head with a tapered comet tail in the agent blue, while the camera turns to the statue (`consulting` in `CameraRig`). A "Thinking" pill rides above the head (`statueAnchor`, projected every frame by `HeadTracker` in `Scene.tsx`) until the backend answers; then the pearl flies back and the answer opens where it lands (`data-answer-slot`). Pure presentation: the request starts at once. Reduced motion or a statue off screen skip the trip and show a "Thinking" bubble in the chat instead (the demo waits 1.6s like a real call).
**Agent names**: agents that share a name get A, B, C in start order ("Mixup agent A"), in the UI (`labelAgents` in the reducer) and in the prompts (`agent.agent_name`).

**Testing another claim**: the "Test another claim" button next to Fit all (`components/ClaimPicker.tsx`) lists every highlight no agent has touched, notes first, with a one-click Test (pivot). Every claim has a number, its place in the session's ranked library (`claimNumber` in `lib/format.ts`), so it stays the same in any list; each option under "Where should I proceed?" names the claim it steers to ("Claim 2: Mixup needs longer training", `claimOf`). The bottom dock shows one card at a time with a ‹ 2 of 5 › pager, proposals as short checkable titles, and the instruction field behind "Add an instruction". Node names hang below the ring (anchored by their top edge) and columns are `LAYER_GAP` 120 apart with `MIN_GAP` 46, so labels never overlap.

**Bulbs, bubbles and eyes**: every node has low-poly eyes (blink, look around while training, glance up when it needs you). When an experiment is done and has options for you, a low-poly light bulb sits at its top right; clicking the node or the bulb opens "Where should I proceed?" as a speech bubble out of the node (`components/NodeBubble.tsx`, `proceedFor` in the store), with "See results" for its card. The bottom dock now holds only questions. The first question, "Where should we start?", is a bubble rising from Litmus's face at the bottom right (`components/StartBubble.tsx`).

**Where you steered** (`components/Steering.tsx`, `lib/steering.ts`): the Results card lists each human decision (`Decision` events: dispatch, answer, feedback) with the stars it produced and their graded result. When the agent's alternative also ran (same `proposal_id`, or an answer option's `knob_changes`), it shows the accuracy gap; otherwise it says nothing can be compared. Nothing is invented: the practice backend has no agent pick, so only real backend sessions show a "would have picked" line.

**Sign-in page** (`#/upload`, `components/Upload.tsx`): Start research opens it first. "Sign in to Litmus" (email and password are decorative: nothing is checked, sent or stored), then **Your library**: a Papiers API token and "What are you researching?". Find my highlights connects (`connectPapiers`), streams the library with its stages on the button (Connecting to Papiers… Fetching papers… Fetching highlights… Gathering notes… Summarizing each highlight…), and keeps only the highlights about the topic (`lib/relevance.ts`: plain word matching on 5-letter stems, no AI; a topic word nearly every highlight mentions only counts when the topic is mostly such words, so "mixup training" gives the mixup highlights and "CIFAR-10 training optimization" a whole CIFAR library, best matches first). The page then lists them as claim cards, each with Start: `begin(false, topic, claimId)` creates the session with the topic as its goal and starts there at once (`startClaim` in the store hides "Where should we start?"; the demo backend holds a start that arrives before its baseline), so the workspace opens straight onto the graph. "Try the demo highlights" (the recorded 12 claims) and "Use my saved Papiers login" (the login already on the server) go through the same topic filter. The filtered library is what the session imports.

**Workspace layout (user decisions, 2026-10-17)**: nodes show only the agent's name and its accuracy. Clicking a node (or a
ranking row) opens its card in clear space: above it, else below its label, else beside it (right, then left), never over the
floating UI marked `data-scene-obstacle` (the question dock, the results card, the chat); when nothing fits it takes the roomier
of above and below, clipped at those cards, and scrolls (`PlacedCard` re-measures every frame but keeps its spot while the card still fits there, so panning does not flip it). The card stops pointer and wheel events (else the camera controls capture the press and the click never lands) and only the visible card takes clicks (drei's `Html` wrapper is `pointer-events: none`); clicking the canvas itself lets go of the agent; while a question flies to Litmus and back the card is hidden (the camera swings to the statue) and returns after (`NodeCard` in `NodeBubble.tsx`): **About** (the claim it tests, verdict, what it
found and suggests, Stop while it trains; new directions come from its options or Test another claim) and **Where should I proceed?** (its options). An agent whose question you answered with an option that changes nothing ("Drop mixup") is a closed line: no bulb, no Where should I proceed? (`dropped` in `lib/format.ts`; the backend's `graph.dropped` skips its `suggest`, so it drafts no options). Between its grade and its take arriving (the `suggest` LLM call), that tab shows "Generating next steps…" with placeholder lines for the take and the options (`generating` in `Scene.tsx`, `Generating` in `NodeBubble.tsx`); the demo backend waits `SUGGEST_MS` before writing each card, and Litmus does not plan on its own while a card is still being written. The right panel is for the
whole research only: researching now, results, accuracy by path, rankings, where you steered, research log, and the
**two tabs, Results and Litmus chat**, each filling the whole right side (`chatOpen` picks the chat; asking from anywhere switches to it, opening the abstract switches back). Litmus no longer narrates each step (the research log keeps it); the chat offers the 2-3 questions you would most likely ask right now (written by Litmus for the current state through `POST /questions`, re-asked when the state changes, debounced, while the chat tab is open; until they arrive, or if the call fails, the rule-based `commonQuestions` in `lib/questions.ts`, which the demo backend also serves); clicking one asks it (`askLitmus` in `store.ts`); one conversation; Litmus answers about the open agent, shown as a removable chip, or else "about the whole research"). "Where should we start?" is a speech bubble rising from Litmus's face at the bottom right (`StartBubble`, in the right column),
with the same expandable claim cards and a Start button each, while the camera holds behind the statue; the claim you start folds into a pearl that flies into the back of Litmus's head (`launchThought(..., oneWay)`), and the camera pans only once it has landed (that bubble only appears when no claim was chosen on the sign-in page; the pause before the pan is `INTRO_HOLD_MS`, 250 ms); the results card, the chat
(the face cannot be clicked) and Fit all stay hidden until you pick, then the camera pans to the graph. A claim card opens to YOUR NOTE,
FROM THE PAPER (or Findings once agents tested it) and the cite / page / Source line. The results card keeps one height (`RESULTS_HEIGHT`); the chat fills the room
under it. **Test another claim** (`ClaimPicker.tsx`) lists every highlight with its status; tested ones keep a greyed-out
Test button; open one for its card (paper, your note, Basis, Findings, source). Following new branches is always on;
**Fit all** zooms out (padded clear of the results card) and closes node cards, **Default view** goes back to following. Clicking empty space lets go of the open agent (there is no ×): the camera fits everything, or keeps following while agents run, and the next new agent is followed. Agents running side by side always fit on screen: the follow camera centres the focused agent's whole column and may pull back past the zoom cap (which then only limits your own zooming).
The camera centres the focused agent and its direct children in the space the results card leaves, the agent a little above the middle so its card fits above and its children stay clear of the bottom card (`PANEL_PX`, `ABOVE_MIDDLE`), zoom is
capped at `MAX_DISTANCE` (520, the user's furthest zoom; the default ≈350 is their ideal), and five dashed accuracy levels (baseline ±1, ±2 points, `AccuracyLines`) run behind the
graph, the baseline through the fingertip. The floating cards carry the landing's faceted sky (`.card-facets`: rises from the bottom of each card and fades out before the text, so the cards stay white; `.marble-edge` rim; `.plate` panes are frosted so the facets glint through; Litmus's narration bubbles carry it too).

**Design tokens**: `frontend/src/index.css` (`@theme`): cool marble ground, graphite, verdict colours (`confirmed`, `refuted`, `inconclusive`), state colours (`running`, `waiting`), actor colours (`human`, `agent`). The scene reads verdict colours from these CSS variables. Design context: `PRODUCT.md`, `.impeccable/surfaces/`.

**Motion**: stars ease to layout targets, camera transitions via `CameraControls`, `motion` for the dock. Disabled under `prefers-reduced-motion`.

**Add an event type**: add a `case` in `reducer.ts`, add a test in `reducer.test.ts`, emit it from `mock/server.ts`, then render it.

**Known gaps**: three.js makes the bundle ~1 MB (fine locally, not code-split); below 1024px the rails stack under the canvas; star labels can still touch when a cousin's subtree lands on the same height.

### Contract requests
- `GET /api/sessions/{id}` should include the highest applied `seq`, so a client can load the snapshot and then subscribe from `seq + 1` instead of replaying everything.
