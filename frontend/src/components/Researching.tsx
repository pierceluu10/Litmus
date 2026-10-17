import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { agentDetail, agentName, progressFraction, provMatches, pts, shortCite, starTone, toneVar } from '../lib/format'
import { ExternalIcon } from './Icons'
import { useStore } from '../store'
import { type LibraryStage } from '../transport/api'
import type { Claim, Document, Star } from '../types'

const STAGE_TEXT: Record<LibraryStage, string> = { papers: 'Getting papers', highlights: 'Getting highlights', notes: 'Getting notes', summaries: 'Summarizing highlights' }
const SUMMARY_WORDS = 7
const MAX_ROWS = 4
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }
// A claim the backend could not summarize falls back to its opening words.
const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'

type ClaimStatus = 'untested' | 'testing' | 'confirmed' | 'refuted' | 'inconclusive'
type Tab = 'basis' | 'findings'
const COLOR: Record<ClaimStatus, string> = { untested: 'var(--color-faint)', testing: toneVar('running'), confirmed: toneVar('confirmed'), refuted: toneVar('refuted'), inconclusive: toneVar('inconclusive') }
const ORDER: ClaimStatus[] = ['testing', 'confirmed', 'refuted', 'inconclusive', 'untested']
const open = { height: 'auto', opacity: 1 }, closed = { height: 0, opacity: 0 }

function claimStatus(c: Claim, stars: Star[]): { status: ClaimStatus; stars: Star[] } {
  const mine = stars.filter((s) => s.parent_id && s.provenance.some((p) => provMatches(p, c.id)))
  if (!mine.length) return { status: 'untested', stars: [] }
  if (mine.some((s) => s.status === 'running' || s.status === 'queued' || s.status === 'waiting')) return { status: 'testing', stars: mine }
  const v = mine.filter((s) => s.grade).map((s) => s.grade!.verdict)
  return { status: v.includes('confirmed') ? 'confirmed' : v.includes('refuted') ? 'refuted' : 'inconclusive', stars: mine }
}

function Findings({ stars }: { stars: Star[] }) {
  const select = useStore((s) => s.select)
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {stars.map((s) => (
        <li key={s.id}>
          <button className="-mx-1 flex w-[calc(100%+8px)] items-baseline gap-2 rounded-md px-1 py-1 text-left hover:bg-paper" onClick={() => select(s.id)}>
            <span className="dot translate-y-[-1px]" style={{ background: toneVar(starTone(s)) }} />
            <span className="min-w-0 flex-1 truncate font-medium">{agentName(s)}<span className="font-normal text-faint">{agentDetail(s) && ` · ${agentDetail(s)}`}</span></span>
            {s.grade ? <span className="num text-[11.5px]" style={{ color: toneVar(starTone(s)) }}>{s.grade.verdict} {pts(s.grade.delta)}</span> : <span className="text-[11.5px] text-muted">training…</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

// One highlight: its status, its short title and paper; open it for your note, the passage, what the agents found,
// and (if nothing has tested it yet) a way to pivot to it.
function ClaimCard({ c, status, stars, doc, expanded, onToggle, canPivot }: { c: Claim; status: ClaimStatus; stars: Star[]; doc?: Document; expanded: boolean; onToggle: () => void; canPivot: boolean }) {
  const { set, pivot } = useStore()
  const [tab, setTab] = useState<Tab | null>(stars.length ? 'findings' : null)
  const [busy, setBusy] = useState(false)
  const tabs: Tab[] = stars.length ? ['findings', 'basis'] : ['basis']
  const source = doc?.url ?? doc?.papiers_url
  const go = async () => { setBusy(true); await pivot(c.id); setBusy(false) }
  return (
    <li className="rounded-lg transition-colors" style={{ background: expanded ? 'var(--color-paper)' : undefined }}>
      <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-paper" aria-expanded={expanded} onClick={onToggle}
        onMouseEnter={() => set({ hoveredClaim: c.id })} onMouseLeave={() => set({ hoveredClaim: null })}
        onFocus={() => set({ hoveredClaim: c.id })} onBlur={() => set({ hoveredClaim: null })}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: COLOR[status] }}>
          <span className={`dot ${status === 'testing' ? 'live-dot' : ''}`} style={{ background: COLOR[status] }} />{status}
          {stars.length > 1 && <span className="font-normal text-faint">· {stars.length} agents</span>}
        </span>
        <span className="mt-0.5 block text-[13px] font-medium leading-snug tracking-[-0.01em] text-ink">{summarize(c)}</span>
        <span className={`mt-0.5 text-[11.5px] leading-snug text-muted ${expanded ? 'block' : 'line-clamp-1'}`}>Paper: {c.doc_title}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="body" initial={closed} animate={open} exit={closed} transition={reveal} className="overflow-hidden">
            <div className="flex flex-col gap-2.5 px-2 pb-2.5 pt-0.5 text-[12px]">
              {c.annotation && <p className="m-0 leading-snug text-human"><span className="font-medium">Your note:</span> {c.annotation}</p>}
              <div role="tablist" aria-label="About this claim" className="tabs">
                {tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(tab === x ? null : x)}>{x === 'basis' ? 'Basis' : 'Findings'}</button>)}
              </div>
              {tab === 'basis' && (
                <div role="tabpanel" className="flex flex-col gap-1.5 leading-relaxed">
                  <blockquote className="m-0 border-l border-rule pl-2.5 text-ink">{c.text}</blockquote>
                  {c.conditions && <p className="m-0 text-muted"><span className="block text-[11px] font-medium text-faint">Paper setting</span>{c.conditions}</p>}
                </div>
              )}
              {tab === 'findings' && stars.length > 0 && <div role="tabpanel"><Findings stars={stars} /></div>}
              {canPivot && <button className="btn h-7 self-start px-2.5 text-[12px]" disabled={busy} onClick={go}>{busy ? 'Starting…' : 'Pivot to this claim'}</button>}
              <p className="m-0 flex flex-wrap items-center gap-x-1.5 border-t border-rule pt-2 text-[11px] text-faint">
                <span>{shortCite(doc)}</span>
                {c.page && <><span aria-hidden="true">·</span><span>p.{c.page}</span></>}
                {source && <><span aria-hidden="true">·</span><a className="inline-flex items-center gap-1 text-muted underline decoration-rule underline-offset-[3px] hover:text-ink hover:decoration-ink" href={source} target="_blank" rel="noreferrer">Source<ExternalIcon /></a></>}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

// A card over the scene, on the left: which claim each running agent is testing, then every highlight with its
// status; open one for the old claim card, what the agents found, and a pivot if nothing has tested it yet.
export function Researching() {
  const { app, libraryStage, select, set } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const session = app.session
  const stars = session?.stars ?? []
  const claimOf = (s: Star) => app.claims.find((c) => s.provenance.some((p) => provMatches(p, c.id)))
  const active = stars.filter((s) => s.parent_id && (s.status === 'running' || s.status === 'queued' || s.status === 'waiting'))
  const started = !!session?.start_claim_ids?.length
  const rows = app.claims.map((c) => ({ c, ...claimStatus(c, stars) }))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.c.rank - b.c.rank)
  const tested = rows.filter((r) => r.status !== 'untested').length
  const canPivot = started && session?.status !== 'done'
  const loading = libraryStage !== 'ready'
  if (!loading && !active.length && !started) return null
  return (
    <section aria-label="Claims" className="absolute left-4 top-16 z-30 flex w-[min(300px,calc(100%-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-rule bg-surface/95 p-3 shadow-[0_10px_30px_-8px_rgba(43,58,82,0.22)] max-h-[calc(100%-6rem)] lg:max-h-[calc(100%-5rem)]">
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
      {started && !loading && (
        <div>
          <div className="flex items-baseline justify-between"><h2 className="m-0 text-[12px] font-semibold text-muted">Claims</h2><span className="num text-[11px] text-faint">{tested}/{rows.length} tested</span></div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0">
            {rows.map(({ c, status, stars: mine }) => (
              <ClaimCard key={c.id} c={c} status={status} stars={mine} doc={app.documents.find((d) => d.id === c.doc_id)} expanded={expanded === c.id}
                canPivot={canPivot && status === 'untested'} onToggle={() => { setExpanded(expanded === c.id ? null : c.id); if (mine[0] && expanded !== c.id) select(mine[0].id) }} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
