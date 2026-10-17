import { useEffect, useState } from 'react'
import { api, useStore } from './store'
import { TopBar } from './components/TopBar'
import { Library } from './components/Library'
import { Feed } from './components/Feed'
import { StarMap } from './components/StarMap'
import { Legend } from './components/Legend'
import { Dock } from './components/Dock'
import { Timeline } from './components/Timeline'
import { Sidebar } from './components/Sidebar'
import { AbstractPanel } from './components/AbstractPanel'
import { LowPolyScene } from './components/LowPolyScene'

function Start() {
  const { begin, health, set, error } = useStore()
  const [goal, setGoal] = useState('Which training tricks actually help a tiny CIFAR-10 classifier?')
  useEffect(() => { api.health().then((h) => set({ health: h })).catch((e) => set({ error: `Backend unreachable: ${e.message}` })) }, [set])
  return (
    <main className="relative h-full overflow-hidden bg-[#eef2f7] font-[Helvetica_Neue,Helvetica,Arial,sans-serif]">
      <LowPolyScene className="absolute inset-0 h-full w-full" />
      <div className="relative flex h-full flex-col justify-between p-[clamp(20px,4vw,56px)]">
        <header className="flex items-start justify-between">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Litmus</h1>
          <p className="m-0 max-w-[260px] text-right text-[13px] text-muted">
            {api.mock ? 'Mock mode: the backend is simulated in your browser.' : health ? `GPU ${health.modal_warm ? 'warm' : 'cold'} · Papiers ${health.papiers_ok ? 'ok' : 'unavailable'} · OpenAI ${health.openai_ok ? 'ok' : 'unavailable'}` : 'Checking the backend…'}
          </p>
        </header>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
          <div className="max-w-[400px]">
            <p className="m-0 text-[clamp(30px,4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em]">Turn what you highlighted into experiments.</p>
            <p className="mt-3 max-w-[46ch] text-[16px] leading-snug text-muted">Parallel agents test the claims you read, and you steer at every branch.</p>
          </div>
          <div className="w-full max-w-[400px]">
            <label htmlFor="goal" className="block text-[13px] font-medium">Research goal</label>
            <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2" />
            <div className="mt-3 flex gap-2">
              <button className="btn btn-primary" onClick={() => begin(false, goal)}>Start research</button>
              <button className="btn" onClick={() => begin(true)}>Replay demo</button>
            </div>
            {error && <p role="alert" className="mb-0 mt-2 text-refuted">{error}</p>}
          </div>
        </div>
      </div>
    </main>
  )
}

export default function App() {
  const { app, abstractOpen } = useStore()
  if (!app.session) return <Start />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[270px_minmax(0,1fr)_350px] lg:overflow-hidden">
        <div className="flex min-h-0 flex-col border-r border-rule bg-surface max-lg:max-h-[60vh]"><Library /><Feed /></div>
        <div className="flex min-h-0 min-w-0 flex-col max-lg:h-[80vh]">
          <div className="relative min-h-0 flex-1"><StarMap /><Legend /><Dock /></div>
          <Timeline />
        </div>
        <div className="min-h-0 overflow-y-auto border-l border-rule bg-surface"><Sidebar /></div>
      </div>
      {abstractOpen && <AbstractPanel />}
    </div>
  )
}
