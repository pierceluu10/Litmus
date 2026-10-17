import { create } from 'zustand'
import { applyEvent, initialState, type AppState } from './reducer'
import { mockApi } from './transport/mock'
import { realApi } from './transport/real'
import type { Api, ConnState, Library, LibraryStage } from './transport/api'
import type { ChatTurn, Provenance, Selection } from './types'

// Live (the FastAPI backend, Modal A100s) unless Demo mode is on: the front page's switch (remembered), or ?demo=1.
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
  imported: Library | null // what the person uploaded; null means read their Papiers library live
  demo: boolean
  setDemo: (demo: boolean) => void
  error: string | null
  selectedId: string | null
  hoveredClaim: string | null
  follow: boolean // the camera jumps to each new branch
  focusId: string | null // what the camera is centred on
  fitAll: boolean // frame the whole tree; off returns to the default view
  abstractOpen: boolean
  cardFor: string | null // the node whose card (about it, and where it should proceed) is open over it
  chatOpen: boolean // the Litmus chat under the results card, opened from Litmus's face
  chat: (ChatTurn & { provenance?: Provenance[] })[] // the conversation with Litmus, oldest first
  thinking: string | null // the star Litmus is answering about while the chat waits
  thought: Thought | null // the question's trip to the statue and back; the answer stays hidden until it lands
  begin: (replay: boolean, goal?: string) => Promise<void>
  leave: () => void
  select: (id: string | null) => void
  set: (p: Partial<Store>) => void
  start: (claim_ids: string[]) => Promise<void>
  pivot: (claim_id: string) => Promise<void>
  dispatch: (star_id: string, selections: Selection[], instruction?: string) => Promise<void>
  answer: (question_id: string, option_id: string, comment?: string) => Promise<void>
  feedback: (star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) => Promise<void>
  ask: (question: string) => Promise<void>
  togglePause: () => Promise<void>
  stopBranch: (star_id: string) => Promise<void>
  branch: (star_id: string, text?: string) => Promise<void>
  generateAbstract: () => Promise<void>
}

// A question in flight to the statue: the text it was typed as, and where (the chat input's box and font).
export type Thought = {
  key: number; starId: string; text: string; landed: boolean
  oneWay?: boolean // the first claim goes into Litmus's head and stays there: no thinking, no answer flying back
  from: { left: number; top: number; width: number; height: number; padding: number; font: string; letterSpacing: string }
}
// sends words on their trip to the statue from the element they were typed or shown in: they fold up from exactly there
export function launchThought(source: HTMLElement, text: string, starId: string, oneWay = false) {
  const r = source.getBoundingClientRect(), cs = getComputedStyle(source)
  useStore.setState((st) => ({ thought: { key: (st.thought?.key ?? 0) + 1, starId, text, landed: false, oneWay,
    from: { left: r.left, top: r.top, width: r.width, height: r.height, padding: parseFloat(cs.paddingLeft), font: cs.font, letterSpacing: cs.letterSpacing } } }))
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
    app: initialState, sid: null, conn: 'closed', libraryStage: 'papers', demo: savedDemo(), error: null, selectedId: null, hoveredClaim: null, imported: null,
    follow: true, focusId: null, fitAll: false, abstractOpen: false, chatOpen: false, cardFor: null, chat: [], thinking: null, thought: null,
    set: (p) => set(p),
    setDemo(demo) {
      try { localStorage.setItem(DEMO_KEY, demo ? '1' : '0') } catch { /* private window: the switch still works for this visit */ }
      set({ demo, error: null })
    },
    // letting go of an agent shows everything, or keeps following while agents are still running; either way the next new
    // agent is followed (a Fit all you chose yourself turns following off instead)
    select: (id) => set((st) => id ? { selectedId: id, focusId: id, cardFor: id, abstractOpen: false, fitAll: false }
      : { selectedId: null, cardFor: null, follow: true, fitAll: !st.app.session?.stars.some((s) => s.status === 'running' || s.status === 'queued'), focusId: st.app.lastStarId ?? null }),
    leave() {
      unsub?.(); unsub = null
      libraryLoad?.abort(); libraryLoad = null
      set({ app: initialState, sid: null, conn: 'closed', selectedId: null, focusId: null, fitAll: false, abstractOpen: false, chatOpen: false, cardFor: null, chat: [], thought: null, error: null, demo: savedDemo(), imported: null })
    },
    async begin(replay, goal) {
      unsub?.()
      set({ app: initialState, libraryStage: 'papers', selectedId: null, focusId: null, fitAll: false, follow: true, error: null, abstractOpen: false, chatOpen: false, cardFor: null, chat: [], thought: null })
      libraryLoad?.abort()
      const api = current = apiFor(get().demo)
      const load = libraryLoad = new AbortController()
      const { imported } = get()
      try {
        if (imported) {
          // an older backend has no import endpoint: carry on, it reads the same Papiers library (the ids match)
          await api.importLibrary(imported).catch((e: Error) => console.warn(`library import skipped: ${e.message}`))
          set((st) => ({ app: { ...st.app, documents: imported.documents, claims: imported.claims }, libraryStage: 'ready' }))
        } else {
          api.library((libraryStage) => set({ libraryStage }), load.signal)
            .then(({ documents, claims }) => { if (!load.signal.aborted) set((st) => ({ app: { ...st.app, documents, claims }, libraryStage: 'ready' })) })
            .catch((e: Error) => set({ error: e.message }))
        }
        const sid = replay ? await api.replayDemo() : await api.createSession({ goal, fresh: true })
        set({ sid })
        unsub = api.subscribe(sid, 0, (e) => {
          set((st) => {
            const app = applyEvent(st.app, e)
            const born = (e.type === 'star.created' || e.type === 'shadow.created') && st.follow ? (e.payload.star.id as string) : null
            // a finished experiment opens its own card automatically (unless you are already looking at one)
            const finished = e.type === 'star.graded' && e.payload.grade?.verdict !== 'baseline' && !st.selectedId && !st.abstractOpen ? { selectedId: e.payload.star_id as string } : {}
            return { app, focusId: born ?? st.focusId, ...(born ? { fitAll: false } : {}), ...finished }
          })
        }, (conn) => set({ conn }))
      } catch (e) { set({ error: (e as Error).message }) }
    },
    start: (claim_ids) => { set({ follow: true }); return act((sid) => current.start(sid, claim_ids)) },
    pivot: (claim_id) => { set({ follow: true }); return act((sid) => current.pivot(sid, claim_id)) },
    dispatch: (star_id, selections, instruction) => { set({ follow: true }); return act((sid) => current.dispatch(sid, { star_id, selections, instruction })) },
    answer: (question_id, option_id, comment) => { set({ follow: true }); return act((sid) => current.answer(sid, { question_id, option_id, comment })) },
    feedback: (star_id, kind, text) => act((sid) => current.feedback(sid, { star_id, kind, text })),
    // One conversation with Litmus; it answers about the selected experiment, or the baseline (it sees the whole tree either way).
    async ask(question) {
      const { chat, selectedId, app } = get()
      const star_id = selectedId ?? app.session?.stars[0]?.id
      if (!star_id) return
      const history = chat.map(({ role, text }) => ({ role, text }))
      set((st) => ({ thinking: star_id, chat: [...st.chat, { role: 'human', text: question }] }))
      await act(async (sid) => {
        const r = await current.explain(sid, { star_id, question, history })
        set((st) => ({ chat: [...st.chat, { role: 'litmus', text: r.answer, provenance: r.provenance }] }))
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


// Before the first claim is chosen, Litmus asks where to start (a bubble from its face).
export const useStarting = () => useStore((s) => { const ss = s.app.session; return !!ss && !ss.start_claim_ids?.length && ss.stars.every((x) => !x.parent_id) })
