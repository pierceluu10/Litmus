import { useMemo, useRef, useState } from 'react'
import { nav } from '../auth'
import { claims as sampleClaims, documents as sampleDocuments } from '../mock/library'
import { parseLibrary, type Source } from '../lib/importLibrary'
import { useStore } from '../store'
import { GOAL } from './Landing'
import { Pillar, SceneBackdrop } from './LowPolyScene'

// Where the claims come from. The person drops their Papiers exports (or pastes passages), checks what was found, and starts.
export function Upload() {
  const { begin, set, error } = useStore()
  const [sources, setSources] = useState<Source[]>([])
  const [paste, setPaste] = useState('')
  const [off, setOff] = useState<Set<string>>(new Set())
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sample, setSample] = useState(false) // the hardcoded demo highlights, with their notes and summaries as recorded
  const input = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => parseLibrary(paste.trim() ? [...sources, { name: 'pasted text', text: paste }] : sources), [sources, paste])
  const all = sample ? { documents: sampleDocuments, claims: sampleClaims, skipped: [] as string[] } : parsed
  const chosen = all.claims.filter((c) => !off.has(c.id))

  const read = async (files: FileList | File[]) => {
    const next = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })))
    setSample(false)
    setSources((s) => [...s.filter((x) => !next.some((n) => n.name === x.name)), ...next])
  }
  const go = async (lib: { documents: typeof all.documents; claims: typeof all.claims } | null) => {
    setBusy(true)
    set({ imported: lib })
    await begin(false, GOAL)
    setBusy(false)
    nav('')
  }
  const toggle = (id: string) => setOff((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <main className="relative h-full overflow-y-auto bg-surface">
      <SceneBackdrop seed={77} className="pointer-events-none fixed inset-0 h-full w-full" />
      <Pillar seed={31} className="pointer-events-none fixed bottom-[7vh] left-[3vw] top-[5vh] hidden h-[88vh] w-[clamp(110px,12vw,180px)] xl:block" />
      <Pillar seed={32} className="pointer-events-none fixed bottom-[7vh] right-[3vw] top-[5vh] hidden h-[88vh] w-[clamp(110px,12vw,180px)] xl:block" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[1040px] flex-col px-[clamp(20px,4vw,56px)] py-6">
        <button className="self-start border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => nav('')}>Litmus</button>
        <h1 className="m-0 mt-10 text-[clamp(26px,3.4vw,40px)] font-bold leading-[1.08] tracking-[-0.03em]">Bring the claims you want tested.</h1>
        <p className="mb-0 mt-2 max-w-[56ch] text-[15px] leading-snug text-muted">Drop what you exported from Papiers, or paste passages you highlighted. Litmus ranks them with your notes first, and the agents turn them into experiments.</p>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="flex flex-col gap-3">
            <button className="btn self-start" aria-pressed={sample} style={sample ? { borderColor: 'var(--color-ink)' } : undefined} onClick={() => { setSample(!sample); setOff(new Set()) }}>
              {sample ? 'Demo highlights loaded' : 'Load the demo highlights'}
            </button>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rule bg-surface/85 px-3 py-2 text-[12.5px]">
              <span className="min-w-0 text-muted">Get your highlights in one step. Run this in the repo, then drop <span className="num text-ink">litmus-papiers.json</span> below.<code className="num mt-1 block truncate text-ink">./scripts/export-papiers.sh</code></span>
              <button className="btn h-7 shrink-0 px-2.5 text-[12px]" onClick={() => { void navigator.clipboard?.writeText('./scripts/export-papiers.sh'); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div role="button" tabIndex={0} aria-label="Choose files to upload"
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${over ? 'border-ink bg-paper' : 'border-faint bg-surface/85'}`}
              onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void read(e.dataTransfer.files) }}>
              <span className="text-[14px] font-medium">Drop files here, or click to choose</span>
              <span className="mt-1 text-[12.5px] text-muted">litmus-papiers.json, other Papiers CLI .json, or .txt and .md</span>
              <input ref={input} type="file" multiple accept=".json,.txt,.md,text/*,application/json" className="sr-only" onChange={(e) => { if (e.target.files) void read(e.target.files); e.target.value = '' }} />
            </div>
            {sources.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {sources.map((s) => (
                  <li key={s.name} className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-[12px]">
                    {s.name}<button aria-label={`Remove ${s.name}`} className="border-0 bg-transparent p-0 text-faint hover:text-ink" onClick={() => setSources((x) => x.filter((y) => y !== s))}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="paste" className="label">Or paste passages. A blank line starts a new one, “# Paper title” names the paper, “Note: …” adds your note.</label>
            <textarea id="paste" value={paste} onChange={(e) => { setSample(false); setPaste(e.target.value) }} rows={6} placeholder={'# Mixup paper\n> Mixup helps long training runs.\nNote: we only train for 10 epochs'}
              className="w-full resize-y rounded-md border border-rule bg-surface p-2.5 text-[13px] focus:border-ink focus:outline-none" />
            {all.skipped.map((m) => <p key={m} role="alert" className="m-0 text-[12.5px] text-refuted">{m}</p>)}
            <p className="m-0 text-[12.5px] text-muted">
              Or{' '}
              <button className="border-0 bg-transparent p-0 underline decoration-rule underline-offset-4 hover:decoration-ink" disabled={busy} onClick={() => go(null)}>read my connected Papiers library instead</button>.
            </p>
          </section>

          <section aria-label="Claims found" className="plate flex max-h-[520px] min-h-[220px] flex-col p-3">
            {all.claims.length === 0
              ? <p className="m-auto max-w-[32ch] text-center text-[13px] text-muted">Nothing yet. Claims you upload or paste show up here so you can check them before the agents start.</p>
              : <>
                <p className="m-0 mb-2 text-[12.5px] text-muted">{chosen.length} of {all.claims.length} claims from {all.documents.length} {all.documents.length === 1 ? 'paper' : 'papers'} · {chosen.filter((c) => c.annotation).length} with your notes</p>
                <ul className="m-0 min-h-0 flex-1 list-none space-y-1.5 overflow-y-auto p-0">
                  {all.claims.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-rule p-2.5 text-[12.5px] leading-snug" style={off.has(c.id) ? { opacity: 0.5 } : undefined}>
                        <input type="checkbox" className="mt-0.5 accent-[var(--color-ink)]" checked={!off.has(c.id)} onChange={() => toggle(c.id)} />
                        <span className="min-w-0">
                          <span className="line-clamp-3 block">{c.text}</span>
                          {c.annotation && <span className="mt-1 block text-human">Your note: {c.annotation}</span>}
                          <span className="mt-1 block truncate text-[11.5px] text-faint">{c.doc_title}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>}
          </section>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
          <button className="btn btn-primary" disabled={!chosen.length || busy} onClick={() => go({ documents: all.documents.filter((d) => chosen.some((c) => c.doc_id === d.id)), claims: chosen })}>
            {busy ? 'Starting…' : `Start research with ${chosen.length || ''} ${chosen.length === 1 ? 'claim' : 'claims'}`.replace('  ', ' ')}
          </button>
          <button className="btn" onClick={() => nav('')}>Back</button>
          {error && <p role="alert" className="m-0 text-[13px] text-refuted">{error}</p>}
        </div>
      </div>
    </main>
  )
}
