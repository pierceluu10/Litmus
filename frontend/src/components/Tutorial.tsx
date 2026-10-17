import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { STEPS, useTutorial, type Step } from '../tutorial'

type Box = { x: number; y: number; w: number; h: number }
const MARGIN = 12, GAP = 14, WIDTH = 340, PAD = 6

// Follows the target's on-screen rectangle (it moves with the panels and the window), or null while it isn't there.
function useRect(selector?: string): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    if (!selector) { setBox(null); return }
    let raf = 0
    const tick = () => {
      const r = document.querySelector(selector)?.getBoundingClientRect()
      const next = r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
      setBox((p) => (p && next && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 && Math.abs(p.w - next.w) < 0.5 && Math.abs(p.h - next.h) < 0.5) || (!p && !next) ? p : next)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [selector])
  return box
}

function position(step: Step, box: Box | null, h: number): { x: number; y: number } {
  const vw = innerWidth, vh = innerHeight
  let x = (vw - WIDTH) / 2, y = (vh - h) / 2
  if (!box && step.target) { x = MARGIN + 16; y = vh * 0.3 } // the target isn't on screen yet: wait over the statue, clear of the graph
  else if (box && step.place !== 'center') {
    if (step.place === 'top') { x = box.x + 28; y = box.y - h - GAP; if (y < MARGIN) y = box.y + box.h + GAP } // left-aligned, so it stays off the graph in the middle
    else if (step.place === 'left') {
      // a tall panel gets the pop-up inside its empty lower half; a small control gets it just below, right-aligned
      if (box.h < 120) { x = box.x + box.w - WIDTH; y = box.y + box.h + GAP }
      else { x = box.x + (box.w - WIDTH) / 2; y = box.y + box.h - h - 16 }
    }
    else { x = box.x + 28; y = box.y + box.h * 0.36 } // 'scene': inside the big canvas, clear of the cards in its corners
  }
  return { x: Math.max(MARGIN, Math.min(x, vw - WIDTH - MARGIN)), y: Math.max(MARGIN, Math.min(y, vh - h - MARGIN)) }
}

export function Tutorial() {
  const { active, step, next, back, stop } = useTutorial()
  const app = useStore((s) => s.app)
  const session = useStore((s) => s.app.session)
  const s = STEPS[step]
  const box = useRect(active ? s.target : undefined) // what is ringed
  const anchor = useRect(active ? (s.place === 'scene' ? '[data-tour="scene"]' : s.target) : undefined) // what the pop-up is placed against
  const card = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(200)
  useLayoutEffect(() => { if (card.current) setH(card.current.offsetHeight) }, [step, active, anchor === null])
  // Leaving the workspace ends the tour. Only a session that was open and then closed counts: right after Tutorial is pressed there is no session yet.
  const hadSession = useRef(false)
  useEffect(() => {
    if (session) hadSession.current = true
    else if (hadSession.current) { hadSession.current = false; if (active) stop() }
  }, [active, session, stop])
  useEffect(() => {
    if (!active) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') stop() }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [active, stop])
  if (!active || !session) return null
  const ready = !s.ready || s.ready(app)
  const pos = position(s, anchor, h)
  const last = step === STEPS.length - 1
  const ring = !!box && s.spot !== false
  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-live="polite">
      {ring && (
        <motion.div className="absolute rounded-2xl" initial={false} animate={{ x: box!.x - PAD, y: box!.y - PAD, width: box!.w + PAD * 2, height: box!.h + PAD * 2 }} transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
          style={{ left: 0, top: 0, boxShadow: '0 0 0 2px var(--color-ink), 0 0 0 9999px rgb(21 24 28 / 0.16)' }} />
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} ref={card} role="dialog" aria-label={s.title} className="pointer-events-auto absolute rounded-2xl border border-rule bg-surface p-4 shadow-[0_24px_60px_-12px_rgba(21,24,28,0.35)]"
          style={{ left: pos.x, top: pos.y, width: WIDTH }} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
          <div className="flex items-center justify-between">
            <span className="label">Tutorial · {step + 1} of {STEPS.length}</span>
            <button className="btn btn-quiet h-6 px-1.5 text-[12px]" onClick={stop}>Skip</button>
          </div>
          <h2 className="m-0 mt-1.5 text-[16px] font-semibold tracking-[-0.01em]">{s.title}</h2>
          <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button className="btn btn-quiet h-8 px-2.5" onClick={back} disabled={step === 0}>Back</button>
            <div className="flex items-center gap-2">
              {!ready && <span className="flex items-center gap-1.5 text-[12px] text-muted"><span className="dot live-dot" style={{ background: 'var(--color-running)' }} />{s.waiting}</span>}
              {last && <button className="btn h-8" onClick={() => { stop(); useStore.getState().leave() }}>Back to home</button>}
              <button className="btn btn-primary h-8" disabled={!ready} autoFocus onClick={next}>{s.nextLabel ?? (last ? 'Done' : 'Next')}</button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
