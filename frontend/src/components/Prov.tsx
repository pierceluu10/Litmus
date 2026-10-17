import { useState } from 'react'
import { provLabel } from '../lib/format'
import { useStore } from '../store'
import type { Provenance } from '../types'

// A provenance chip; click to read the source text it points to.
export function ProvChip({ p }: { p: Provenance }) {
  const docs = useStore((s) => s.app.documents)
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-block max-w-full align-top">
      <button className="chip hover:border-muted" aria-expanded={open} onClick={() => setOpen(!open)} title={p.doc_title}>
        <span className="truncate">{provLabel(p, docs)}</span>
      </button>
      {open && (
        <span className="mt-1 block rounded-md border border-rule bg-surface p-2 text-[12.5px] leading-snug text-ink">
          <span className="font-serif italic">“{p.text}”</span>
          {p.doc_title && <span className="mt-1 block text-muted">{p.doc_title}</span>}
          {p.papiers_url && <a className="mt-1 inline-block text-agent underline underline-offset-2" href={p.papiers_url} target="_blank" rel="noreferrer">Open in Papiers</a>}
        </span>
      )}
    </span>
  )
}

export function ProvList({ items }: { items: Provenance[] }) {
  return <div className="flex flex-wrap items-start gap-1.5">{items.map((p, i) => <ProvChip key={`${p.id}-${i}`} p={p} />)}</div>
}
