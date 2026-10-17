import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { knobText } from '../lib/format'
import type { Proposal, Question } from '../types'
import { ProvList } from './Prov'

const spring = { type: 'spring' as const, duration: 0.45, bounce: 0.12 }
const PRED = { improves: 'predicts a gain', hurts: 'predicts a loss', no_effect: 'predicts no effect' }

function Proposals({ starId, items }: { starId: string; items: Proposal[] }) {
  const dispatch = useStore((s) => s.dispatch)
  const [sel, setSel] = useState<string[]>(() => items.filter((p) => p.agent_recommended).map((p) => p.id))
  const [instr, setInstr] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s)
  return (
    <section aria-label="Proposed experiments" className="rounded-lg border border-waiting bg-surface p-3 shadow-[0_8px_24px_rgba(42,38,32,0.12)]">
      <h2 className="m-0 font-serif text-[17px] font-semibold">Where should the agents go next?</h2>
      <p className="m-0 mb-2 text-[12.5px] text-muted">Each comes from something you read. Pick up to 4. The agent’s picks are pre-selected.</p>
      <ul className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
        {items.map((p) => {
          const on = sel.includes(p.id)
          return (
            <li key={p.id}>
              <div className="flex h-full flex-col rounded-md border-2 p-2.5 text-left" style={{ borderColor: on ? 'var(--color-human)' : 'var(--color-rule)', background: on ? 'color-mix(in srgb, var(--color-human) 5%, var(--color-surface))' : undefined }}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={on} onChange={() => toggle(p.id)} disabled={!on && sel.length >= 4} />
                  <span className="font-medium leading-snug" title={p.condition_notes}>{p.title}</span>
                </label>
                {p.agent_recommended && <span className="tag mt-1" style={{ color: 'var(--color-agent)' }}>agent recommends</span>}
                <p className="m-0 mt-1 font-serif text-[13px] leading-snug">{p.hypothesis}</p>
                <p className="m-0 mt-1 text-[12px] text-muted"><span className="num">{knobText(p.knob_changes)}</span> · {PRED[p.predicted]}</p>
                <div className="mt-auto pt-2"><ProvList items={p.provenance.slice(0, 3)} /></div>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <label className="sr-only" htmlFor="instr">Instruction for the agents</label>
        <input id="instr" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Optional instruction, e.g. “use 8 seeds on anything near zero”" className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5" />
        <button className="btn btn-human" disabled={!sel.length || busy} onClick={async () => { setBusy(true); await dispatch(starId, sel.map((proposal_id) => ({ proposal_id })), instr.trim() || undefined); setBusy(false) }}>
          Dispatch {sel.length} agent{sel.length === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  )
}

function QuestionCard({ q }: { q: Question }) {
  const { answer, app } = useStore()
  const [opt, setOpt] = useState<string>('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const working = (app.session?.stars ?? []).filter((s) => s.status === 'running' && s.id !== q.star_id).length
  const lean = q.options.find((o) => o.id === q.agent_leaning)
  return (
    <section aria-label="The agent has a question for you" className="rounded-lg border-2 border-waiting bg-surface p-3 shadow-[0_8px_24px_rgba(42,38,32,0.14)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-serif text-[17px] font-semibold">Your call</h2>
        {working > 0 && <span className="text-[12.5px] text-muted">{working} agent{working === 1 ? ' is' : 's are'} still working while this waits for you</span>}
      </div>
      <p className="m-0 mt-1 font-serif text-[14.5px] leading-snug">{q.text}</p>
      <div className="mt-2"><span className="mb-1 block text-[12px] text-muted">The evidence conflicts. Read both sides:</span><ProvList items={q.evidence} /></div>
      <fieldset className="m-0 mt-3 grid gap-2 border-0 p-0" style={{ gridTemplateColumns: `repeat(${q.options.length}, minmax(0, 1fr))` }}>
        <legend className="sr-only">Choose a direction</legend>
        {q.options.map((o) => (
          <label key={o.id} className="cursor-pointer rounded-md border-2 p-2.5" style={{ borderColor: opt === o.id ? 'var(--color-human)' : 'var(--color-rule)' }}>
            <span className="flex items-start gap-2"><input type="radio" name={q.id} className="mt-1" checked={opt === o.id} onChange={() => setOpt(o.id)} /><span className="font-medium leading-snug">{o.label}</span></span>
            <span className="mt-1 block pl-5 text-[12.5px] text-muted">{o.consequence}</span>
            {o.id === q.agent_leaning && <span className="tag mt-1 block pl-5" style={{ color: 'var(--color-agent)' }}>agent leans this way</span>}
          </label>
        ))}
      </fieldset>
      {lean && <p className="m-0 mt-2 text-[12px] text-muted">If you do not choose, the agent would go with: {lean.label}.</p>}
      <div className="mt-2 flex items-center gap-2">
        <label className="sr-only" htmlFor="qc">Comment</label>
        <input id="qc" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional: tell the agent why" className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5" />
        <button className="btn btn-human" disabled={!opt || busy} onClick={async () => { setBusy(true); await answer(q.id, opt, comment.trim() || undefined); setBusy(false) }}>Answer</button>
      </div>
    </section>
  )
}

export function Dock() {
  const app = useStore((s) => s.app)
  const s = app.session
  const questions = (s?.questions ?? []).filter((q) => q.status === 'open')
  const open = (s?.proposals ?? []).filter((p) => p.status === 'open')
  const starIds = [...new Set(open.map((p) => p.star_id))]
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex max-h-[62%] flex-col gap-2 overflow-y-auto">
      <AnimatePresence initial={false}>
        {questions.map((q) => (
          <motion.div key={q.id} className="pointer-events-auto" initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }} transition={spring}>
            <QuestionCard q={q} />
          </motion.div>
        ))}
        {starIds.map((id) => (
          <motion.div key={id} className="pointer-events-auto" initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }} transition={spring}>
            <Proposals starId={id} items={open.filter((p) => p.star_id === id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
