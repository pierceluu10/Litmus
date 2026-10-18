import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { agentDetail, agentName, progressFraction, provMatches, starTone, summarize, toneVar } from '../lib/format'
import { useStore } from '../store'
import { type LibraryStage } from '../transport/api'
import type { Star } from '../types'

export const STAGE_TEXT: Record<LibraryStage, string> = { papers: 'Fetching papers', highlights: 'Fetching highlights', notes: 'Gathering notes', summaries: 'Summarizing each highlight' }
const MAX_ROWS = 4
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }

// Which claim each running agent is testing right now (and the library loading stages before that).
export function Researching({ inline = false }: { inline?: boolean }) {
  const { app, libraryStage, select, set } = useStore()
  // hovering a claim dims the other nodes; if this card goes away mid-hover, the dimming must not stay
  useEffect(() => () => useStore.getState().set({ hoveredClaim: null }), [])
  const session = app.session
  const stars = session?.stars ?? []
  const claimOf = (s: Star) => app.claims.find((c) => s.provenance.some((p) => provMatches(p, c.id)))
  const active = stars.filter((s) => s.parent_id && (s.status === 'running' || s.status === 'queued' || s.status === 'waiting'))
  const loading = libraryStage !== 'ready'
  if (!loading && !active.length) return null
  return (
    <section aria-label="Researching now" className={inline ? 'flex flex-col gap-3' : 'absolute left-4 top-16 z-30 flex w-[min(300px,calc(100%-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-rule bg-surface/95 p-3 shadow-[0_10px_30px_-8px_rgba(43,58,82,0.22)] max-h-[calc(100%-6rem)] lg:max-h-[calc(100%-5rem)]'}>
      {loading && (
        <div>
          <h2 className="m-0 text-[12px] font-semibold text-muted">Reading your library</h2>
          <p className="m-0 mt-2 flex items-center gap-2 text-[12.5px]" aria-live="polite"><span className="dot live-dot" style={{ background: toneVar('running') }} />{STAGE_TEXT[libraryStage as LibraryStage]}…</p>
        </div>
      )}
      {active.length > 0 && (
        <div>
          <h2 className="m-0 text-[12px] font-semibold text-muted">{active.length === 1 ? 'Researching now' : `Researching now · ${active.length} agents`}</h2>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            <AnimatePresence initial={false}>
              {active.slice(0, MAX_ROWS).map((s) => {
                const claim = claimOf(s), waiting = s.status === 'waiting', tone = toneVar(starTone(s))
                return (
                  <motion.li key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={reveal}>
                    <button className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper" onClick={() => select(s.id)}
                      onMouseEnter={() => claim && set({ hoveredClaim: claim.id })} onMouseLeave={() => set({ hoveredClaim: null })}>
                      <span className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: tone }}>
                        <span className={`dot ${waiting ? '' : 'live-dot'}`} style={{ background: tone }} />
                        {agentName(s)}<span className="font-normal text-faint">{agentDetail(s) && ` · ${agentDetail(s)}`}</span>
                        {waiting && <span className="ml-auto text-waiting">needs you</span>}
                      </span>
                      <span className="mt-0.5 block text-[13.5px] font-medium leading-snug tracking-[-0.01em]">{claim ? summarize(claim) : s.title}</span>
                      {!waiting && <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-rule"><span className="block h-full origin-left rounded-full transition-transform duration-500" style={{ background: tone, transform: `scaleX(${Math.max(0.05, progressFraction(s))})` }} /></span>}
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
            {active.length > MAX_ROWS && <li className="px-2 text-[11.5px] text-faint">+{active.length - MAX_ROWS} more</li>}
          </ul>
        </div>
      )}
    </section>
  )
}
