import { useState } from 'react'
import { useStore } from '../store'
import { agentName, knobText } from '../lib/format'
import type { Proposal, Star } from '../types'

const MAX_AGENTS = 4
const EXPECTS = { improves: 'expects a gain', hurts: 'expects a loss', no_effect: 'expects no change' }

// "Where should I proceed?": a speech bubble that comes out of a finished node when you click it (or its light bulb).
export function ProceedBubble({ star, items }: { star: Star; items: Proposal[] }) {
  const { dispatch, set, select } = useStore()
  const [sel, setSel] = useState<string[]>([])
  const [instr, setInstr] = useState('')
  const [steering, setSteering] = useState(false)
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_AGENTS ? [...s, id] : s))
  const run = async () => { setBusy(true); await dispatch(star.id, sel.map((proposal_id) => ({ proposal_id })), instr.trim() || undefined); setBusy(false); set({ proceedFor: null }) }
  return (
    <div className="relative w-[300px] rounded-2xl border border-rule bg-surface p-3 text-[12.5px] shadow-[0_16px_40px_-12px_rgba(43,58,82,0.35)]" role="dialog" aria-label={`Where should I proceed? ${agentName(star)}`}>
      <span aria-hidden className="absolute -left-[7px] top-6 h-3.5 w-3.5 rotate-45 border-b border-l border-rule bg-surface" />
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 text-[13px] font-semibold">Where should I proceed?</h2>
        <span className="flex items-center gap-2">
          <button className="label border-0 bg-transparent p-0 underline decoration-rule underline-offset-4 hover:text-ink" onClick={() => { select(star.id); set({ proceedFor: null }) }}>See results</button>
          <button className="border-0 bg-transparent p-0 text-[16px] leading-none text-faint hover:text-ink" aria-label="Close" onClick={() => set({ proceedFor: null })}>×</button>
        </span>
      </div>
      {star.suggestion && <p className="m-0 mt-1 line-clamp-3 leading-snug text-muted">{star.suggestion}</p>}
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {items.map((p) => {
          const on = sel.includes(p.id)
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition-colors" title={EXPECTS[p.predicted]} style={{ borderColor: on ? 'var(--color-ink)' : 'var(--color-rule)', background: on ? 'var(--color-marble)' : undefined }}>
                <input type="checkbox" className="mt-0.5 accent-[var(--color-ink)]" checked={on} onChange={() => toggle(p.id)} disabled={!on && sel.length >= MAX_AGENTS} />
                <span className="min-w-0"><span className="block font-medium leading-snug">{p.title}</span><span className="num block text-[11px] text-muted">{knobText(p.knob_changes)}</span></span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        {steering
          ? <input autoFocus aria-label="Instruction for the new agents" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Steer the new agents" className="field min-w-0 flex-1" />
          : <button className="label mr-auto hover:text-ink" onClick={() => setSteering(true)}>Add an instruction</button>}
        <button className="btn btn-primary" disabled={!sel.length || busy} onClick={run}>Run {sel.length || ''} experiment{sel.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  )
}
