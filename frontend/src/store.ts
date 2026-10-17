import { create } from 'zustand'
import { applyEvent, initialState, type AppState } from './reducer'
import { mockApi } from './transport/mock'
import { realApi } from './transport/real'
import type { Api, ConnState, LibraryStage } from './transport/api'
import type { ChatTurn, Provenance, Selection } from './types'

// Live (the FastAPI backend, Modal A100s) unless the in-browser practice backend is chosen: the Tutorial does, for one visit;
// developers can keep it on with ?demo=1.
const DEMO_KEY = 'litmus.demo'
const savedDemo = () => { try { return localStorage.getItem(DEMO_KEY) === '1' || /[?&]demo=1\b/.test(location.search) } catch { return false } }
export const apiFor = (demo: boolean): Api => (demo ? mockApi : realApi)
// A session keeps the backend it started on, even if the switch is flipped later.
let current: Api = apiFor(savedDemo())
export const sessionApi = () => current

type Store = {
  app: AppState
  sid: string | null
  conn: ConnState
  libraryStage: LibraryStage | 'ready'
  demo: boolean
  setDemo: (demo: boolean) => void
  error: string | null
  selectedId: string | null
  hoveredClaim: string | null
  follow: boolean // the camera jumps to each new branch
  focusId: string | null // what the camera is centred on
  fitAll: boolean // frame the whole tree; off returns to the default view
  abstractOpen: boolean
  chats: Record<string, (ChatTurn & { provenance?: Provenance[] })[]> // per star, oldest first
  thinking: string | null // the star whose chat is waiting on Litmus
  thought: Thought | null // the question's trip to the statue and back; the answer stays hidden until it lands
  begin: (replay: boolean, goal?: string) => Promise<void>
  leave: () => void
  select: (id: string | null) => void
  set: (p: Partial<Store>) => void
  dispatch: (star_id: string, selections: Selection[], instruction?: string) => Promise<void>
  answer: (question_id: string, option_id: string, comment?: string) => Promise<void>
  feedback: (star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) => Promise<void>
  ask: (star_id: string, question: string) => Promise<void>
  togglePause: () => Promise<void>
  stopBranch: (star_id: string) => Promise<void>
  branch: (star_id: string, text?: string) => Promise<void>
  generateAbstract: () => Promise<void>
}

// A question in flight to the statue: the text it was typed as, and where (the chat input's box and font).
export type Thought = {
  key: number; starId: string; text: string; landed: boolean
  from: { left: number; top: number; width: number; height: number; padding: number; font: string; letterSpacing: string }
}

let unsub: (() => void) | null = null
let libraryLoad: AbortController | null = null

export const useStore = create<Store>((set, get) => {
  // Wrap an action: surface failures in the UI instead of swallowing them.
  const act = async (f: (sid: string) => Promise<unknown>) => {
    const sid = get().sid
    if (!sid) return
    try { await f(sid); set({ error: null }) } catch (e) { set({ error: (e as Error).message }) }
  }
  return {
    app: initialState, sid: null, conn: 'closed', libraryStage: 'papers', demo: savedDemo(), error: null, selectedId: null, hoveredClaim: null,
    follow: true, focusId: null, fitAll: false, abstractOpen: false, chats: {}, thinking: null, thought: null,
    set: (p) => set(p),
    setDemo(demo) {
      try { localStorage.setItem(DEMO_KEY, demo ? '1' : '0') } catch { /* private window: the switch still works for this visit */ }
      set({ demo, error: null })
    },
    select: (id) => set(id ? { selectedId: id, focusId: id, abstractOpen: false, fitAll: false } : { selectedId: null }),
    leave() {
      unsub?.(); unsub = null
      libraryLoad?.abort(); libraryLoad = null
      set({ app: initialState, sid: null, conn: 'closed', selectedId: null, focusId: null, fitAll: false, abstractOpen: false, chats: {}, thought: null, error: null, demo: savedDemo() })
    },
    async begin(replay, goal) {
      unsub?.()
      set({ app: initialState, libraryStage: 'papers', selectedId: null, focusId: null, fitAll: false, follow: true, error: null, abstractOpen: false, chats: {}, thought: null })
      libraryLoad?.abort()
      const api = current = apiFor(get().demo)
      const load = libraryLoad = new AbortController()
      api.library((libraryStage) => set({ libraryStage }), load.signal)
        .then(({ documents, claims }) => { if (!load.signal.aborted) set((st) => ({ app: { ...st.app, documents, claims }, libraryStage: 'ready' })) })
        .catch((e: Error) => set({ error: e.message }))
      try {
        const sid = replay ? await api.replayDemo() : await api.createSession({ goal, fresh: true })
        set({ sid })
        unsub = api.subscribe(sid, 0, (e) => {
          set((st) => {
            const app = applyEvent(st.app, e)
            const born = (e.type === 'star.created' || e.type === 'shadow.created') && st.follow ? (e.payload.star.id as string) : null
            return { app, focusId: born ?? st.focusId }
          })
        }, (conn) => set({ conn }))
      } catch (e) { set({ error: (e as Error).message }) }
    },
    dispatch: (star_id, selections, instruction) => { set({ follow: true }); return act((sid) => current.dispatch(sid, { star_id, selections, instruction })) },
    answer: (question_id, option_id, comment) => { set({ follow: true }); return act((sid) => current.answer(sid, { question_id, option_id, comment })) },
    feedback: (star_id, kind, text) => act((sid) => current.feedback(sid, { star_id, kind, text })),
    async ask(star_id, question) {
      const history = (get().chats[star_id] ?? []).map(({ role, text }) => ({ role, text }))
      set((st) => ({ thinking: star_id, chats: { ...st.chats, [star_id]: [...(st.chats[star_id] ?? []), { role: 'human', text: question }] } }))
      await act(async (sid) => {
        const r = await current.explain(sid, { star_id, question, history })
        set((st) => ({ chats: { ...st.chats, [star_id]: [...(st.chats[star_id] ?? []), { role: 'litmus', text: r.answer, provenance: r.provenance }] } }))
      })
      set({ thinking: null })
    },
    togglePause: () => act((sid) => (get().app.session?.status === 'paused' ? current.resume(sid) : current.pause(sid))),
    stopBranch: (star_id) => act((sid) => current.stopBranch(sid, star_id)),
    // Branching from any star, refuted ones included, goes through feedback "suggest": the agent replans from it.
    branch: (star_id, text) => { set({ follow: true }); return act((sid) => current.feedback(sid, { star_id, kind: 'suggest', text: text?.trim() || 'Branch from here.' })) },
    generateAbstract: async () => { await act((sid) => current.abstract(sid)); if (get().app.session?.abstract) set({ abstractOpen: true, selectedId: null }) },
  }
})
