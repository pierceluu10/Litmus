import { LibraryUnavailable, type Api, type Library, type LibraryStage } from './api'
import type { LitmusEvent } from '../types'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

async function call<T>(method: string, path: string, body?: unknown, text = false): Promise<T> {
  const r = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: r.statusText }))).detail ?? r.statusText)
  return (text ? r.text() : r.json()) as Promise<T>
}
const sp = (sid: string, p: string) => `/api/sessions/${sid}${p}`

type LibraryMessage = { stage: LibraryStage } | ({ stage: 'done' } & Library) | { stage: 'error'; message: string }

// Papiers is read live on the backend; each stage arrives as it starts, then the ranked, summarized library.
export function streamLibrary(onStage: (stage: LibraryStage) => void, signal: AbortSignal): Promise<Library> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`${BASE}/api/library/stream`)
    const close = () => { source.close(); signal.removeEventListener('abort', close) }
    signal.addEventListener('abort', close)
    source.onmessage = (m) => {
      const e: LibraryMessage = JSON.parse(m.data)
      if (e.stage === 'done') { close(); resolve({ documents: e.documents, claims: e.claims }) }
      else if (e.stage === 'error') { close(); reject(new LibraryUnavailable(e.message)) }
      else onStage(e.stage)
    }
    source.onerror = () => { close(); reject(new LibraryUnavailable(`Could not reach the Litmus backend at ${BASE}`)) }
  })
}

export const realApi: Api = {
  mock: false,
  health: () => call('GET', '/api/health'),
  warmup: () => call('POST', '/api/warmup'),
  library: streamLibrary,
  createSession: async (b) => (await call<{ session_id: string }>('POST', '/api/sessions', b)).session_id,
  replayDemo: async () => (await call<{ session_id: string }>('GET', '/api/replay/demo')).session_id,
  subscribe(sid, fromSeq, onEvent, onConn) {
    let last = fromSeq
    let ws: WebSocket | null = null
    let closed = false
    let retry = 0
    const open = () => {
      onConn(retry ? 'reconnecting' : 'connecting')
      ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/sessions/${sid}?from_seq=${last}`)
      ws.onopen = () => { retry = 0; onConn('live') }
      ws.onmessage = (m) => { const e: LitmusEvent = JSON.parse(m.data); last = Math.max(last, e.seq); onEvent(e) }
      ws.onclose = () => {
        if (closed) return
        onConn('reconnecting')
        setTimeout(open, Math.min(1000 * 2 ** retry++, 8000))
      }
    }
    open()
    return () => { closed = true; ws?.close(); onConn('closed') }
  },
  start: (sid, claim_ids) => call('POST', sp(sid, '/start'), { claim_ids }),
  dispatch: (sid, b) => call('POST', sp(sid, '/dispatch'), b),
  answer: (sid, b) => call('POST', sp(sid, '/answer'), b),
  feedback: (sid, b) => call('POST', sp(sid, '/feedback'), b),
  explain: (sid, b) => call('POST', sp(sid, '/explain'), b),
  pause: (sid) => call('POST', sp(sid, '/pause')),
  resume: (sid) => call('POST', sp(sid, '/resume')),
  stopBranch: (sid, star_id) => call('POST', sp(sid, '/stop_branch'), { star_id }),
  abstract: (sid) => call('POST', sp(sid, '/abstract')),
  exportMarkdown: (sid) => call('GET', sp(sid, '/export'), undefined, true),
}
