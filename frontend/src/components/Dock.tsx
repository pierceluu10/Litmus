import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { agentName } from '../lib/format'
import type { Question, Star } from '../types'
import { ProvList } from './Prov'

const spring = { type: 'spring' as const, duration: 0.45, bounce: 0.1 }
// The baseline has no agent of its own: options planned from it come from Litmus.
const speaker = (s: Star | undefined) => (!s || !s.parent_id ? 'Litmus' : agentName(s))
const panel = 'mx-auto w-full max-w-[920px] rounded-xl border border-rule bg-surface p-3 shadow-[0_1px_2px_rgb(21_24_28/0.06),0_12px_32px_rgb(21_24_28/0.10)]'

function QuestionCard({ q }: { q: Question }) {
  const { answer, app } = useStore()
  const [opt, setOpt] = useState(q.agent_leaning ?? '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const star = app.session!.stars.find((s) => s.id === q.star_id)
  return (
    <section data-scene-obstacle aria-label={`${star ? agentName(star) : 'An agent'} needs your call`} className={panel} style={{ borderColor: 'color-mix(in srgb, var(--color-waiting) 55%, var(--color-rule))' }}>
      <div className="flex items-baseline gap-2">
        <span className="dot live-dot" style={{ background: 'var(--color-waiting)' }} />
        <h2 className="m-0 text-[13.5px] font-semibold">Your call{star ? ` on ${agentName(star)}` : ''}</h2>
      </div>
      <p className="m-0 mt-1.5 max-w-[80ch] leading-snug">{q.text}</p>
      {q.evidence.length > 0 && (
        <details className="mt-1.5 text-[12px] text-muted"><summary className="cursor-pointer select-none">Evidence ({q.evidence.length})</summary><div className="mt-1.5"><ProvList items={q.evidence} /></div></details>
      )}
      <fieldset className="m-0 mt-2.5 grid gap-2 border-0 p-0" style={{ gridTemplateColumns: `repeat(${q.options.length}, minmax(0, 1fr))` }}>
        <legend className="sr-only">Choose a direction</legend>
        {q.options.map((o) => (
          <label key={o.id} className="cursor-pointer rounded-lg border p-2.5 transition-colors" style={{ borderColor: opt === o.id ? 'var(--color-ink)' : 'var(--color-rule)', background: opt === o.id ? 'var(--color-marble)' : undefined }}>
            <span className="flex items-start gap-2"><input type="radio" name={q.id} className="mt-0.5 accent-[var(--color-ink)]" checked={opt === o.id} onChange={() => setOpt(o.id)} /><span className="text-[13px] font-medium leading-snug">{o.label}</span></span>
            <span className="mt-1 block pl-5 text-[12px] text-muted">{o.consequence}</span>
            {o.id === q.agent_leaning && <span className="mt-1 block pl-5 text-[11px] font-medium text-agent">{star ? agentName(star) : 'The agent'} leans this way</span>}
          </label>
        ))}
      </fieldset>
      <div className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor={`qc-${q.id}`}>Additional info</label>
        <input id={`qc-${q.id}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Additional info" className="field min-w-0 flex-1" />
        <button className="btn btn-primary" disabled={!opt || busy} onClick={async () => { setBusy(true); await answer(q.id, opt, comment.trim() || undefined); setBusy(false) }}>Answer</button>
      </div>
    </section>
  )
}

type Pending = { key: string; label: string; waiting: boolean; node: ReactNode }

// Questions waiting on the human, one card at a time (a pager when several agents ask). "Where should I proceed?" is not here:
// it comes out of the node itself (NodeBubble).
export function Dock() {
  const s = useStore((st) => st.app.session)
  const [choice, setChoice] = useState<{ key: string; newest: string } | null>(null)
  const questions = (s?.questions ?? []).filter((q) => q.status === 'open')
  const name = (id: string) => speaker(s?.stars.find((x) => x.id === id))
  const pending: Pending[] = [
    ...questions.map((q) => ({ key: q.id, label: `Your call on ${name(q.star_id)}`, waiting: true, node: <QuestionCard q={q} /> })),
  ]
  const newest = pending[pending.length - 1]?.key
  const active = choice && choice.newest === newest && pending.some((p) => p.key === choice.key) ? choice.key : newest
  const index = Math.max(0, pending.findIndex((p) => p.key === active))
  const go = (d: number) => setChoice({ key: pending[(index + d + pending.length) % pending.length].key, newest: newest! })
  const enter = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 12, transition: { duration: 0.15 } }, transition: spring }
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex max-h-[60%] flex-col gap-2 lg:left-[max(1rem,var(--rail))] lg:right-[max(1rem,calc(var(--panel)+0.25rem))]">
      {pending.length > 1 && (
        <div data-scene-obstacle role="group" aria-label="Waiting on you" className="on-scene pointer-events-auto mx-auto flex w-full max-w-[920px] items-center justify-between gap-2 rounded-full border border-rule bg-surface px-1.5 py-1 text-[12.5px] shadow-[0_6px_18px_-8px_rgba(43,58,82,0.25)]">
          <button className="btn h-7 w-7 px-0" aria-label="Previous" onClick={() => go(-1)}>‹</button>
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
            {pending[index].waiting && <span className="dot live-dot" style={{ background: 'var(--color-waiting)' }} />}
            <span className="truncate font-medium">{pending[index].label}</span>
            <span className="text-faint">{index + 1} of {pending.length}</span>
          </span>
          <button className="btn h-7 w-7 px-0" aria-label="Next" onClick={() => go(1)}>›</button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {/* inactive panels stay mounted so a half-made selection survives switching tabs */}
        {pending.map((p) => <motion.div key={p.key} role="tabpanel" hidden={p.key !== active} className="pointer-events-auto min-h-0 overflow-y-auto" {...enter}>{p.node}</motion.div>)}
      </AnimatePresence>
    </div>
  )
}
