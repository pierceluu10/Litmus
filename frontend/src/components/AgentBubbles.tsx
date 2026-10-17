import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, useStarting } from '../store'
import { StartBubble } from './StartBubble'

const SHOW_MS = 9000
const MAX_QUEUED = 5
type Bubble = { seq: number; text: string }

// "Where should we start?" comes out of the statue's head until the session has its first claim.
export function StartPrompt() {
  return useStarting() ? <StartBubble /> : null
}

// Litmus's face sits under the results card and opens the chat with it. Whenever the agents do something, Litmus says
// so in a speech bubble that rises above its face and fades away (not while the chat is open, where the
// conversation already is). Your own actions (answers, notes) are not narrated back to you.
export function AgentBubbles() {
  const feed = useStore((s) => s.app.feed)
  const [queue, setQueue] = useState<Bubble[]>([])
  const [shown, setShown] = useState<Bubble | null>(null)
  const { chatOpen, set } = useStore()
  const starting = useStarting()
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
    <div className="relative mt-auto flex shrink-0 justify-end">
      <ul aria-live="polite" className="pointer-events-none absolute bottom-[calc(100%+8px)] right-1 z-10 m-0 flex w-max max-w-[320px] list-none flex-col items-end gap-1.5 p-0">
        <AnimatePresence initial={false}>
          {!chatOpen && !starting && shown && [shown].map((b) => (
            <motion.li key={b.seq} initial={{ opacity: 0, scale: 0.9, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', duration: 0.4, bounce: 0.18 }} style={{ transformOrigin: 'right bottom' }}
              className="relative rounded-2xl rounded-br-md border border-rule bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)]">
              <span className="line-clamp-4">{b.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button aria-pressed={chatOpen} aria-label={chatOpen ? 'Close the chat with Litmus' : 'Chat with Litmus'} title={chatOpen ? 'Close chat' : 'Chat with Litmus'}
        className="flex items-center gap-2 rounded-full border bg-surface py-1 pl-1 pr-3.5 shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)] transition-transform active:scale-95"
        style={{ borderColor: chatOpen ? 'var(--color-ink)' : 'var(--color-rule)' }} onClick={() => set({ chatOpen: !chatOpen })}>
        <img src="/litmus-face.svg" alt="" width={36} height={36} />
        <span className="text-[13px] font-semibold">{chatOpen ? 'Close chat' : 'Ask Litmus'}</span>
      </button>
    </div>
  )
}
