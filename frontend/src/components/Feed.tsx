import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { ProvList } from './Prov'

const KIND: Record<string, { label: string; color: string }> = {
  thinking: { label: 'agent', color: 'var(--color-agent)' }, search: { label: 'library', color: 'var(--color-baseline)' },
  replan: { label: 'replanned', color: 'var(--color-human)' }, feedback: { label: 'you', color: 'var(--color-human)' },
  decision: { label: 'you', color: 'var(--color-human)' }, papiers: { label: 'papiers', color: 'var(--color-confirmed)' }, error: { label: 'error', color: 'var(--color-refuted)' },
}

export function Feed() {
  const { app, select } = useStore()
  const [open, setOpen] = useState(false)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }) }, [app.feed.length, open])
  return (
    <section aria-label="Activity" className="border-t border-rule">
      <button className="flex w-full items-center justify-between px-4 py-2 text-left font-serif text-[15px] font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        Activity <span className="num font-sans text-[12px] font-normal text-muted">{app.feed.length} · {open ? 'hide' : 'show'}</span>
      </button>
      {!open && app.feed.length > 0 && <p className="m-0 truncate px-4 pb-2 text-[12.5px] text-muted">{app.feed[app.feed.length - 1].text}</p>}
      {open && (
        <ul className="m-0 max-h-[230px] list-none space-y-2 overflow-y-auto px-4 pb-3" aria-live="polite">
          {!app.feed.length && <li className="text-muted">Nothing yet.</li>}
          {app.feed.map((f) => (
            <li key={f.seq} className="text-[12.5px] leading-snug">
              <button className="block w-full text-left" disabled={!f.star_id} onClick={() => f.star_id && select(f.star_id)}>
                <span className="tag mr-1.5" style={{ color: KIND[f.kind].color }}>{KIND[f.kind].label}</span>
                {f.kind === 'search' ? <>Searching your library: <em className="font-serif">{f.text}</em></> : f.text}
              </button>
              {f.hits && <div className="mt-1"><ProvList items={f.hits} /></div>}
            </li>
          ))}
          <li ref={end} aria-hidden />
        </ul>
      )}
    </section>
  )
}
