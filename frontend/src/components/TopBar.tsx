import { useState } from 'react'
import { useStore } from '../store'
import { Whimsy } from './Whimsy'
import { PapiersHighlights } from './PapiersHighlights'
import { DEMO_ONLY } from '../transport/api'

export function TopBar() {
  const { app, conn, generateAbstract, error, set, leave } = useStore()
  const s = app.session!
  const graded = s.stars.filter((x) => x.grade && x.grade.verdict !== 'baseline').length
  const [writing, setWriting] = useState(false)
  const write = async () => { setWriting(true); await generateAbstract(); setWriting(false) }
  return (
    <header className="flex h-12 items-center gap-5 border-b border-rule bg-surface px-4">
      <button className="inline-flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.02em]" aria-label="Litmus, back to the home page" onClick={leave}><img src="/litmus-face.svg" alt="" width={24} height={24} />Litmus</button>
      {conn === 'reconnecting' && <span className="text-waiting">Reconnecting…</span>}
      {error && <span role="alert" className="min-w-0 truncate text-refuted">{error}</span>}
      <div className="ml-auto flex items-center gap-4">
        {!DEMO_ONLY && <PapiersHighlights />}
        {s.abstract && <button className="btn" onClick={() => set({ abstractOpen: true, selectedId: null, chatOpen: false })}>Read abstract</button>}
        <button className="btn btn-primary min-w-[170px]" disabled={!graded || writing} onClick={write}>
          {writing ? <Whimsy lead="Writing the abstract" /> : s.abstract ? 'Regenerate abstract' : 'Generate abstract'}
        </button>
      </div>
    </header>
  )
}
