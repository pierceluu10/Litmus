import { useState } from 'react'
import { useStore } from '../store'
import { toneVar } from '../lib/format'
import { ClaimCard } from './ClaimPicker'
import { STAGE_TEXT } from './Researching'
import { SceneBackdrop } from './LowPolyScene'

const START_FACETS = 71

// "Where should we start?": the first thing Litmus says, a speech bubble rising from its face at the bottom right, listing
// your highlights, notes first. Open one for its whole card (paper, your note, the passage, the source); Start begins there.
export function StartBubble() {
  const { app, libraryStage, start } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const claims = app.claims.slice().sort((a, b) => a.rank - b.rank)
  const go = async (id: string) => { setBusy(id); await start([id]); setBusy(null) }
  return (
    <section aria-label="Where should we start?" className="relative flex min-h-0 flex-col rounded-2xl rounded-br-md marble-edge border border-rule bg-surface">
      <span aria-hidden className="absolute -bottom-[7px] right-6 h-3.5 w-3.5 rotate-45 border-b border-r border-rule bg-surface" />
      <div className="relative isolate flex min-h-0 flex-col overflow-hidden rounded-2xl rounded-br-md">
        <SceneBackdrop seed={START_FACETS} className="card-facets" />
        <div className="px-3.5 pb-2 pt-3">
          <h2 className="m-0 text-[14px] font-semibold">Where should we start?</h2>
          {libraryStage === 'ready'
            ? <p className="m-0 mt-0.5 text-[12px] text-muted">Pick the claim you doubt most. Open one to read it first.</p>
            : <p className="m-0 mt-1 flex items-center gap-2 text-[12px] text-muted" aria-live="polite"><span className="dot live-dot" style={{ background: toneVar('running') }} />{STAGE_TEXT[libraryStage]}…</p>}
        </div>
        {libraryStage === 'ready' && (
          <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto border-t border-rule p-1.5">
            {claims.map((c) => (
              <ClaimCard key={c.id} c={c} status="untested" stars={[]} doc={app.documents.find((d) => d.id === c.doc_id)} expanded={expanded === c.id}
                onToggle={() => setExpanded(expanded === c.id ? null : c.id)} onTest={() => go(c.id)} busy={busy === c.id} canTest={!busy}
                action="Start" showStatus={false} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
