import { useState } from 'react'
import { provMatches, shortCite, toneVar } from '../lib/format'
import { useStore } from '../store'
import type { Claim, Star } from '../types'

type ClaimStatus = 'untested' | 'testing' | 'confirmed' | 'refuted' | 'inconclusive'
const COLOR: Record<ClaimStatus, string> = { untested: 'var(--color-faint)', testing: toneVar('running'), confirmed: toneVar('confirmed'), refuted: toneVar('refuted'), inconclusive: toneVar('inconclusive') }
const SUMMARY_WORDS = 7

function claimStatus(c: Claim, stars: Star[]): { status: ClaimStatus; stars: Star[] } {
  const mine = stars.filter((s) => s.chosen_by !== 'shadow' && s.provenance.some((p) => provMatches(p, c.id)))
  if (!mine.length) return { status: 'untested', stars: [] }
  if (mine.some((s) => s.status === 'running' || s.status === 'queued' || s.status === 'waiting')) return { status: 'testing', stars: mine }
  const v = mine.filter((s) => s.grade).map((s) => s.grade!.verdict)
  return { status: v.includes('confirmed') ? 'confirmed' : v.includes('refuted') ? 'refuted' : 'inconclusive', stars: mine }
}
// Live sessions have no hand-written summary yet: fall back to the claim's opening words.
const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'

export function Claims() {
  const { app, set, select } = useStore()
  const [open, setOpen] = useState<string | null>(null)
  const stars = app.session?.stars ?? []
  const rows = app.claims.slice().sort((a, b) => a.rank - b.rank).map((c) => ({ c, ...claimStatus(c, stars) }))
  const tested = rows.filter((r) => r.status !== 'untested').length
  return (
    <section aria-label="Claims from your Papiers library" className="flex min-h-0 flex-col border-r border-rule bg-surface max-lg:max-h-[50vh]">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
        <h2 className="m-0 text-[13px] font-semibold">Claims</h2>
        {rows.length > 0 && <span className="num text-[11.5px] text-faint">{tested}/{rows.length} tested</span>}
      </div>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 pb-3">
        {!rows.length && <li className="px-4 text-muted">Reading your library…</li>}
        {rows.map(({ c, status, stars: ss }) => {
          const expanded = open === c.id
          const doc = app.documents.find((d) => d.id === c.doc_id)
          return (
            <li key={c.id} className="border-t border-rule first:border-t-0">
              <button className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-paper/60" aria-expanded={expanded}
                onMouseEnter={() => set({ hoveredClaim: c.id })} onMouseLeave={() => set({ hoveredClaim: null })}
                onFocus={() => set({ hoveredClaim: c.id })} onBlur={() => set({ hoveredClaim: null })}
                onClick={() => { setOpen(expanded ? null : c.id); if (ss[0]) select(ss[0].id) }}>
                <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: COLOR[status] }}>
                  <span className={`dot ${status === 'testing' ? 'live-dot' : ''}`} style={{ background: COLOR[status] }} />{status}
                </span>
                <span className="mt-0.5 block text-[13.5px] font-medium leading-snug text-ink">{summarize(c)}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">{shortCite(doc)}{c.page ? ` · p.${c.page}` : ''}{ss.length > 1 ? ` · ${ss.length} experiments` : ''}</span>
                {expanded && (
                  <span className="mt-2 block space-y-1.5 text-[12.5px] leading-snug">
                    {c.annotation && <span className="block text-human">Your note: {c.annotation}</span>}
                    <span className="block text-muted">{c.text}</span>
                    {c.conditions && <span className="block text-faint">Paper setting: {c.conditions}</span>}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
