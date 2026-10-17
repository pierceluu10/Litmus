import { create } from 'zustand'
import { applyEvent, initialState, type AppState } from './reducer'
import { mockApi } from './transport/mock'
import { realApi } from './transport/real'
import type { ConnState, Health } from './transport/api'
import type { Provenance, Selection } from './types'

export const api = import.meta.env.VITE_MOCK === '0' ? realApi : mockApi

type Store = {
  app: AppState
  sid: string | null
  conn: ConnState
  health: Health | null
  error: string | null
  selectedId: string | null
  hoveredClaim: string | null
  follow: boolean
  abstractOpen: boolean
  explainBusy: boolean
  explained: Record<string, { answer: string; provenance: Provenance[] }>
  begin: (replay: boolean, goal?: string) => Promise<void>
  select: (id: string | null) => void
  set: (p: Partial<Store>) => void
  dispatch: (star_id: string, selections: Selection[], instruction?: string) => Promise<void>
  answer: (question_id: string, option_id: string, comment?: string) => Promise<void>
  feedback: (star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) => Promise<void>
  explain: (star_id: string, question?: string) => Promise<void>
  togglePause: () => Promise<void>
  stopBranch: (star_id: string) => Promise<void>
  addToPapiers: () => Promise<void>
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
    follow: true, abstractOpen: false, explainBusy: false, explained: {},
    set: (p) => set(p),
    select: (id) => set({ selectedId: id }),
    async begin(replay, goal) {
      unsub?.()
      set({ app: initialState, selectedId: null, error: null, abstractOpen: false, explained: {} })
      try {
        const sid = replay ? await api.replayDemo() : await api.createSession({ goal })
        set({ sid })
        unsub = api.subscribe(sid, 0, (e) => {
          set((st) => {
            const app = applyEvent(st.app, e)
            // Select the baseline when it first appears so the sidebar is never empty.
            const selectedId = st.selectedId ?? (app.session?.stars[0]?.id ?? null)
            const abstractOpen = e.type === 'abstract.ready' ? true : st.abstractOpen
            return { app, selectedId, abstractOpen }
          })
        }, (conn) => set({ conn }))
      } catch (e) { set({ error: (e as Error).message }) }
    },
    dispatch: (star_id, selections, instruction) => act((sid) => api.dispatch(sid, { star_id, selections, instruction })),
    answer: (question_id, option_id, comment) => act((sid) => api.answer(sid, { question_id, option_id, comment })),
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
    addToPapiers: () => act((sid) => api.abstract(sid)),
  }
})
