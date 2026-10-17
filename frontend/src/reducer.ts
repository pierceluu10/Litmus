import type { Abstract, Claim, Decision, Document, LitmusEvent, Provenance, Question, SessionState, Star } from './types'

export type FeedItem = {
  seq: number; ts: string; star_id?: string
  kind: 'thinking' | 'search' | 'replan' | 'feedback' | 'decision' | 'papiers' | 'error'
  text: string; hits?: Provenance[]
}
export type Replan = { seq: number; star_id: string; because: string; change: string }
export type AppState = {
  session: SessionState | null
  documents: Document[]
  claims: Claim[]
  feed: FeedItem[]
  replans: Replan[]
  exportInfo?: { path: string; instructions: string }
  writtenIds?: string[]
  lastSeq: number
  lastStarId?: string // most recently changed star, drives the follow camera
}

export const initialState: AppState = { session: null, documents: [], claims: [], feed: [], replans: [], lastSeq: 0 }

const upsert = <T extends { id: string }>(xs: T[], x: T): T[] =>
  xs.some((y) => y.id === x.id) ? xs.map((y) => (y.id === x.id ? x : y)) : [...xs, x]

function patchStar(s: SessionState, id: string, f: (st: Star) => Star): SessionState {
  return { ...s, stars: s.stars.map((st) => (st.id === id ? f(st) : st)) }
}

const blankSession = (id: string): SessionState => ({
  id, goal: '', status: 'running', stars: [], proposals: [], questions: [], decisions: [],
  budget_used: 0, budget_total: 0,
})

export function applyEvent(state: AppState, ev: LitmusEvent): AppState {
  if (ev.seq <= state.lastSeq) return state // duplicate or replayed
  const p = ev.payload ?? {}
  let s = state.session ?? blankSession(ev.session_id)
  let feed = state.feed
  let replans = state.replans
  let lastStarId = state.lastStarId
  const next: Partial<AppState> = {}
  const addFeed = (it: Omit<FeedItem, 'seq' | 'ts'>) => { feed = [...feed, { seq: ev.seq, ts: ev.ts, ...it }] }
  const touch = (id?: string) => { if (id) lastStarId = id }

  switch (ev.type) {
    case 'session.started': s = { ...s, goal: p.goal ?? s.goal, replay: p.replay, created_at: ev.ts }; break
    case 'start.chosen': s = { ...s, start_claim_ids: p.claim_ids ?? [] }; break
    case 'library.loaded': next.documents = p.documents ?? []; next.claims = p.claims ?? []; break
    case 'agent.thinking': addFeed({ kind: 'thinking', star_id: p.star_id, text: p.text }); break
    case 'proposals.ready':
      s = { ...s, proposals: [...s.proposals.filter((x) => x.star_id !== p.star_id), ...p.proposals.map((x: any) => ({ status: 'open', ...x }))] }
      touch(p.star_id); break
    case 'human.dispatched': {
      const d: Decision = p.decision
      const chosen = new Set<string>((p.selections ?? []).map((x: any) => x.proposal_id))
      // choosing from an agent's card closes that card; other agents' cards stay open
      const cards = new Set<string>([p.star_id, ...s.proposals.filter((x) => chosen.has(x.id)).map((x) => x.star_id)])
      s = {
        ...s,
        decisions: upsert(s.decisions, d),
        proposals: s.proposals.map((x) => chosen.has(x.id) ? { ...x, status: 'dispatched' }
          : cards.has(x.star_id) && x.status === 'open' ? { ...x, status: 'skipped' } : x),
      }
      addFeed({ kind: 'decision', star_id: p.star_id, text: `You chose: ${d.human_choice}` }); break
    }
    case 'star.created': case 'shadow.created': case 'star.updated':
      s = { ...s, stars: upsert(s.stars, p.star as Star) }; touch(p.star.id); break
    case 'experiment.started': s = patchStar(s, p.star_id, (st) => ({ ...st, status: 'running', progress: [] })); touch(p.star_id); break
    case 'experiment.progress':
      s = patchStar(s, p.star_id, (st) => ({ ...st, status: 'running', progress: [...(st.progress ?? []).filter((x) => x.seed !== p.seed || x.epoch !== p.epoch), { seed: p.seed, epoch: p.epoch, val_acc: p.val_acc }] }))
      touch(p.star_id); break
    case 'experiment.run_done':
      s = patchStar(s, p.star_id, (st) => ({ ...st, runs: [...st.runs.filter((r) => r.seed !== p.run.seed), p.run] })); touch(p.star_id); break
    case 'star.graded':
      s = patchStar(s, p.star_id, (st) => ({ ...st, grade: p.grade, status: 'done' })); touch(p.star_id); break
    case 'star.failed':
      s = patchStar(s, p.star_id, (st) => ({ ...st, status: 'failed', error: p.error }))
      addFeed({ kind: 'error', star_id: p.star_id, text: `Experiment failed: ${p.error}` }); touch(p.star_id); break
    case 'library.search': addFeed({ kind: 'search', star_id: p.star_id, text: p.query, hits: p.hits }); touch(p.star_id); break
    case 'question.asked': {
      const q: Question = p.question
      s = patchStar({ ...s, questions: upsert(s.questions, q) }, q.star_id, (st) => ({ ...st, status: 'waiting' }))
      touch(q.star_id); break
    }
    case 'question.answered': {
      const q = s.questions.find((x) => x.id === p.question_id)
      s = { ...s, questions: s.questions.map((x) => x.id === p.question_id ? { ...x, status: 'answered', answer: { option_id: p.option_id } } : x), decisions: upsert(s.decisions, p.decision) }
      if (q) s = patchStar(s, q.star_id, (st) => st.status === 'waiting' ? { ...st, status: 'done' } : st)
      addFeed({ kind: 'decision', star_id: q?.star_id, text: `You answered: ${p.decision.human_choice}` }); break
    }
    case 'feedback.received': addFeed({ kind: 'feedback', star_id: p.star_id, text: `You (${p.kind}): ${p.text}` }); break
    case 'agent.replanned':
      replans = [...replans, { seq: ev.seq, star_id: p.star_id, because: p.because, change: p.change }]
      addFeed({ kind: 'replan', star_id: p.star_id, text: `${p.change} — because you said: “${p.because}”` }); touch(p.star_id); break
    case 'abstract.ready': s = { ...s, abstract: p.abstract as Abstract }; break
    case 'papiers.written': next.writtenIds = p.ids; addFeed({ kind: 'papiers', text: `Added ${p.ids.length} findings to Papiers` }); break
    case 'papiers.export_ready': next.exportInfo = { path: p.path, instructions: p.instructions }; addFeed({ kind: 'papiers', text: `Export ready: ${p.path}` }); break
    case 'budget.updated': s = { ...s, budget_used: p.used, budget_total: p.total }; break
    case 'session.status': s = { ...s, status: p.status }; break
    case 'error': addFeed({ kind: 'error', text: p.message }); break
    default: console.warn('litmus: unknown event type', ev.type)
  }
  return { ...state, ...next, session: s, feed, replans, lastStarId, lastSeq: ev.seq }
}
