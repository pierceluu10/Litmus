import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, usePanelOpen, useStarting } from '../store'
import { StartBubble } from './StartBubble'

const SHOW_MS = 9000
const MAX_QUEUED = 5
type Bubble = { seq: number; text: string }

// Litmus's face sits in the top right of the scene; whenever the agent does something it says so in a speech bubble
// that pops out beside it and fades away. Your own actions (answers, notes) are not narrated back to you.
export function AgentBubbles() {
  const feed = useStore((s) => s.app.feed)
  const [queue, setQueue] = useState<Bubble[]>([])
  const [shown, setShown] = useState<Bubble | null>(null)
  const open = usePanelOpen()
  const starting = useStarting()
  const set = useStore((s) => s.set)
  const seen = useRef(feed.length)
  useEffect(() => {
    const fresh = feed.slice(seen.current).filter((f) => f.kind !== 'decision' && f.kind !== 'feedback')
    seen.current = feed.length
    if (fresh.length) setQueue((q) => [...q, ...fresh.map((f) => ({ seq: f.seq, text: f.kind === 'search' ? `Searching your library for “${f.text}”.` : f.text }))].slice(-MAX_QUEUED))
  }, [feed])
  // one bubble at a time, each long enough to read, so a result is never pushed off by the next step
  useEffect(() => {
    if (shown || !queue.length) return
    const [next, ...rest] = queue
    setQueue(rest); setShown(next)
  }, [queue, shown])
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), Math.min(SHOW_MS, 3200 + shown.text.length * 45))
    return () => clearTimeout(timer)
  }, [shown])
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-start justify-end gap-2.5 lg:right-3">
      {starting && <StartBubble />}
      <ul aria-live="polite" className="m-0 flex max-w-[min(360px,50vw)] list-none flex-col items-end gap-1.5 p-0 pt-1">
        <AnimatePresence initial={false}>
          {!open && !starting && shown && [shown].map((b) => (
            <motion.li key={b.seq} initial={{ opacity: 0, scale: 0.9, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', duration: 0.4, bounce: 0.18 }} style={{ transformOrigin: 'right center' }}
              className="relative rounded-2xl rounded-tr-md border border-rule bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)]">
              <span className="line-clamp-4">{b.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button aria-pressed={open} aria-label={open ? 'Close results' : 'Open results'} title={open ? 'Close results' : 'Results'} className="pointer-events-auto shrink-0 rounded-full border bg-surface p-1 shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)] transition-transform active:scale-95"
        style={{ borderColor: open ? 'var(--color-ink)' : 'var(--color-rule)' }}
        onClick={() => set(open ? { panelOpen: false, selectedId: null, abstractOpen: false, hoveredClaim: null } : { panelOpen: true })}>
        <img src="/litmus-face.svg" alt="" width={44} height={44} />
      </button>
    </div>
  )
}
