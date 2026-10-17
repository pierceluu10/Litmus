import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { agentDetail, agentName, knobText, pct, progressFraction, provMatches, pts, toneVar } from '../lib/format'
import type { Proposal, Star } from '../types'
import { SceneBackdrop } from './LowPolyScene'

const MAX_AGENTS = 4
const EXPECTS = { improves: 'expects a gain', hurts: 'expects a loss', no_effect: 'expects no change' }
const VERDICT_TEXT = { confirmed: 'Confirmed', refuted: 'Refuted', inconclusive: 'Inconclusive', baseline: 'Baseline' }
type Tab = 'about' | 'proceed'
const CARD_FACETS = 37

// The result in one glance: training progress, or the verdict with its effect and likely range.
function Verdict({ s }: { s: Star }) {
  const g = s.grade
  if (s.status === 'running' || s.status === 'queued') {
    const latest = (s.progress ?? []).reduce<{ epoch: number; val_acc: number } | null>((m, p) => (!m || p.epoch > m.epoch ? p : m), null)
    return (
      <div>
        <div className="flex items-baseline justify-between"><span className="font-medium" style={{ color: toneVar('running') }}>Training</span><span className="num text-[11px] text-muted">{latest ? `epoch ${latest.epoch}/${s.knobs.epochs} · ${pct(latest.val_acc)}` : 'starting'}</span></div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-rule"><div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${progressFraction(s) * 100}%`, background: toneVar('running') }} /></div>
      </div>
    )
  }
  if (!g) return <p className="m-0 text-muted">{s.status === 'waiting' ? 'Waiting for your answer.' : s.status === 'failed' ? s.error ?? 'Stopped.' : 'Not graded yet.'}</p>
  // the verdict's own colour (refuted red, confirmed green), even while the node's ring shows it is waiting on you
  const color = toneVar(g.verdict)
  return (
    <div title={`${g.n} paired seeds · p ${g.p_value < 0.001 ? '< 0.001' : g.p_value.toFixed(3)}`}>
      <div className="flex items-baseline justify-between"><span className="font-medium" style={{ color }}>{VERDICT_TEXT[g.verdict]}</span><span className="text-[11px] text-muted">{g.n} runs</span></div>
      <div className="num mt-0.5 text-[22px] font-medium leading-none tracking-[-0.03em]" style={{ color: g.verdict === 'baseline' ? undefined : color }}>
        {g.verdict === 'baseline' ? pct(g.mean_child) : <>{pts(g.delta)} <span className="text-[12px]">pts</span></>}
      </div>
      <p className="num m-0 mt-1 text-[11px] text-faint">
        {g.verdict === 'baseline' ? `Likely range ${pct(g.ci_low)} to ${pct(g.ci_high)}` : `${pct(g.mean_parent)} → ${pct(g.mean_child)} · likely ${pts(g.ci_low)} to ${pts(g.ci_high)}`}
      </p>
    </div>
  )
}

// A titled part of the card: a small caps subtitle over its text.
function Part({ title, clamp = '', children }: { title: string; clamp?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="card-subtitle">{title}</h3>
      <p className={`m-0 leading-snug text-ink ${clamp}`}>{children}</p>
    </section>
  )
}

// About the agent: the claim it tests, its result, what it found and where it would go, and the actions on it.
function About({ star }: { star: Star }) {
  const { app: { claims }, stopBranch, branch } = useStore()
  const [steer, setSteer] = useState<string | null>(null)
  const claim = star.parent_id ? claims.find((c) => star.provenance.some((p) => provMatches(p, c.id))) : undefined
  const live = star.status === 'running' || star.status === 'queued'
  return (
    <div className="flex flex-col gap-2.5">
      {claim && <Part title="Tests">{claim.summary ?? claim.text}</Part>}
      {!star.parent_id && <p className="m-0 leading-snug text-muted">The published configuration, run as is. Every agent is measured against it.</p>}
      <Verdict s={star} />
      {star.parent_id && star.reflection && <Part title="Found" clamp="line-clamp-4">{star.reflection}</Part>}
      {star.suggestion && <Part title="Suggests" clamp="line-clamp-3">{star.suggestion}</Part>}
      {live && <button className="btn h-7 self-start px-2.5 text-[12px]" onClick={() => stopBranch(star.id)}>Stop</button>}
      {!live && star.status === 'done' && (steer === null
        ? <button className="btn h-7 self-start px-2.5 text-[12px]" onClick={() => setSteer('')}>Branch from here</button>
        : (
          <form className="flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); await branch(star.id, steer); setSteer(null) }}>
            <input autoFocus aria-label="Steer the new experiments (optional)" value={steer} onChange={(e) => setSteer(e.target.value)} placeholder="Steer it (optional)" className="field min-w-0 flex-1" />
            <button className="btn btn-primary h-8 px-2.5 text-[12px]">Ask for options</button>
          </form>
        ))}
    </div>
  )
}

// "Where should I proceed?": the agent's own next steps; tick up to four and run them.
function Proceed({ star, items }: { star: Star; items: Proposal[] }) {
  const { dispatch, set } = useStore()
  const [sel, setSel] = useState<string[]>([])
  const [instr, setInstr] = useState('')
  const [steering, setSteering] = useState(false)
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_AGENTS ? [...s, id] : s))
  const run = async () => { setBusy(true); await dispatch(star.id, sel.map((proposal_id) => ({ proposal_id })), instr.trim() || undefined); setBusy(false); set({ cardFor: null }) }
  return (
    <div>
      {star.suggestion && <p className="m-0 line-clamp-3 leading-snug text-muted">{star.suggestion}</p>}
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

// The card that opens over a node when you click it: about the agent, and where it should proceed (when it has options).
export type Side = 'above' | 'below'
const GAP = 10 // px between the node's ring and the card
const LABEL_PX = 46 // the name-and-accuracy label under a node, which a card opening below must clear
const MARGIN = 8 // px the card keeps from the bottom of the scene
const TOP_CLEAR = 64 // px the card keeps from the top of the scene: the legend and the scene buttons live there

// Keeps a node's card inside the scene: above the node when it fits there (or there is more room above), otherwise
// below its label, and never taller than the room on that side (the card then scrolls). Re-measured every frame, so it
// holds while the camera moves. `ringPx` is the node's on-screen radius, kept current by the scene.
export function PlacedCard({ ringPx, children }: { ringPx: { current: number }; children: (side: Side) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<Side>('above')
  useEffect(() => {
    let frame = 0
    const place = () => {
      const el = box.current, scene = el?.closest('main')?.getBoundingClientRect()
      if (el && scene) {
        const y = el.parentElement!.getBoundingClientRect().top // the node's centre: the Html sits on it
        const ring = ringPx.current
        const above = y - ring - GAP - scene.top - TOP_CLEAR
        const below = scene.bottom - MARGIN - (y + ring + LABEL_PX + GAP)
        const need = el.querySelector<HTMLElement>('[data-card-body]')?.scrollHeight ?? 0
        const next: Side = above >= need || above >= below ? 'above' : 'below'
        el.style.transform = next === 'above' ? `translate(-50%, calc(-100% - ${ring + GAP}px))` : `translate(-50%, ${ring + LABEL_PX + GAP}px)`
        el.style.setProperty('--card-max', `${Math.max(0, next === 'above' ? above : below)}px`)
        setSide((s) => (s === next ? s : next))
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [ringPx])
  return <div ref={box}>{children(side)}</div>
}

export function NodeCard({ star, items, side = 'above' }: { star: Star; items: Proposal[]; side?: Side }) {
  const set = useStore((s) => s.set)
  const [tab, setTab] = useState<Tab>(items.length ? 'proceed' : 'about')
  const shown = tab === 'proceed' && !items.length ? 'about' : tab
  return (
    <div className="relative w-[300px] rounded-2xl border border-rule bg-surface text-[12.5px] shadow-[0_16px_40px_-12px_rgba(43,58,82,0.35)]" role="dialog" aria-label={agentName(star)}>
      <span aria-hidden className={`absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-rule bg-surface ${side === 'above' ? '-bottom-[7px] border-b border-r' : '-top-[7px] border-l border-t'}`} />
      {/* clipped separately so the pointer is not cut off; scrolls when the scene leaves less room than the card needs */}
      <div data-card-body className="relative isolate overflow-y-auto overflow-x-hidden rounded-2xl p-3" style={{ maxHeight: 'var(--card-max)' }}>
      <SceneBackdrop seed={CARD_FACETS} className="card-facets" />
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 text-[13.5px] font-semibold">{agentName(star)}{star.parent_id && <span className="num ml-1.5 text-[11.5px] font-normal text-faint">{agentDetail(star)}</span>}</h2>
        <button className="border-0 bg-transparent p-0 text-[16px] leading-none text-faint hover:text-ink" aria-label="Close" onClick={() => set({ cardFor: null })}>×</button>
      </div>
      {items.length > 0 && (
        <div role="tablist" aria-label={`${agentName(star)} details`} className="tabs mt-2">
          <button role="tab" aria-selected={shown === 'about'} onClick={() => setTab('about')}>About</button>
          <button role="tab" aria-selected={shown === 'proceed'} onClick={() => setTab('proceed')}>Where should I proceed?</button>
        </div>
      )}
      <div role="tabpanel" className="mt-2.5">{shown === 'about' ? <About star={star} /> : <Proceed star={star} items={items} />}</div>
      </div>
    </div>
  )
}
