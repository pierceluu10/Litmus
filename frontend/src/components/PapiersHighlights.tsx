import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { sessionApi, useStore } from '../store'
import { toneVar, VERDICT_TEXT } from '../lib/format'
import type { HighlightResult, VerdictHighlight } from '../types'
import { SceneBackdrop } from './LowPolyScene'
import { Whimsy } from './Whimsy'

const PANEL_FACETS = 53

// Litmus's verdicts back onto the claims in Papiers: each tested highlight gets a new highlight over the same passage, tinted
// by its latest verdict, with a note listing every result. Nothing is written until the person picks which and approves.
export function PapiersHighlights() {
  const sid = useStore((s) => s.sid)
  const graded = useStore((s) => s.app.session?.stars.some((x) => x.grade && x.grade.verdict !== 'baseline'))
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<VerdictHighlight[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Map<string, HighlightResult>>(new Map())
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !sid) return
    let live = true
    setItems(null); setResults(new Map()); setError(null)
    sessionApi().verdictHighlights(sid, { write: false })
      .then((r) => { if (live) { setItems(r.highlights); setChosen(new Set(r.highlights.map((h) => h.claim_id))) } })
      .catch((e) => live && setError((e as Error).message))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('keydown', esc)
    return () => { live = false; removeEventListener('keydown', esc) }
  }, [open, sid])

  const toggle = (id: string) => setChosen((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const write = async () => {
    if (!sid) return
    setWriting(true); setError(null)
    try {
      const r = await sessionApi().verdictHighlights(sid, { claim_ids: [...chosen], write: true })
      setResults(new Map((r.results ?? []).map((x) => [x.claim_id, x])))
      setChosen(new Set((r.results ?? []).filter((x) => !x.ok).map((x) => x.claim_id))) // leave only the failed ones to retry
    } catch (e) { setError((e as Error).message) }
    setWriting(false)
  }
  const done = [...results.values()].filter((r) => r.ok).length

  return (
    <div className="relative">
      <button className="btn" disabled={!graded} aria-expanded={open} onClick={() => setOpen(!open)} style={open ? { borderColor: 'var(--color-ink)' } : undefined}>
        Highlight in Papiers
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            role="dialog" aria-label="Highlight the verdicts in Papiers"
            className="absolute right-0 top-10 z-40 isolate flex max-h-[min(70vh,600px)] w-[380px] flex-col overflow-hidden rounded-xl marble-edge border border-rule bg-surface">
            <SceneBackdrop seed={PANEL_FACETS} className="card-facets" />
            <div className="px-3.5 pb-2 pt-3">
              <h2 className="m-0 text-[13px] font-semibold">Put the verdicts on your highlights</h2>
              <p className="m-0 mt-1 text-[12px] leading-snug text-muted">
                Each claim an agent tested gets a highlight in Papiers over the same passage, tinted by its latest verdict, with a note of every result. Pick which to write.
                {sessionApi().mock && ' Demo results are simulated, so each note says so.'}
              </p>
            </div>
            <ul className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto px-1.5 pb-1.5">
              {!items && !error && <li className="px-2 py-2 text-[12px] text-muted"><Whimsy lead="Reading the verdicts" /></li>}
              {items?.length === 0 && <li className="px-2 py-2 text-[12px] text-muted">No highlight has a graded result yet.</li>}
              {items?.map((h) => {
                const result = results.get(h.claim_id)
                return (
                  <li key={h.claim_id}>
                    <label className="plate flex cursor-pointer items-start gap-2.5 p-2.5">
                      <input type="checkbox" className="mt-0.5" checked={chosen.has(h.claim_id)} disabled={writing || result?.ok} onChange={() => toggle(h.claim_id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium leading-snug">{h.summary}</span>
                          <span className="shrink-0 text-[11px] font-medium" style={{ color: toneVar(h.verdict) }}>{VERDICT_TEXT[h.verdict]}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-faint">{h.doc_title}{h.page ? ` · p. ${h.page}` : ''}</span>
                        <span className="mt-1.5 block whitespace-pre-line rounded-md border-l-[3px] py-1 pl-2 text-[11.5px] leading-snug text-muted" style={{ borderColor: h.color, background: `color-mix(in srgb, ${h.color} 22%, transparent)` }}>{h.note}</span>
                        {result && (result.ok
                          ? <span className="mt-1 block text-[11.5px] font-medium" style={{ color: toneVar('confirmed') }}>Highlighted in Papiers</span>
                          : <span role="alert" className="mt-1 block text-[11px] leading-snug text-refuted">{result.error}</span>)}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {error && <p role="alert" className="m-0 px-3.5 pb-2 text-[11.5px] leading-snug text-refuted">{error}</p>}
            <div className="flex items-center justify-between gap-3 border-t border-rule px-3.5 py-2.5">
              <span className="text-[11px] leading-tight text-muted">{done ? `${done} written` : 'Needs "Allow highlights"'}</span>
              <div className="flex shrink-0 gap-1.5">
                <button className="btn btn-quiet" onClick={() => setOpen(false)}>Close</button>
                <button className="btn btn-primary" disabled={!chosen.size || writing} onClick={write}>
                  {writing ? 'Highlighting…' : `Highlight ${chosen.size} in Papiers`}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
