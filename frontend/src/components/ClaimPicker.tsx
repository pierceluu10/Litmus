import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { agentDetail, agentName, provMatches, pts, shortCite, starTone, toneVar } from '../lib/format'
import { useStore } from '../store'
import type { Claim, Document, Star } from '../types'
import { ExternalIcon } from './Icons'
import { SceneBackdrop } from './LowPolyScene'

const SUMMARY_WORDS = 7
const PICKER_FACETS = 53
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }
// A claim the backend could not summarize falls back to its opening words.
const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'

type ClaimStatus = 'untested' | 'testing' | 'confirmed' | 'refuted' | 'inconclusive'
type Tab = 'basis' | 'findings'
const TAB_TEXT: Record<Tab, string> = { basis: 'From the paper', findings: 'Findings' }
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

// One highlight: its status, its short title (the backend's summary) and paper; open it for your note, the passage,
// what the agents found, and the source.
export function ClaimCard({ c, status, stars, doc, expanded, onToggle, onTest, busy, canTest, action = 'Test', showStatus = true }: { c: Claim; status: ClaimStatus; stars: Star[]; doc?: Document; expanded: boolean; onToggle: () => void; onTest: () => void; busy: boolean; canTest: boolean; action?: string; showStatus?: boolean }) {
  const { set } = useStore()
  const [tab, setTab] = useState<Tab | null>(stars.length ? 'findings' : 'basis')
  const tabs: Tab[] = stars.length ? ['findings', 'basis'] : ['basis']
  const source = doc?.url ?? doc?.papiers_url
  return (
    <li className="rounded-lg transition-colors" style={{ background: expanded ? 'color-mix(in srgb, var(--color-paper) 60%, transparent)' : undefined }}>
      <div className="flex items-start gap-2">
      <button className="block min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-paper" aria-expanded={expanded} onClick={onToggle}
        onMouseEnter={() => set({ hoveredClaim: c.id })} onMouseLeave={() => set({ hoveredClaim: null })}
        onFocus={() => set({ hoveredClaim: c.id })} onBlur={() => set({ hoveredClaim: null })}>
        {showStatus && (
          <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: COLOR[status] }}>
            <span className={`dot ${status === 'testing' ? 'live-dot' : ''}`} style={{ background: COLOR[status] }} />{status}
            {stars.length > 1 && <span className="font-normal text-faint">· {stars.length} agents</span>}
          </span>
        )}
        <span className="block text-[13px] font-medium leading-snug tracking-[-0.01em] text-ink">{summarize(c)}</span>
        <span className={`mt-0.5 text-[11.5px] leading-snug text-muted ${expanded ? 'block' : 'line-clamp-1'}`}>Paper: {c.doc_title}</span>
      </button>
      {/* only an untested claim can start a new agent; the rest keep a greyed-out button so the list stays aligned */}
      <button className={`btn ${expanded ? 'btn-primary' : ''} mr-1.5 mt-2 h-7 shrink-0 px-2.5 text-[12px]`} disabled={!canTest || busy} title={canTest ? 'Start an agent on this claim' : 'Already tested'} onClick={onTest}>{busy ? 'Starting…' : action}</button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="body" initial={closed} animate={open} exit={closed} transition={reveal} className="overflow-hidden">
            <div className="flex flex-col gap-2.5 px-2 pb-2.5 pt-0.5 text-[12px]">
              {c.annotation && (
                <section>
                  <h3 className="card-subtitle">Your note</h3>
                  <p className="m-0 leading-snug text-human">{c.annotation}</p>
                </section>
              )}
              {/* one tab alone is not a choice: the passage shows under its subtitle */}
              <div>
                {tabs.length > 1
                  ? (
                    <div role="tablist" aria-label="About this claim" className="tabs mb-2">
                      {tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(tab === x ? null : x)}>{TAB_TEXT[x]}</button>)}
                    </div>
                  )
                  : <h3 className="card-subtitle">{TAB_TEXT.basis}</h3>}
                {tab === 'basis' && <blockquote role="tabpanel" className="m-0 border-l border-rule pl-2.5 leading-relaxed text-ink">{c.text}</blockquote>}
                {tab === 'findings' && stars.length > 0 && <div role="tabpanel"><Findings stars={stars} /></div>}
              </div>
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

// "Test another claim": every highlight with its status, untested ones first. Open one for its card; Test starts an
// agent on an untested claim (tested ones keep the button, greyed out).
export function ClaimPicker() {
  const { app, pivot, select } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const session = app.session
  const stars = session?.stars ?? []
  const rows = app.claims.map((c) => ({ c, ...claimStatus(c, stars) }))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.c.rank - b.c.rank)
  const untested = rows.filter((r) => r.status === 'untested').length
  const live = session?.status !== 'done'
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('keydown', esc)
    return () => { removeEventListener('keydown', esc); useStore.getState().set({ hoveredClaim: null }) }
  }, [open])
  if (!session?.start_claim_ids?.length) return null
  const go = async (id: string) => { setBusy(id); await pivot(id); setBusy(null); setOpen(false) }
  return (
    <div className="relative">
      <button className="btn h-7 px-2.5 text-[12px]" aria-expanded={open} onClick={() => { setOpen(!open); useStore.getState().set({ cardFor: null }) }} style={open ? { borderColor: 'var(--color-ink)' } : undefined}>
        Test another claim <span className="ml-1 text-faint">{untested}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-0 top-9 z-40 isolate flex max-h-[min(66vh,560px)] w-[360px] flex-col overflow-hidden rounded-xl marble-edge border border-rule bg-surface">
            <SceneBackdrop seed={PICKER_FACETS} className="card-facets" />
            <div className="flex items-baseline justify-between px-3.5 pb-1 pt-3"><h2 className="m-0 text-[12px] font-semibold text-muted">Your claims</h2><span className="num text-[11px] text-faint">{rows.length - untested}/{rows.length} tested</span></div>
            <ul className="m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-1.5 pt-0">
              {rows.map(({ c, status, stars: mine }) => (
                <ClaimCard key={c.id} c={c} status={status} stars={mine} doc={app.documents.find((d) => d.id === c.doc_id)} expanded={expanded === c.id}
                  canTest={live && status === 'untested'} busy={busy === c.id} onTest={() => go(c.id)}
                  onToggle={() => { setExpanded(expanded === c.id ? null : c.id); if (mine[0] && expanded !== c.id) select(mine[0].id) }} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
