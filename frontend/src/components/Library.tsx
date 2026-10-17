import { useMemo } from 'react'
import { provMatches, toneVar } from '../lib/format'
import { useStore } from '../store'
import type { Claim, Star } from '../types'

type ClaimStatus = 'untested' | 'testing' | 'confirmed' | 'refuted' | 'inconclusive'
function claimStatus(c: Claim, stars: Star[]): { status: ClaimStatus; stars: Star[] } {
  const mine = stars.filter((s) => s.chosen_by !== 'shadow' && s.provenance.some((p) => provMatches(p, c.id)))
  if (!mine.length) return { status: 'untested', stars: [] }
  if (mine.some((s) => s.status === 'running' || s.status === 'queued' || s.status === 'waiting')) return { status: 'testing', stars: mine }
  const v = mine.filter((s) => s.grade).map((s) => s.grade!.verdict)
  const status = v.includes('refuted') ? 'refuted' : v.includes('confirmed') ? 'confirmed' : 'inconclusive'
  return { status, stars: mine }
}
const COLOR: Record<ClaimStatus, string> = { untested: 'var(--color-muted)', testing: toneVar('running'), confirmed: toneVar('confirmed'), refuted: toneVar('refuted'), inconclusive: toneVar('inconclusive') }

export function Library() {
  const { app, set, select } = useStore()
  const stars = app.session?.stars ?? []
  const rows = useMemo(() => app.claims.slice().sort((a, b) => a.rank - b.rank).map((c) => ({ c, ...claimStatus(c, stars) })), [app.claims, stars])
  return (
    <section aria-label="Your Papiers library" className="flex min-h-0 flex-1 flex-col">
      <h2 className="m-0 px-4 pb-1 pt-3 font-serif text-[16px] font-semibold">Your reading</h2>
      <p className="m-0 px-4 pb-2 text-[12.5px] text-muted">Your highlights, ranked by engagement. Hover one to light up its stars.</p>
      <ul className="m-0 min-h-0 flex-1 list-none space-y-2 overflow-y-auto px-3 pb-3">
        {!rows.length && <li className="px-1 text-muted">Loading your library…</li>}
        {rows.map(({ c, status, stars: ss }) => (
          <li key={c.id}>
            <button className="block w-full rounded-md border border-rule bg-surface p-2.5 text-left transition-colors hover:border-muted"
              onMouseEnter={() => set({ hoveredClaim: c.id })} onMouseLeave={() => set({ hoveredClaim: null })}
              onFocus={() => set({ hoveredClaim: c.id })} onBlur={() => set({ hoveredClaim: null })}
              onClick={() => ss[0] && select(ss[0].id)}>
              <span className="flex items-center justify-between gap-2">
                <span className="tag" style={{ color: COLOR[status] }}>{status}</span>
                <span className="num text-[11.5px] text-muted">#{c.rank}{c.page ? ` · p.${c.page}` : ''}</span>
              </span>
              <span className="mt-1 block font-serif text-[13.5px] leading-snug">{c.text}</span>
              {c.annotation && <span className="mt-1.5 block rounded border border-human/40 bg-human/5 px-2 py-1 text-[12.5px] italic text-human">Your note: {c.annotation}</span>}
              <span className="mt-1.5 block truncate text-[11.5px] text-muted">{c.doc_title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
