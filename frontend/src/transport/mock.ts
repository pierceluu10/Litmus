import { MockServer } from '../mock/server'
import type { Api } from './api'

let srv: MockServer | null = null
const cur = () => { if (!srv) throw new Error('No mock session'); return srv }
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150))

export const mockApi: Api = {
  mock: true,
  health: () => wait({ ok: true, modal_warm: true, papiers_ok: true, openai_ok: true }),
  warmup: () => wait(undefined),
  createSession: async (b) => { srv = new MockServer(b.goal || 'Which training tricks actually help a tiny CIFAR-10 classifier?', false); return srv.sid },
  replayDemo: async () => { srv = new MockServer('Replay: which training tricks actually help airbench?', true); return srv.sid },
  subscribe(_sid, fromSeq, onEvent, onConn) {
    onConn('live')
    return cur().subscribe(fromSeq, onEvent)
  },
  dispatch: async (_s, b) => cur().dispatch(b.star_id, b.selections, b.instruction),
  answer: async (_s, b) => cur().answer(b.question_id, b.option_id, b.comment),
  feedback: async (_s, b) => cur().feedback(b.star_id, b.kind, b.text),
  explain: (_s, b) => wait(cur().explain(b.star_id)),
  pause: async () => cur().pause(),
  resume: async () => cur().resume(),
  stopBranch: async (_s, id) => cur().stopBranch(id),
  abstract: async () => { cur().writeBack(); const a = cur().state.session?.abstract; return { abstract: a?.text ?? '', findings: a?.findings ?? [] } },
  exportMarkdown: async () => cur().exportMarkdown(),
}
