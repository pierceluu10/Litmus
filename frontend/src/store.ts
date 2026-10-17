import { create } from 'zustand'
import { applyEvent, initialState, type AppState } from './reducer'
import { mockApi } from './transport/mock'
import { realApi } from './transport/real'
import type { ConnState, Health } from './transport/api'
import type { Provenance, Selection } from './types'

// The in-browser demo backend is the default; VITE_MOCK=0 talks to the real one.
export const api = import.meta.env.VITE_MOCK === '0' ? realApi : mockApi

type Store = {
  app: AppState
  sid: string | null
  conn: ConnState
  health: Health | null
  error: string | null
  selectedId: string | null
  hoveredClaim: string | null
  follow: boolean // the camera jumps to each new branch
  focusId: string | null // what the camera is centred on
  fitAll: boolean // frame the whole tree; off returns to the default view
  abstractOpen: boolean
  explainBusy: boolean
  explained: Record<string, { answer: string; provenance: Provenance[] }>
  begin: (replay: boolean, goal?: string) => Promise<void>
  leave: () => void
  select: (id: string | null) => void
  set: (p: Partial<Store>) => void
  dispatch: (star_id: string, selections: Selection[], instruction?: string) => Promise<void>
  answer: (question_id: string, option_id: string, comment?: string) => Promise<void>
  feedback: (star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) => Promise<void>
  explain: (star_id: string, question?: string) => Promise<void>
  togglePause: () => Promise<void>
  stopBranch: (star_id: string) => Promise<void>
  branch: (star_id: string, text?: string) => Promise<void>
  generateAbstract: () => Promise<void>
}

let unsub: (() => void) | null = null

export const useStore = create<Store>((set, get) => {
  // Wrap an action: surface failures in the UI instead of swallowing them.
  const act = async (f: (sid: string) => Promise<unknown>) => {
    const sid = get().sid
    if (!sid) return
    try { await f(sid); set({ error: null }) } catch (e) { set({ error: (e as Error).message }) }
  }
  return {
    app: initialState, sid: null, conn: 'closed', health: null, error: null, selectedId: null, hoveredClaim: null,
    follow: true, focusId: null, fitAll: false, abstractOpen: false, explainBusy: false, explained: {},
    set: (p) => set(p),
    select: (id) => set(id ? { selectedId: id, focusId: id, abstractOpen: false, fitAll: false } : { selectedId: null }),
    leave() {
      unsub?.(); unsub = null
      set({ app: initialState, sid: null, conn: 'closed', selectedId: null, focusId: null, fitAll: false, abstractOpen: false, explained: {}, error: null })
    },
    async begin(replay, goal) {
      unsub?.()
      set({ app: initialState, selectedId: null, focusId: null, fitAll: false, follow: true, error: null, abstractOpen: false, explained: {} })
      try {
        const sid = replay ? await api.replayDemo() : await api.createSession({ goal })
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
    dispatch: (star_id, selections, instruction) => { set({ follow: true }); return act((sid) => api.dispatch(sid, { star_id, selections, instruction })) },
    answer: (question_id, option_id, comment) => { set({ follow: true }); return act((sid) => api.answer(sid, { question_id, option_id, comment })) },
    feedback: (star_id, kind, text) => act((sid) => api.feedback(sid, { star_id, kind, text })),
    async explain(star_id, question) {
      set({ explainBusy: true })
      await act(async (sid) => {
        const r = await api.explain(sid, { star_id, question })
        set((st) => ({ explained: { ...st.explained, [star_id]: r } }))
      })
      set({ explainBusy: false })
    },
    togglePause: () => act((sid) => (get().app.session?.status === 'paused' ? api.resume(sid) : api.pause(sid))),
    stopBranch: (star_id) => act((sid) => api.stopBranch(sid, star_id)),
    // Branching from any star, refuted ones included, goes through feedback "suggest": the agent replans from it.
    branch: (star_id, text) => { set({ follow: true }); return act((sid) => api.feedback(sid, { star_id, kind: 'suggest', text: text?.trim() || 'Branch from here.' })) },
    generateAbstract: async () => { await act((sid) => api.abstract(sid)); if (get().app.session?.abstract) set({ abstractOpen: true, selectedId: null }) },
  }
})
