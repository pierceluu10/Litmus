import { Fragment } from 'react'
import { useStore, api } from '../store'
import { ProvChip } from './Prov'

export function AbstractPanel() {
  const { app, sid, select, set, addToPapiers } = useStore()
  const a = app.session?.abstract
  if (!a) return null
  const cite = (tok: string) => {
    const id = tok.slice(1, -1)
    if (/^S\d+$/.test(id)) return <button key={tok + Math.random()} className="chip mx-0.5 hover:border-muted" onClick={() => { select(id); set({ abstractOpen: false }) }}>{id}</button>
    const p = a.citations.find((c) => c.id === id || c.id.startsWith(id)) ?? app.claims.find((c) => c.id === id)?.provenance[0]
    return p ? <ProvChip key={tok + Math.random()} p={p} /> : <span key={tok}>{tok}</span>
  }
  const render = (text: string) => text.split(/(\[(?:S\d+|hl_[\w-]+)\])/g).map((part, i) => /^\[(S\d+|hl_[\w-]+)\]$/.test(part) ? <Fragment key={i}>{cite(part)}</Fragment> : <Fragment key={i}>{part}</Fragment>)
  const download = async () => {
    const md = sid ? await api.exportMarkdown(sid) : ''
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const el = document.createElement('a'); el.href = url; el.download = 'litmus-findings.md'; el.click(); URL.revokeObjectURL(url)
  }
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-label="Abstract" onClick={() => set({ abstractOpen: false })}>
      <article className="max-h-[88vh] w-full max-w-[760px] overflow-y-auto rounded-lg border border-rule bg-surface p-7 shadow-[0_16px_48px_rgba(42,38,32,0.25)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="m-0 font-serif text-[24px] font-semibold">What the agents found</h2>
        <p className="mt-3 max-w-[68ch] font-serif text-[16px] leading-relaxed">{render(a.text)}</p>
        <h3 className="mb-1 mt-5 font-serif text-[16px] font-semibold">Findings</h3>
        <ul className="m-0 max-w-[68ch] space-y-1.5 pl-5 font-serif text-[15px] leading-snug">{a.findings.map((f, i) => <li key={i}>{render(f)}</li>)}</ul>
        {app.exportInfo && <p className="mt-4 rounded-md border border-rule bg-paper p-2.5 text-[13px]"><strong>Ready to import.</strong> {app.exportInfo.instructions} <code>{app.exportInfo.path}</code></p>}
        {app.writtenIds && <p className="mt-4 rounded-md border border-confirmed p-2.5 text-[13px]">Added {app.writtenIds.length} items to your Papiers library.</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={addToPapiers} disabled={!!app.exportInfo || !!app.writtenIds}>Add to Papiers</button>
          <button className="btn" onClick={download}>Download findings (.md)</button>
          <button className="btn ml-auto" onClick={() => set({ abstractOpen: false })}>Close</button>
        </div>
      </article>
    </div>
  )
}
