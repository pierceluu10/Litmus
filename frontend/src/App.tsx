import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Login, Signup } from './components/Auth'
import { Landing } from './components/Landing'
import { toneVar } from './lib/format'
import { TopBar } from './components/TopBar'
import { Claims } from './components/Claims'
import { Scene } from './components/Scene'
import { Dock } from './components/Dock'
import { Inspector } from './components/Inspector'

// tiny hash router: '' is the home page, #/login and #/signup are the account pages
function useHash() {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
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
  const hash = useHash()
  if (!session) return hash === '#/login' ? <Login /> : hash === '#/signup' ? <Signup /> : <Landing />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(220px,264px)_minmax(0,1fr)_minmax(300px,360px)] lg:overflow-hidden">
        <Claims />
        <main className="marble-ground relative min-h-0 overflow-hidden max-lg:order-first max-lg:h-[72vh]">
          <Scene />
          <SceneChrome />
          <Dock />
        </main>
        <Inspector />
      </div>
    </div>
  )
}
