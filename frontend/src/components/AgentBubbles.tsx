import { AnimatePresence, motion } from 'motion/react'
import { commonQuestions } from '../lib/questions'
import { askLitmus, useStarting, useStore } from '../store'
import { SceneBackdrop } from './LowPolyScene'

const BUBBLE_FACETS = 89

// Litmus's face sits under the results card and opens the chat with it. Litmus does not narrate each step (the research
// log has that); above its face float the questions you would most likely ask right now, and clicking one asks it. Not
// while the chat is open (it offers the same questions), and not while you choose where to start: nothing to ask yet.
export function AgentBubbles() {
  const { chatOpen, set, app, selectedId, thinking } = useStore()
  const starting = useStarting()
  const offers = chatOpen || starting || thinking ? [] : commonQuestions(app.session, selectedId)
  return (
    <div className="relative mt-auto flex shrink-0 justify-end">
      <ul aria-label="Common questions" className="absolute bottom-[calc(100%+8px)] right-1 z-10 m-0 flex w-max max-w-[320px] list-none flex-col items-end gap-1.5 p-0">
        <AnimatePresence initial={false}>
          {offers.map((q, i) => (
            <motion.li key={q} layout initial={{ opacity: 0, scale: 0.9, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0, transition: { type: 'spring', duration: 0.4, bounce: 0.18, delay: i * 0.05 } }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }} style={{ transformOrigin: 'right bottom' }}>
              <button className="marble-edge relative isolate overflow-hidden rounded-2xl rounded-br-md border border-rule bg-surface px-3 py-1.5 text-left text-[12.5px] leading-snug transition-colors hover:border-faint"
                onClick={(e) => askLitmus(e.currentTarget, q)}>
                <SceneBackdrop seed={BUBBLE_FACETS + i} className="card-facets" />
                {q}
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {starting ? <img src="/litmus-face.svg" alt="Litmus" width={44} height={44} className="rounded-full border border-rule bg-surface p-1 shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)]" /> : <button aria-pressed={chatOpen} aria-label={chatOpen ? 'Close the chat with Litmus' : 'Chat with Litmus'} title={chatOpen ? 'Close chat' : 'Chat with Litmus'}
        className="flex items-center gap-2 rounded-full border bg-surface py-1 pl-1 pr-3.5 shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)] transition-transform active:scale-95"
        style={{ borderColor: chatOpen ? 'var(--color-ink)' : 'var(--color-rule)' }} onClick={() => set({ chatOpen: !chatOpen })}>
        <img src="/litmus-face.svg" alt="" width={36} height={36} />
        <span className="text-[13px] font-semibold">{chatOpen ? 'Close chat' : 'Ask Litmus'}</span>
      </button>}
    </div>
  )
}
