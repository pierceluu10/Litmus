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
(Filled in as features land.)

## Gotchas
- (none yet)

## Verification log
- (none yet)

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
