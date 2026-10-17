import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useStore, usePanelOpen } from './store'
import { Login, Signup } from './components/Auth'
import { Upload } from './components/Upload'
import { Landing } from './components/Landing'
import { toneVar } from './lib/format'
import { TopBar } from './components/TopBar'
import { ClaimPicker } from './components/ClaimPicker'
import { AgentBubbles } from './components/AgentBubbles'
import { Scene } from './components/Scene'
import { SceneBackdrop } from './components/LowPolyScene'
import { Dock } from './components/Dock'
import { Inspector } from './components/Inspector'
import { ThoughtFlight } from './components/ThoughtFlight'

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
  const { set, fitAll, app } = useStore()
  // Fit all zooms out and closes the speech bubbles (they would slide around as the camera moves); Default view goes
  // back to following the newest branch, which is always on otherwise.
  const fit = () => set(fitAll ? { fitAll: false, follow: true, focusId: app.lastStarId ?? null } : { fitAll: true, follow: false, cardFor: null })
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-3 z-30 max-w-[min(60%,520px)] space-y-1.5">
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          {LEGEND.map(([tone, label]) => <span key={tone} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: toneVar(tone) }} />{label}</span>)}
        </p>
      </div>
      <div className="absolute left-4 top-10 z-40 flex gap-1.5">
        <button className="btn h-7 px-2.5 text-[12px]" aria-pressed={fitAll} title={fitAll ? 'Go back to the default view' : 'Zoom out to see every experiment'} onClick={fit} style={fitAll ? { borderColor: 'var(--color-ink)' } : undefined}>{fitAll ? 'Default view' : 'Fit all'}</button>
        <ClaimPicker />
      </div>
    </>
  )
}

function Screens() {
  const session = useStore((s) => s.app.session)
  const hash = useHash()
  const wide = useWide()
  const open = usePanelOpen()
  if (!session) return hash === '#/login' ? <Login /> : hash === '#/signup' ? <Signup /> : hash === '#/upload' ? <Upload /> : <Landing />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        {/* --panel / --rail: the room the floating cards take on the right and left; the scene's controls and the dock keep clear */}
        <main className="marble-ground relative min-h-0 flex-1 overflow-hidden max-lg:h-[72vh] max-lg:flex-none lg:[--rail:0px]" style={{ '--panel': open ? '372px' : '0px' } as React.CSSProperties}>
          <SceneBackdrop seed={SCENE_FACETS} />
          <Scene />
          <SceneChrome />
          <AgentBubbles />
          <Dock />
          {wide && <AnimatePresence>{open && <Inspector floating key="panel" />}</AnimatePresence>}
        </main>
        {!wide && open && <Inspector floating={false} />}
      </div>
      <ThoughtFlight />
    </div>
  )
}

// The tour is mounted above every screen, so leaving the workspace always ends it (it cannot linger and reappear later).
export default function App() {
  return <Screens />
}
