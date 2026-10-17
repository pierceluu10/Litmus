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

function Start() {
  const { begin, health, set, error } = useStore()
  const [goal, setGoal] = useState('Which training tricks actually help a tiny CIFAR-10 classifier?')
  useEffect(() => { api.health().then((h) => set({ health: h })).catch((e) => set({ error: `Backend unreachable: ${e.message}` })) }, [set])
  return (
    <main className="grid h-full place-items-center p-6">
      <div className="w-full max-w-[560px]">
        <h1 className="m-0 font-serif text-[40px] font-semibold">Litmus</h1>
        <p className="mt-2 font-serif text-[18px] leading-snug">Turns the claims you highlighted into experiments, runs them with parallel agents, and lets you steer at every branch.</p>
        <label htmlFor="goal" className="mt-6 block font-medium">Research goal</label>
        <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2" />
        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" onClick={() => begin(false, goal)}>Start research</button>
          <button className="btn" onClick={() => begin(true)}>Replay demo</button>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          {api.mock ? 'Mock mode: the backend is simulated in your browser.' : health ? `Backend: GPU ${health.modal_warm ? 'warm' : 'cold'}, Papiers ${health.papiers_ok ? 'ok' : 'unavailable'}, OpenAI ${health.openai_ok ? 'ok' : 'unavailable'}.` : 'Checking the backend…'}
        </p>
        {error && <p role="alert" className="text-refuted">{error}</p>}
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
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[290px_minmax(0,1fr)_370px] lg:overflow-hidden">
        <div className="flex min-h-0 flex-col border-r border-rule bg-surface/60 max-lg:max-h-[60vh]"><Library /><Feed /></div>
        <div className="flex min-h-0 min-w-0 flex-col max-lg:h-[80vh]">
          <div className="relative min-h-0 flex-1"><StarMap /><Legend /><Dock /></div>
          <Timeline />
        </div>
        <div className="min-h-0 overflow-y-auto border-l border-rule bg-surface/60"><Sidebar /></div>
      </div>
      {abstractOpen && <AbstractPanel />}
    </div>
  )
}
