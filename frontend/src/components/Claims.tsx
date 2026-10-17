import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { agentName, provMatches, pts, shortCite, starTone, toneVar } from '../lib/format'
import { useStore } from '../store'
import { LIBRARY_STAGES, type LibraryStage } from '../transport/api'
import type { Claim, Document, Star } from '../types'
import { CheckIcon, ExternalIcon } from './Icons'
import { Facets } from './LowPolyScene'

type ClaimStatus = 'untested' | 'testing' | 'confirmed' | 'refuted' | 'inconclusive'
type Tab = 'basis' | 'findings'
const COLOR: Record<ClaimStatus, string> = { untested: 'var(--color-faint)', testing: toneVar('running'), confirmed: toneVar('confirmed'), refuted: toneVar('refuted'), inconclusive: toneVar('inconclusive') }
const STAGE_TEXT: Record<LibraryStage, string> = { papers: 'Getting papers', highlights: 'Getting highlights', notes: 'Getting notes', summaries: 'Summarizing highlights' }
const SKELETON_ROWS = 4
const SUMMARY_WORDS = 7
const FACET_SEED = 41
const open = { height: 'auto', opacity: 1 }, closed = { height: 0, opacity: 0 }
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }

function claimStatus(c: Claim, stars: Star[]): { status: ClaimStatus; stars: Star[] } {
  const mine = stars.filter((s) => s.chosen_by !== 'shadow' && s.provenance.some((p) => provMatches(p, c.id)))
  if (!mine.length) return { status: 'untested', stars: [] }
  if (mine.some((s) => s.status === 'running' || s.status === 'queued' || s.status === 'waiting')) return { status: 'testing', stars: mine }
  const v = mine.filter((s) => s.grade).map((s) => s.grade!.verdict)
  return { status: v.includes('confirmed') ? 'confirmed' : v.includes('refuted') ? 'refuted' : 'inconclusive', stars: mine }
}
// A claim the backend could not summarize falls back to its opening words.
const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'

function Loading({ stage }: { stage: LibraryStage }) {
  const at = LIBRARY_STAGES.indexOf(stage)
  return (
    <div className="px-4 pt-1" aria-live="polite">
      <ol className="m-0 list-none space-y-1.5 p-0">
        {LIBRARY_STAGES.slice(0, at + 1).map((s, i) => (
          <motion.li key={s} className="flex items-center gap-2 text-[12.5px]" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={reveal}
            style={{ color: i < at ? 'var(--color-faint)' : 'var(--color-ink)' }}>
            <span className="grid h-3 w-3 place-items-center">{i < at ? <CheckIcon /> : <span className="dot live-dot" style={{ background: 'var(--color-running)' }} />}</span>
            {STAGE_TEXT[s]}{i === at ? '…' : ''}
          </motion.li>
        ))}
      </ol>
      <div className="mt-5 space-y-4" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className="space-y-2" style={{ opacity: 1 - i * 0.2 }}>
            <div className="skeleton h-2 w-14" />
            <div className="skeleton h-3" style={{ width: `${82 - i * 9}%` }} />
            <div className="skeleton h-2 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Findings({ stars }: { stars: Star[] }) {
  const select = useStore((s) => s.select)
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {stars.map((s) => {
        const g = s.grade
        return (
          <li key={s.id}>
            <button className="-mx-1 flex w-[calc(100%+8px)] items-baseline gap-2 rounded-md px-1 py-1.5 text-left hover:bg-paper" onClick={() => select(s.id)}>
              <span className="dot translate-y-[-1px]" style={{ background: toneVar(starTone(s)) }} />
              <span className="min-w-0 flex-1 truncate font-medium">{agentName(s)}</span>
              {g ? <>
                <span className="text-[11.5px]" style={{ color: toneVar(starTone(s)) }}>{g.verdict}</span>
                <span className="num text-[11.5px] text-muted">{pts(g.delta)}</span>
              </> : <span className="text-[11.5px] text-muted">training…</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ClaimCard({ c, status, stars, doc, expanded, onToggle }: { c: Claim; status: ClaimStatus; stars: Star[]; doc?: Document; expanded: boolean; onToggle: () => void }) {
  const set = useStore((s) => s.set)
  const [tab, setTab] = useState<Tab | null>(null)
  const graded = stars.some((s) => s.grade)
  const shown = tab === 'findings' && !graded ? null : tab
  const source = doc?.url ?? doc?.papiers_url
  const tabs: Tab[] = graded ? ['basis', 'findings'] : ['basis']
  return (
    <li className="claim" data-expanded={expanded || undefined}>
      <button className="block w-full px-3 py-3 text-left" aria-expanded={expanded} onClick={onToggle}
        onMouseEnter={() => set({ hoveredClaim: c.id })} onMouseLeave={() => set({ hoveredClaim: null })}
        onFocus={() => set({ hoveredClaim: c.id })} onBlur={() => set({ hoveredClaim: null })}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: COLOR[status] }}>
          <span className={`dot ${status === 'testing' ? 'live-dot' : ''}`} style={{ background: COLOR[status] }} />{status}
        </span>
        <span className="mt-1 block text-[14px] font-medium leading-snug tracking-[-0.01em] text-ink">{summarize(c)}</span>
        <span className={`mt-1 text-[12px] leading-snug text-muted ${expanded ? 'block' : 'line-clamp-1'}`}>Paper: {c.doc_title}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="body" initial={closed} animate={open} exit={closed} transition={reveal} className="overflow-hidden">
            <div className="flex flex-col gap-4 px-3 pb-3.5 pt-0.5">
              {c.annotation && <p className="m-0 text-[12.5px] leading-snug text-human"><span className="font-medium">Your note:</span> {c.annotation}</p>}
              <div role="tablist" aria-label="About this claim" className="tabs">
                {tabs.map((t) => (
                  <button key={t} role="tab" aria-selected={shown === t} onClick={() => setTab(shown === t ? null : t)}>{t === 'basis' ? 'Basis' : 'Findings'}</button>
                ))}
              </div>
              {shown === 'basis' && (
                <div role="tabpanel" className="flex flex-col gap-2 text-[12.5px] leading-relaxed">
                  <blockquote className="m-0 border-l border-rule pl-3 text-ink">{c.text}</blockquote>
                  {c.conditions && <p className="m-0 text-muted"><span className="mb-0.5 block text-[11px] font-medium text-faint">Paper setting</span>{c.conditions}</p>}
                </div>
              )}
              {shown === 'findings' && <div role="tabpanel"><Findings stars={stars} /></div>}
              <p className="m-0 flex flex-wrap items-center gap-x-1.5 border-t border-rule pt-3 text-[11.5px] text-faint">
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

export function Claims() {
  const { app, libraryStage, select } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const stars = app.session?.stars ?? []
  const rows = app.claims.slice().sort((a, b) => a.rank - b.rank).map((c) => ({ c, ...claimStatus(c, stars) }))
  const tested = rows.filter((r) => r.status !== 'untested').length
  const ready = libraryStage === 'ready'
  return (
    <section aria-label="Claims from your Papiers library" className="rail relative flex min-h-0 flex-col overflow-hidden border-r border-rule max-lg:max-h-[50vh]">
      <Facets seed={FACET_SEED} />
      <div className="relative flex items-baseline justify-between px-4 pb-2 pt-4">
        <h2 className="m-0 text-[13px] font-semibold">Claims</h2>
        {ready && rows.length > 0 && <span className="num text-[11.5px] text-muted">{tested}/{rows.length} tested</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-3">
        {!ready ? <Loading stage={libraryStage} /> : (
          <ul className="m-0 list-none space-y-px p-0 px-2">
            {rows.map(({ c, status, stars: ss }) => (
              <ClaimCard key={c.id} c={c} status={status} stars={ss} doc={app.documents.find((d) => d.id === c.doc_id)} expanded={expanded === c.id}
                onToggle={() => { setExpanded(expanded === c.id ? null : c.id); if (ss[0]) select(ss[0].id) }} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
