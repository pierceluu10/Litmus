import { useEffect, useState } from 'react'
import { api, useStore } from './store'
import { DEFAULT_GOAL } from './transport/api'
import { toneVar } from './lib/format'
import { TopBar } from './components/TopBar'
import { Claims } from './components/Claims'
import { Scene } from './components/Scene'
import { Dock } from './components/Dock'
import { Inspector } from './components/Inspector'

function Start() {
  const { begin, health, set, error } = useStore()
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  useEffect(() => { if (!api.mock) api.health().then((h) => set({ health: h })).catch((e) => set({ error: `Backend unreachable: ${e.message}` })) }, [set])
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-[clamp(20px,4vw,48px)]">
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Litmus</span>
      <form className="pointer-events-auto ml-auto w-full max-w-[420px] pb-[6vh]" onSubmit={(e) => { e.preventDefault(); begin(false, goal) }}>
        <h1 className="m-0 text-[clamp(32px,3.6vw,48px)] font-semibold leading-[1.04] tracking-[-0.04em]">Test what you read.</h1>
        <p className="m-0 mt-3 max-w-[40ch] text-[15px] leading-snug text-muted">The claims you highlighted in Papiers become GPU experiments. Agents branch, a locked grader judges every result, and you steer.</p>
        <label htmlFor="goal" className="label mt-7 block">Research question</label>
        <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="field mt-1.5 h-10 text-[14px]" />
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className="btn btn-primary h-10 px-5 text-[14px]">Start research</button>
          {!api.mock && <button type="button" className="btn btn-quiet h-10" onClick={() => begin(true)}>Replay a recorded session</button>}
        </div>
        {!api.mock && health && <p className="num m-0 mt-3 text-[11.5px] text-faint">GPU {health.modal_warm ? 'warm' : 'cold'} · Papiers {health.papiers_ok ? 'ok' : 'down'} · OpenAI {health.openai_ok ? 'ok' : 'down'}</p>}
        {error && <p role="alert" className="m-0 mt-3 text-refuted">{error}</p>}
      </form>
    </div>
  )
}

const LEGEND = [['confirmed', 'confirmed'], ['refuted', 'refuted'], ['inconclusive', 'inconclusive'], ['running', 'training'], ['waiting', 'needs you']] as const

function SceneChrome() {
  const { app, follow, set, fitRequest } = useStore()
  const latest = app.feed[app.feed.length - 1]
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-3 z-30 max-w-[min(60%,520px)] space-y-1.5">
        {latest && <p className="m-0 truncate text-[12.5px] text-muted" aria-live="polite">{latest.kind === 'search' ? `Searching your library: ${latest.text}` : latest.text}</p>}
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          {LEGEND.map(([tone, label]) => <span key={tone} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: toneVar(tone) }} />{label}</span>)}
          <span>· higher is more accurate</span>
        </p>
      </div>
      <div className="absolute right-3 top-3 z-30 flex gap-1.5">
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={follow} onClick={() => set({ follow: !follow })} style={follow ? { borderColor: 'var(--color-ink)' } : undefined}>
          {follow ? 'Following' : 'Follow'} new branches
        </button>
        <button className="btn h-7 px-2.5 text-[12px]" onClick={() => set({ follow: false, fitRequest: fitRequest + 1 })}>Fit all</button>
      </div>
    </>
  )
}

export default function App() {
  const session = useStore((s) => s.app.session)
  return (
    <div className="flex h-full flex-col">
      {session && <TopBar />}
      <div className={`grid min-h-0 flex-1 ${session ? 'grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(220px,264px)_minmax(0,1fr)_minmax(300px,360px)] lg:overflow-hidden' : 'grid-cols-1'}`}>
        {session && <Claims />}
        <main className={`marble-ground relative min-h-0 overflow-hidden ${session ? 'max-lg:order-first max-lg:h-[72vh]' : ''}`}>
          <Scene />
          {session ? <><SceneChrome /><Dock /></> : <Start />}
        </main>
        {session && <Inspector />}
      </div>
    </div>
  )
}
