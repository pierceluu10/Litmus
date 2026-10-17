import { useRef, useState } from 'react'
import { useAnimationFrame } from 'motion/react'
import { useStore } from '../store'
import { statueAnchor } from '../lib/statueAnchor'
import { ClaimCard } from './ClaimPicker'
import { SceneBackdrop } from './LowPolyScene'

const FROM_HEAD = { x: 34, y: -46 } // px from the statue's head to the bubble's top-left corner: just right of his face
const EDGE = 12 // px the bubble keeps from the bottom of the window
const CLEAR = { x: 16, y: 120 } // the least left/top offset: clear of the legend and the scene buttons
const START_FACETS = 71

// "Where should we start?": the first thing Litmus says, a speech bubble out of the statue's head listing your highlights,
// notes first. Open one for its whole card (paper, your note, the passage, the source); Start begins there.
export function StartBubble() {
  const { app, libraryStage, start } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const box = useRef<HTMLElement>(null)
  const claims = app.claims.slice().sort((a, b) => a.rank - b.rank)
  // follow the head as the camera settles, kept on screen
  useAnimationFrame(() => {
    const el = box.current
    if (!el) return
    // until the statue is on screen (it loads a moment after the page) the bubble waits in the top left
    const head = statueAnchor.visible ? statueAnchor.head : { x: -Infinity, y: -Infinity }
    const top = Math.max(CLEAR.y, head.y + FROM_HEAD.y)
    el.style.transform = `translate(${Math.max(CLEAR.x, head.x + FROM_HEAD.x)}px, ${top}px)`
    el.style.maxHeight = `${innerHeight - top - EDGE}px`
  })
  const go = async (id: string) => { setBusy(id); await start([id]); setBusy(null) }
  return (
    <section ref={box} aria-label="Where should we start?" className="pointer-events-auto fixed left-0 top-0 z-30 flex w-[360px] flex-col rounded-2xl rounded-tl-md border border-rule bg-surface shadow-[0_16px_40px_-12px_rgba(43,58,82,0.35)]">
      <span aria-hidden className="absolute -left-[7px] top-4 h-3.5 w-3.5 rotate-45 border-b border-l border-rule bg-surface" />
      <div className="relative isolate flex min-h-0 flex-col overflow-hidden rounded-2xl rounded-tl-md">
        <SceneBackdrop seed={START_FACETS} className="card-facets" />
        <div className="px-3.5 pb-2 pt-3">
          <h2 className="m-0 text-[14px] font-semibold">Where should we start?</h2>
          <p className="m-0 mt-0.5 text-[12px] text-muted">{libraryStage === 'ready' ? 'Pick the claim you doubt most. Open one to read it first.' : 'Reading your highlights and notes…'}</p>
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
