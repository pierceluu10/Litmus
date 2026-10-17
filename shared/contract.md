# Litmus API + Event Contract

Single source of truth between `backend/` and `frontend/`. Rules: **additive changes only**, never rename
or remove fields, every change gets a Changelog line (newest first) and lands on `main` as
`docs(contract): ...`.

## Changelog
- 2026-10-16 — v1 bootstrap.

---

**Base URL:** `http://localhost:8000`. CORS open for `http://localhost:5173`.
All JSON is snake_case. Timestamps are ISO 8601 UTC strings. IDs are stable strings and never reused.

## REST

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, modal_warm, papiers_ok, openai_ok}` |
| POST | `/api/warmup` | | `{ok}` (warms Modal container) |
| GET | `/api/library` | | `{documents: Document[], claims: Claim[]}` ranked, with provenance |
| POST | `/api/sessions` | `{goal?, budget_gpu_seconds?, auto_mode?}` | `{session_id}` |
| GET | `/api/sessions` | | `{sessions: {id, goal, status, created_at, replay}[]}` newest first |
| GET | `/api/sessions/{id}` | | full `SessionState` snapshot |
| POST | `/api/sessions/{id}/dispatch` | `{star_id, selections:[{proposal_id, knob_overrides?}], instruction?}` | `{ok}` |
| POST | `/api/sessions/{id}/answer` | `{question_id, option_id, comment?}` | `{ok}` |
| POST | `/api/sessions/{id}/feedback` | `{star_id, kind:"challenge"\|"suggest"\|"prioritize", text}` | `{ok}` |
| POST | `/api/sessions/{id}/explain` | `{star_id, question?}` | `{answer, provenance: Provenance[]}` |
| POST | `/api/sessions/{id}/pause` | | `{ok}` |
| POST | `/api/sessions/{id}/resume` | | `{ok}` |
| POST | `/api/sessions/{id}/stop_branch` | `{star_id}` | `{ok}` |
| POST | `/api/sessions/{id}/abstract` | | `{abstract, findings[]}` (ends the session: no more waves) |
| GET | `/api/sessions/{id}/export` | | `text/markdown`: findings + abstract |
| GET | `/api/replay/demo` | | `{session_id}` — starts a replay session from `shared/demo-session.json` |
| WS | `/ws/sessions/{id}?from_seq=N` | | stream of `Event` (JSON text frames), first every persisted event with `seq > N`, then live |

Errors: non-2xx with `{detail: string}`. Validation errors are 422, unknown ids 404, conflicting
actions (e.g. dispatch on a star with no open proposals) 409. Dispatch and answer are idempotent:
repeating the same request returns `{ok: true}` and does nothing.

## Core types

```ts
Provenance = { kind: "highlight"|"note"|"conversation"|"passage"|"document"|"search"|"human",
               id: string, doc_id?: string, doc_title?: string, text: string, papiers_url?: string }

Document = { id: string, title: string, authors: string[], year?: number, url?: string,
             highlight_count: number, note_count: number, papiers_url?: string }

Claim = { id: string,                      // the highlight id (hl_...) or note/conversation id it came from
          text: string,                    // the highlighted claim
          doc_id: string, doc_title: string,
          annotation?: string,             // the human's note on the highlight (their doubt)
          weight: number,                  // judgment weight, higher = rank first
          rank: number,                    // 1-based
          conditions?: string,             // experimental conditions behind the claim, from the paper text
          provenance: Provenance[] }

Knobs = { label_smoothing:number, epochs:number, tta_level:0|1|2, flip:"random"|"alternating"|"none",
          mixup_alpha:number, cutout:number, lr_scale:number, whiten:boolean, dirac_init:boolean, translate:number }

Proposal = { id, star_id, title, hypothesis, predicted:"improves"|"hurts"|"no_effect",
             knob_changes: Partial<Knobs>, condition_notes: string, provenance: Provenance[],
             agent_recommended: boolean,
             status?: "open"|"dispatched"|"skipped" }

RunResult = { seed:number, val_acc:number, tta_val_acc?:number, time_seconds:number }

Grade = { metric:"val_acc"|"tta_val_acc", mean_parent, mean_child, delta, sd_parent, sd_child, n,
          ci_low, ci_high, p_value, verdict:"confirmed"|"refuted"|"inconclusive"|"baseline",
          practical:boolean, grader_version:string }
// accuracies are fractions in [0,1]; delta/ci are child - parent in the same units.

Star = { id,                                // "S0" is the baseline, then S1, S2, ... in creation order
         parent_id: string|null, depth, title, hypothesis, knobs: Knobs, knob_changes: Partial<Knobs>,
         provenance: Provenance[], chosen_by: "human"|"agent"|"auto"|"shadow",
         status: "queued"|"running"|"done"|"failed"|"waiting",
         predicted?: "improves"|"hurts"|"no_effect",
         proposal_id?: string,
         shadow_of?: string,                // for chosen_by:"shadow": the decision id it shadows
         progress?: { seed:number, epoch:number, val_acc:number }[],
         runs: RunResult[], parent_runs: RunResult[],
         grade?: Grade,
         reflection?: string, error?: string, created_at, finished_at? }

Question = { id, star_id, text, evidence: Provenance[], options:[{id, label, consequence}],
             agent_leaning?: string,         // option id the agent would pick alone
             status:"open"|"answered", answer?: {option_id, comment?} }

Decision = { id, star_id, kind:"dispatch"|"answer"|"feedback",
             agent_recommendation: string,   // what the agent would have done alone (proposal/option title)
             human_choice: string,           // what the human did
             agent_recommendation_ids?: string[], human_choice_ids?: string[],
             changed_trajectory: boolean,    // true when human_choice differs from agent_recommendation
             note: string, created_at }

SessionState = { id, goal, status:"running"|"paused"|"waiting_human"|"done", stars: Star[],
                 proposals: Proposal[], questions: Question[], decisions: Decision[],
                 abstract?: {text, findings:string[], citations: Provenance[]}, budget_used, budget_total,
                 replay?: boolean, created_at }

Event = { seq:number, ts:string, session_id, type: EventType, payload: object }
```

## Event types (payload in braces)

| type | payload |
|---|---|
| `session.started` | `{goal, replay: boolean}` |
| `library.loaded` | `{documents: Document[], claims: Claim[]}` |
| `agent.thinking` | `{star_id?, text}` — short, human-readable step |
| `proposals.ready` | `{star_id, proposals: Proposal[]}` |
| `human.dispatched` | `{star_id, selections, decision: Decision}` |
| `star.created` | `{star: Star}` |
| `experiment.started` | `{star_id, seeds: number[]}` |
| `experiment.progress` | `{star_id, seed, epoch, val_acc}` |
| `experiment.run_done` | `{star_id, run: RunResult}` |
| `star.graded` | `{star_id, grade: Grade}` |
| `star.updated` | `{star: Star}` — full star after any status/reflection change |
| `star.failed` | `{star_id, error}` |
| `library.search` | `{star_id, query, hits: Provenance[]}` |
| `question.asked` | `{question: Question}` |
| `question.answered` | `{question_id, option_id, decision: Decision}` |
| `feedback.received` | `{star_id, kind, text}` |
| `agent.replanned` | `{star_id, because, change}` — `because` quotes the human |
| `shadow.created` | `{star: Star}` |
| `abstract.ready` | `{abstract: {text, findings, citations}}` |
| `papiers.written` | `{ids: string[]}` |
| `papiers.export_ready` | `{path, instructions}` |
| `budget.updated` | `{used, total}` (GPU seconds) |
| `session.status` | `{status}` |
| `error` | `{message}` |

Client rule of thumb: build state from `GET /api/sessions/{id}`, then open the WebSocket with
`from_seq` = the highest `seq` you have applied (0 for everything). Every event is persisted, so a
reconnect never loses anything. `star.updated` always carries the whole star, so it is safe to replace.
