import { useState } from 'react'
import { useStore } from '../store'

// "Where should we start?": the first thing Litmus says, a speech bubble out of its face listing your highlights, notes first.
export function StartBubble() {
  const { app, libraryStage, start } = useStore()
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const claims = app.claims.slice().sort((a, b) => a.rank - b.rank)
  const go = async () => { if (!chosen) return; setBusy(true); await start([chosen]); setBusy(false) }
  return (
    <section aria-label="Where should we start?" className="pointer-events-auto relative flex max-h-[calc(100vh-170px)] w-[min(380px,calc(100vw-110px))] flex-col rounded-2xl rounded-tr-md border border-rule bg-surface shadow-[0_16px_40px_-12px_rgba(43,58,82,0.35)]">
      <span aria-hidden className="absolute -right-[7px] top-4 h-3.5 w-3.5 rotate-45 border-r border-t border-rule bg-surface" />
      <h2 className="m-0 px-3.5 pb-1 pt-3 text-[14px] font-semibold">Where should we start?</h2>
      {libraryStage !== 'ready'
        ? <p className="m-0 px-3.5 pb-3 text-[12px] text-muted">Reading your highlights and notes…</p>
        : (
          <>
            <ul className="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto px-3 pb-2 pt-1">
              {claims.map((c) => {
                const on = chosen === c.id
                return (
                  <li key={c.id}>
                    <button aria-pressed={on} onClick={() => setChosen(on ? null : c.id)} className="block w-full rounded-lg border px-2.5 py-2 text-left transition-colors"
                      style={{ borderColor: on ? 'var(--color-ink)' : 'var(--color-rule)', background: on ? 'var(--color-marble)' : undefined }}>
                      <span className="block text-[12.5px] font-medium leading-snug">{c.summary ?? c.text}</span>
                      {c.annotation && <span className="mt-0.5 block line-clamp-2 text-[11.5px] leading-snug text-human">Your note: {c.annotation}</span>}
                      <span className="mt-0.5 block truncate text-[11px] text-faint">{c.doc_title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-rule px-3 py-2.5">
              <button className="btn btn-primary" disabled={!chosen || busy} onClick={go}>{chosen ? 'Start with this claim' : 'Pick one claim to start'}</button>
            </div>
          </>
        )}
    </section>
  )
}
