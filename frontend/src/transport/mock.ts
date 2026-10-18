import { commonQuestions } from '../lib/questions'
import { MockServer } from '../mock/server'
import { claims, documents } from '../mock/library'
import { DEFAULT_GOAL, LibraryUnavailable, type Api } from './api'
import type { Provenance, ReadingItem } from '../types'
import { call, realApi, streamLibrary } from './real'

let srv: MockServer | null = null
const cur = () => { if (!srv) throw new Error('No mock session'); return srv }
const RESPONSE_MS = 150
const THINK_MS = 1600 // about as long as a real chat answer, so the Thinking indicator is seen
const wait = <T,>(v: T, ms = RESPONSE_MS) => new Promise<T>((r) => setTimeout(() => r(v), ms))
// Litmus in the demo talks with the real LLM about the simulated agents: the backend gets this session's snapshot
// (nothing is stored there). With the backend off it falls back to the offline answers.
const litmus = <T,>(path: string, body: object) => call<T>('POST', `/api/demo/${path}`, { session: cur().state.session, ...body })
const offline = (what: string, e: Error) => console.warn(`${what}: the backend is unreachable, answering offline (${e.message})`)

export const mockApi: Api = {
  mock: true,
  health: () => wait({ ok: true, modal_warm: true, papiers_ok: true, openai_ok: true }),
  warmup: () => wait(undefined),
  importLibrary: async () => {},
  // the practice backend has no Papiers to ask: any well-formed token connects, and the library is the recorded snapshot
  connectPapiers: async (token) => { await wait(undefined); if (!/^pap_live_\S+$/.test(token)) throw new Error('That does not look like a Papiers token. It starts with pap_live_.') },
  // The library is real even in the demo: read live through the backend, or its snapshot when the backend is off.
  library: (onStage, signal) => streamLibrary(onStage, signal).catch((e) => {
    if (!(e instanceof LibraryUnavailable)) throw e
    console.warn(`${e.message}; using the library snapshot`)
    return { documents, claims }
  }),
  createSession: async (b) => { srv = new MockServer(b.goal || DEFAULT_GOAL, false); return srv.sid },
  replayDemo: async () => { srv = new MockServer(DEFAULT_GOAL, true); return srv.sid },
  subscribe(_sid, fromSeq, onEvent, onConn) {
    onConn('live')
    return cur().subscribe(fromSeq, onEvent)
  },
  start: async (_s, ids) => cur().begin(ids),
  pivot: async (_s, id) => cur().pivot(id),
  dispatch: async (_s, b) => cur().dispatch(b.star_id, b.selections, b.instruction),
  answer: async (_s, b) => cur().answer(b.question_id, b.option_id, b.comment),
  feedback: async (_s, b) => cur().feedback(b.star_id, b.kind, b.text),
  explain: (_s, b) => litmus<{ answer: string; provenance: Provenance[] }>('explain', b)
    .catch((e) => { offline('chat', e); return wait(cur().chat(b.star_id, b.question ?? ''), THINK_MS) }),
  // the demo has no LLM: the rule-based questions, after a beat like a real call
  questions: (_s, b) => litmus<{ questions: string[] }>('questions', b).then((r) => r.questions)
    .catch((e) => { offline('questions', e); return wait(commonQuestions(cur().state.session, b.star_id ?? null).filter((q) => !b.asked.includes(q)), THINK_MS) }),
  autoresearch: (_s, b) => litmus<{ answer: string; papers: ReadingItem[] }>('autoresearch', b)
    .catch((e) => { offline('autoresearch', e); return { answer: 'Autoresearch searches arXiv through the Litmus backend. Start it with ./dev.sh and ask again.', papers: [] } }),
  // the library is real, so these write to it; the backend marks every demo note as simulated
  verdictHighlights: (_s, b) => litmus('highlights', b),
  importPaper: (url) => realApi.importPaper(url),
  importStatus: (id) => realApi.importStatus(id),
  pause: async () => cur().pause(),
  resume: async () => cur().resume(),
  stopBranch: async (_s, id) => cur().stopBranch(id),
  abstract: async () => { await cur().generateAbstract(); const a = cur().state.session?.abstract; return { abstract: a?.text ?? '', findings: a?.findings ?? [] } },
  exportMarkdown: async () => cur().exportMarkdown(),
}
