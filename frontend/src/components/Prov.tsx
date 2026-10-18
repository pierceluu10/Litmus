import { useState } from 'react'
import { provLabel } from '../lib/format'
import { useStore } from '../store'
import { ExternalIcon } from './Icons'
import type { Provenance } from '../types'

// A provenance chip; click to read the source text it points to.
export function ProvChip({ p, label }: { p: Provenance; label?: string }) {
  const docs = useStore((s) => s.app.documents)
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-block max-w-full align-top">
      <button type="button" className="chip hover:border-faint" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open) }} title={p.doc_title}>
        <span className="truncate">{label ?? provLabel(p, docs)}</span>
      </button>
      {open && (
        <span className="mt-1 block max-w-[46ch] rounded-md border border-rule bg-surface p-2 text-[12px] leading-snug text-ink">
          “{p.text}”
          {p.papiers_url && <a className="mt-1.5 inline-flex items-center gap-1 text-muted underline decoration-rule underline-offset-[3px] hover:text-ink hover:decoration-ink" href={p.papiers_url} target="_blank" rel="noreferrer">Source<ExternalIcon /></a>}
        </span>
      )}
    </span>
  )
}

export function ProvList({ items }: { items: Provenance[] }) {
  return <div className="flex flex-wrap items-start gap-1.5">{items.map((p, i) => <ProvChip key={`${p.id}-${i}`} p={p} />)}</div>
}
