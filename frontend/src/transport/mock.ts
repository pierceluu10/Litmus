import { MockServer } from '../mock/server'
import { claims, documents } from '../mock/library'
import { DEFAULT_GOAL, LibraryUnavailable, type Api } from './api'
import { streamLibrary } from './real'

let srv: MockServer | null = null
const cur = () => { if (!srv) throw new Error('No mock session'); return srv }
const RESPONSE_MS = 150
const THINK_MS = 1600 // about as long as a real chat answer, so the Thinking indicator is seen
const wait = <T,>(v: T, ms = RESPONSE_MS) => new Promise<T>((r) => setTimeout(() => r(v), ms))

export const mockApi: Api = {
  mock: true,
  health: () => wait({ ok: true, modal_warm: true, papiers_ok: true, openai_ok: true }),
  warmup: () => wait(undefined),
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
  explain: (_s, b) => wait(cur().chat(b.star_id, b.question ?? ''), THINK_MS),
  pause: async () => cur().pause(),
  resume: async () => cur().resume(),
  stopBranch: async (_s, id) => cur().stopBranch(id),
  abstract: async () => { cur().generateAbstract(); const a = cur().state.session?.abstract; return { abstract: a?.text ?? '', findings: a?.findings ?? [] } },
  exportMarkdown: async () => cur().exportMarkdown(),
}
