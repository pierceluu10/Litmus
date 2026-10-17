import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Login, Signup } from './components/Auth'
import { Landing } from './components/Landing'
import { toneVar } from './lib/format'
import { TopBar } from './components/TopBar'
import { Researching } from './components/Researching'
import { Scene } from './components/Scene'
import { SceneBackdrop } from './components/LowPolyScene'
import { Dock } from './components/Dock'
import { Inspector } from './components/Inspector'
import { Tutorial } from './components/Tutorial'

// tiny hash router: '' is the home page, #/login and #/signup are the account pages
function useWide() {
  const [on, setOn] = useState(() => matchMedia('(min-width: 1024px)').matches)
  useEffect(() => { const m = matchMedia('(min-width: 1024px)'), f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return on
}

function useHash() {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

const SCENE_FACETS = 77 // the faceted backdrop behind the statue and the graph
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
      <div className="absolute right-3 top-3 z-30 flex gap-1.5 lg:right-[calc(var(--panel)+0.75rem)]">
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={follow} onClick={() => set({ follow: !follow })} style={follow ? { borderColor: 'var(--color-ink)' } : undefined}>
          {follow ? 'Following' : 'Follow'} new branches
        </button>
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={fitAll} title={fitAll ? 'Go back to the default view' : 'Zoom out to see every experiment'} onClick={() => set({ follow: false, fitAll: !fitAll })} style={fitAll ? { borderColor: 'var(--color-ink)' } : undefined}>{fitAll ? 'Default view' : 'Fit all'}</button>
      </div>
    </>
  )
}

function Screens() {
  const session = useStore((s) => s.app.session)
  const hash = useHash()
  const wide = useWide()
  if (!session) return hash === '#/login' ? <Login /> : hash === '#/signup' ? <Signup /> : <Landing />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        {/* --panel is the room the floating results card takes on the right; the scene's own controls keep clear of it */}
        <main data-tour="scene" className="marble-ground relative min-h-0 flex-1 overflow-hidden max-lg:h-[72vh] max-lg:flex-none lg:[--panel:372px]">
          <SceneBackdrop seed={SCENE_FACETS} />
          <Scene />
          <SceneChrome />
          <Researching />
          <Dock />
          {wide && <Inspector floating />}
        </main>
        {!wide && <Inspector floating={false} />}
      </div>
    </div>
  )
}

// The tour is mounted above every screen, so leaving the workspace always ends it (it cannot linger and reappear later).
export default function App() {
  return <><Screens /><Tutorial /></>
}
