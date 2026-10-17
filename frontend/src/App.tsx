import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Login, Signup } from './components/Auth'
import { Landing } from './components/Landing'
import { toneVar } from './lib/format'
import { TopBar } from './components/TopBar'
import { Researching } from './components/Researching'
import { Scene } from './components/Scene'
import { Facets } from './components/LowPolyScene'
import { Dock } from './components/Dock'
import { Inspector } from './components/Inspector'

// tiny hash router: '' is the home page, #/login and #/signup are the account pages
function useHash() {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

const SCENE_FACETS = 77 // the faceted backdrop behind the statue and the graph
const SCENE_FACET_CELL = 110 // larger facets than the rails, so the backdrop reads as low-poly
const LEGEND = [['confirmed', 'confirmed'], ['refuted', 'refuted'], ['inconclusive', 'inconclusive'], ['running', 'training'], ['waiting', 'needs you']] as const

function SceneChrome() {
  const { follow, set, fitAll } = useStore()
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-3 z-30 max-w-[min(60%,520px)] space-y-1.5">
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          {LEGEND.map(([tone, label]) => <span key={tone} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: toneVar(tone) }} />{label}</span>)}
        </p>
      </div>
      <div className="absolute right-3 top-3 z-30 flex gap-1.5">
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={follow} onClick={() => set({ follow: !follow })} style={follow ? { borderColor: 'var(--color-ink)' } : undefined}>
          {follow ? 'Following' : 'Follow'} new branches
        </button>
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={fitAll} title={fitAll ? 'Go back to the default view' : 'Zoom out to see every experiment'} onClick={() => set({ follow: false, fitAll: !fitAll })} style={fitAll ? { borderColor: 'var(--color-ink)' } : undefined}>{fitAll ? 'Default view' : 'Fit all'}</button>
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
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:overflow-hidden">
        <main className="marble-ground relative min-h-0 overflow-hidden max-lg:order-first max-lg:h-[72vh]">
          <Facets seed={SCENE_FACETS} width={1600} height={1000} cell={SCENE_FACET_CELL} />
          <Scene />
          <SceneChrome />
          <Researching />
          <Dock />
        </main>
        <Inspector />
      </div>
    </div>
  )
}
