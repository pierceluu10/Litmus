import { AnimatePresence, motion } from 'motion/react'
import { agentDetail, agentName, progressFraction, provMatches, shortCite, starTone, toneVar } from '../lib/format'
import { useStore } from '../store'
import { type LibraryStage } from '../transport/api'
import type { Claim } from '../types'

const STAGE_TEXT: Record<LibraryStage, string> = { papers: 'Getting papers', highlights: 'Getting highlights', notes: 'Getting notes', summaries: 'Summarizing highlights' }
const SUMMARY_WORDS = 7
const MAX_ROWS = 4
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }
// A claim the backend could not summarize falls back to its opening words.
const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'

// A small card over the scene: which claim each running agent is testing right now. It replaces the old claims list.
export function Researching() {
  const { app, libraryStage, select, set } = useStore()
  const stars = app.session?.stars ?? []
  const active = stars.filter((s) => s.parent_id && (s.status === 'running' || s.status === 'queued' || s.status === 'waiting'))
  const rows = active.slice(0, MAX_ROWS).map((s) => ({ s, claim: app.claims.find((c) => s.provenance.some((p) => provMatches(p, c.id))) }))
  const loading = libraryStage !== 'ready'
  if (!loading && !rows.length) return null
  return (
    <section data-tour="researching" aria-label="Claims being researched now" className="absolute left-4 top-16 z-30 w-[min(300px,calc(100%-2rem))] rounded-xl border border-rule bg-surface/95 p-3 shadow-[0_10px_30px_-8px_rgba(43,58,82,0.22)]">
      <h2 className="m-0 text-[12px] font-semibold text-muted">{loading ? 'Reading your library' : active.length === 1 ? 'Researching now' : `Researching now · ${active.length} agents`}</h2>
      {loading ? (
        <p className="m-0 mt-2 flex items-center gap-2 text-[12.5px]" aria-live="polite"><span className="dot live-dot" style={{ background: toneVar('running') }} />{STAGE_TEXT[libraryStage as LibraryStage]}…</p>
      ) : (
        <ul className="m-0 mt-2 list-none space-y-2 p-0">
          <AnimatePresence initial={false}>
            {rows.map(({ s, claim }) => {
              const waiting = s.status === 'waiting', tone = toneVar(starTone(s))
              return (
                <motion.li key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={reveal}>
                  <button className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper" onClick={() => select(s.id)}
                    onMouseEnter={() => claim && set({ hoveredClaim: claim.id })} onMouseLeave={() => set({ hoveredClaim: null })}
                    onFocus={() => claim && set({ hoveredClaim: claim.id })} onBlur={() => set({ hoveredClaim: null })}>
                    <span className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: tone }}>
                      <span className={`dot ${waiting ? '' : 'live-dot'}`} style={{ background: tone }} />
                      {agentName(s)}<span className="font-normal text-faint">{agentDetail(s) && ` · ${agentDetail(s)}`}</span>
                      {waiting && <span className="ml-auto text-waiting">needs you</span>}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] font-medium leading-snug tracking-[-0.01em]">{claim ? summarize(claim) : s.title}</span>
                    {claim && <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{shortCite(app.documents.find((d) => d.id === claim.doc_id))}{claim.page ? ` · p.${claim.page}` : ''}</span>}
                    {!waiting && <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-rule"><span className="block h-full origin-left rounded-full transition-transform duration-500" style={{ background: tone, transform: `scaleX(${Math.max(0.05, progressFraction(s))})` }} /></span>}
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
          {active.length > MAX_ROWS && <li className="px-2 text-[11.5px] text-faint">+{active.length - MAX_ROWS} more</li>}
        </ul>
      )}
    </section>
  )
}
