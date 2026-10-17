import { create } from 'zustand'
import type { AppState } from './reducer'
import { useStore } from './store'

// A guided tour of the workspace. It runs on the in-browser practice backend (no keys, no GPU, no cost), and each step
// waits until what it describes is actually on screen, so the pop-ups never point at something that isn't there yet.
export type Step = {
  title: string
  body: string
  target?: string // CSS selector of the thing the pop-up points at
  place: 'center' | 'top' | 'left' | 'scene'
  spot?: boolean // ring the target and dim the rest (default true when there is a target)
  ready?: (app: AppState) => boolean
  waiting?: string
  nextLabel?: string
  onEnter?: () => void
  onNext?: () => void
}

const stars = (app: AppState) => app.session?.stars ?? []
const graded = (app: AppState) => stars(app).filter((s) => s.grade && s.grade.verdict !== 'baseline')
const openProposals = (app: AppState) => (app.session?.proposals ?? []).filter((p) => p.status === 'open')
const starting = (app: AppState) => !app.session?.start_claim_ids?.length
const openQuestion = (app: AppState) => (app.session?.questions ?? []).find((q) => q.status === 'open')
const state = () => useStore.getState()

export const STEPS: Step[] = [
  { title: 'Welcome to the workspace', body: 'This is a practice session, so nothing here costs anything. We’ll walk through how a piece of research runs. Press Next whenever you’re ready.', place: 'center' },
  { title: 'Where research starts', body: 'The statue points at the starting line. The black ball is the baseline: a first test of the plain, unchanged model, so every later result has something to be compared against.', target: '[data-tour="scene"]', place: 'scene', spot: false, ready: (a) => stars(a).length > 0, waiting: 'Running the baseline…' },
  { title: 'Litmus asks where to start', body: 'Litmus is the lead researcher. Its first question: which of your highlighted claims should we test? Each claim you pick gets its own agent.', target: '[data-tour="results"]', place: 'left', nextLabel: 'Start with three for me', ready: (a) => a.claims.length > 0 && (starting(a) || stars(a).length > 1), waiting: 'Reading your highlights and notes…',
    onNext: () => { const a = state().app; if (starting(a)) void state().start(a.claims.slice().sort((x, y) => x.rank - y.rank).slice(0, 3).map((c) => c.id)) } },
  { title: 'Each test is an agent', body: 'Every experiment becomes a ball in a column, like the layers of a neural network. A ring fills while it trains, then turns green, red or grey for its verdict.', target: '[data-tour="scene"]', place: 'scene', spot: false, ready: (a) => stars(a).length > 1, waiting: 'Agents are starting…' },
  { title: 'Which claim is being tested', body: 'This card names the claim each running agent is working on, so you always know what a test is for.', target: '[data-tour="researching"]', place: 'scene', ready: (a) => stars(a).length > 1 },
  { title: 'Where should I proceed?', body: 'When an agent finishes, it reads what the other agents found and offers its next steps. Tick the ones you want and press Dispatch, or leave it for later.', target: '[data-tour="dock"]', place: 'top', ready: (a) => openProposals(a).length > 0, waiting: 'Waiting for an agent to finish…' },
  { title: 'Ranked on one scale', body: 'As results arrive they’re ranked together. Every test comes from something you read, and they’re all measured against the baseline, so you can see which ideas actually helped.', target: '[data-tour="results"]', place: 'left', ready: (a) => graded(a).length >= 2, waiting: 'Waiting for results…' },
  { title: 'It asks you when it matters', body: 'When a result surprises an agent, it stops and asks you, with the evidence attached. Here mixup lost accuracy even though the paper says it wins. Test it longer, or drop it?', target: '[data-tour="dock"]', place: 'top', nextLabel: 'Test it longer', ready: (a) => !!openQuestion(a), waiting: 'Waiting for a surprising result…',
    onNext: () => { const q = openQuestion(state().app); if (q) void state().answer(q.id, q.options[0].id) } },
  { title: 'Your choice is recorded', body: 'Your answer runs, and the agent’s own leaning is remembered. “Where you changed course” shows the difference, so you can see whether your judgment paid off.', target: '[data-tour="results"]', place: 'left', ready: (a) => (a.session?.decisions ?? []).some((d) => d.kind === 'answer'), waiting: 'Recording your choice…' },
  { title: 'Open any agent', body: 'Click any ball to see which agent ran it, its verdict, what it suggests next, and the claim it tested. Ask Litmus about it at the bottom: Litmus has followed every agent.', target: '[data-tour="results"]', place: 'scene', ready: (a) => graded(a).length > 0,
    onEnter: () => { const g = graded(state().app); if (g.length) state().select(g[0].id) } },
  { title: 'Write it up', body: 'When you’re happy, Generate abstract writes a short summary where every line points back to the experiment behind it and the sentence you read.', target: '[data-tour="generate"]', place: 'left', ready: (a) => graded(a).length > 0 },
  { title: 'That’s the tour', body: 'You can keep exploring this practice session, or head back and start real research on your own reading.', place: 'center', nextLabel: 'Keep exploring' },
]

type Tutorial = { active: boolean; step: number; start: () => Promise<void>; next: () => void; back: () => void; stop: () => void }

export const useTutorial = create<Tutorial>((set, get) => ({
  active: false,
  step: 0,
  async start() {
    useStore.setState({ demo: true }) // the practice backend, for this visit only: it is not saved
    set({ active: true, step: 0 })
    await useStore.getState().begin(false)
  },
  next() {
    const { step } = get()
    STEPS[step].onNext?.()
    if (step >= STEPS.length - 1) { set({ active: false }); return }
    const n = step + 1
    set({ step: n })
    STEPS[n].onEnter?.()
  },
  back() { set((s) => ({ step: Math.max(0, s.step - 1) })) },
  stop() { set({ active: false }) },
}))
