import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { agentName, knobText } from '../lib/format'
import type { Proposal, Question } from '../types'
import { ProvChip, ProvList } from './Prov'

const MAX_AGENTS = 4
const spring = { type: 'spring' as const, duration: 0.45, bounce: 0.1 }
const EXPECTS = { improves: 'expects a gain', hurts: 'expects a loss', no_effect: 'expects no change' }
const panel = 'mx-auto w-full max-w-[920px] rounded-xl border border-rule bg-surface p-3 shadow-[0_1px_2px_rgb(21_24_28/0.06),0_12px_32px_rgb(21_24_28/0.10)]'

function Proposals({ starId, items, background }: { starId: string; items: Proposal[]; background: boolean }) {
  const { dispatch, app, select } = useStore()
  const from = app.session!.stars.find((s) => s.id === starId)
  const [sel, setSel] = useState<string[]>([])
  const [instr, setInstr] = useState('')
  const [busy, setBusy] = useState(false)
  const [folded, setFolded] = useState<boolean | null>(null) // null: fold while something newer needs attention, until the human chooses
  const collapsed = folded ?? background
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_AGENTS ? [...s, id] : s))
  return (
    <section aria-label="Proposed experiments" className={panel}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[13.5px] font-semibold">{items.length} experiments ready from <button className="underline decoration-rule underline-offset-4 hover:decoration-ink" onClick={() => from && select(from.id)}>{from ? agentName(from) : starId}</button></h2>
        <button className="label hover:text-ink" aria-expanded={!collapsed} onClick={() => setFolded(!collapsed)}>{collapsed ? 'review' : 'hide'}</button>
      </div>
      {!collapsed && <>
      <ul className="m-0 mt-2.5 grid list-none gap-2 p-0" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
        {items.map((p) => {
          const on = sel.includes(p.id)
          const claim = p.provenance.find((x) => x.kind === 'highlight')
          return (
            <li key={p.id}>
              <label className="flex h-full cursor-pointer flex-col rounded-lg border p-2.5 transition-colors" style={{ borderColor: on ? 'var(--color-ink)' : 'var(--color-rule)', background: on ? 'var(--color-marble)' : undefined }}>
                <span className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 accent-[var(--color-ink)]" checked={on} onChange={() => toggle(p.id)} disabled={!on && sel.length >= MAX_AGENTS} />
                  <span className="text-[13px] font-medium leading-snug">{p.title}</span>
                </span>
                <span className="num mt-1 pl-5 text-[11px] text-muted">{knobText(p.knob_changes)} · {EXPECTS[p.predicted]}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1.5 pl-5 pt-2">
                  {claim && <ProvChip p={claim} />}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor={`instr-${starId}`}>Instruction for the agents</label>
        <input id={`instr-${starId}`} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Instruction for the agents (optional)" className="field min-w-0 flex-1" />
        <button className="btn btn-primary" disabled={!sel.length || busy} onClick={async () => { setBusy(true); await dispatch(starId, sel.map((proposal_id) => ({ proposal_id })), instr.trim() || undefined); setBusy(false) }}>
          Dispatch {sel.length || ''} agent{sel.length === 1 ? '' : 's'}
        </button>
      </div>
      </>}
    </section>
  )
}

function QuestionCard({ q }: { q: Question }) {
  const { answer, app } = useStore()
  const [opt, setOpt] = useState(q.agent_leaning ?? '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const star = app.session!.stars.find((s) => s.id === q.star_id)
  return (
    <section aria-label="The agent needs your call" className={panel} style={{ borderColor: 'color-mix(in srgb, var(--color-waiting) 55%, var(--color-rule))' }}>
      <div className="flex items-baseline gap-2">
        <span className="dot live-dot" style={{ background: 'var(--color-waiting)' }} />
        <h2 className="m-0 text-[13.5px] font-semibold">Your call{star ? ` on ${agentName(star)}` : ''}</h2>
      </div>
      <p className="m-0 mt-1.5 max-w-[80ch] leading-snug">{q.text}</p>
      <div className="mt-2"><ProvList items={q.evidence} /></div>
      <fieldset className="m-0 mt-2.5 grid gap-2 border-0 p-0" style={{ gridTemplateColumns: `repeat(${q.options.length}, minmax(0, 1fr))` }}>
        <legend className="sr-only">Choose a direction</legend>
        {q.options.map((o) => (
          <label key={o.id} className="cursor-pointer rounded-lg border p-2.5 transition-colors" style={{ borderColor: opt === o.id ? 'var(--color-ink)' : 'var(--color-rule)', background: opt === o.id ? 'var(--color-marble)' : undefined }}>
            <span className="flex items-start gap-2"><input type="radio" name={q.id} className="mt-0.5 accent-[var(--color-ink)]" checked={opt === o.id} onChange={() => setOpt(o.id)} /><span className="text-[13px] font-medium leading-snug">{o.label}</span></span>
            <span className="mt-1 block pl-5 text-[12px] text-muted">{o.consequence}</span>
            {o.id === q.agent_leaning && <span className="mt-1 block pl-5 text-[11px] font-medium text-agent">agent leans this way</span>}
          </label>
        ))}
      </fieldset>
      <div className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor={`qc-${q.id}`}>Why (optional)</label>
        <input id={`qc-${q.id}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why (optional)" className="field min-w-0 flex-1" />
        <button className="btn btn-primary" disabled={!opt || busy} onClick={async () => { setBusy(true); await answer(q.id, opt, comment.trim() || undefined); setBusy(false) }}>Answer</button>
      </div>
    </section>
  )
}

export function Dock() {
  const s = useStore((st) => st.app.session)
  const questions = (s?.questions ?? []).filter((q) => q.status === 'open')
  const open = (s?.proposals ?? []).filter((p) => p.status === 'open')
  const starIds = [...new Set(open.map((p) => p.star_id))]
  const enter = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 12, transition: { duration: 0.15 } }, transition: spring }
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex max-h-[50%] flex-col gap-2 overflow-y-auto">
      <AnimatePresence initial={false}>
        {questions.map((q) => <motion.div key={q.id} className="pointer-events-auto" {...enter}><QuestionCard q={q} /></motion.div>)}
        {starIds.map((id, i) => <motion.div key={id} className="pointer-events-auto" {...enter}><Proposals starId={id} items={open.filter((p) => p.star_id === id)} background={questions.length > 0 || i < starIds.length - 1} /></motion.div>)}
      </AnimatePresence>
    </div>
  )
}
