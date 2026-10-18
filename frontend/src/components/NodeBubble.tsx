import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { agentDetail, agentName, knobText, pct, progressFraction, provMatches, pts, toneVar } from '../lib/format'
import type { Proposal, Star } from '../types'
import { SceneBackdrop } from './LowPolyScene'

const MAX_AGENTS = 4
const EXPECTS = { improves: 'expects a gain', hurts: 'expects a loss', no_effect: 'expects no change' }
const VERDICT_TEXT = { confirmed: 'Confirmed', refuted: 'Refuted', inconclusive: 'Inconclusive', baseline: 'Baseline' }
type Tab = 'about' | 'proceed'
const PLACEHOLDER_WIDTHS = ['72%', '58%', '66%'] // the option rows while they are written
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

// About the agent: the claim it tests, its result, what it found and where it would go, and Stop while it trains.
function About({ star }: { star: Star }) {
  const { app: { claims }, stopBranch } = useStore()
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
    </div>
  )
}

// While the agent writes its take and options: their shapes, waiting to be filled in.
function Generating() {
  return (
    <div aria-busy="true">
      <p className="m-0 flex items-center gap-2 text-muted" aria-live="polite"><span className="dot live-dot" style={{ background: toneVar('running') }} />Generating next steps…</p>
      <div className="mt-2 flex flex-col gap-1.5" aria-hidden>
        <span className="h-2.5 w-full animate-pulse rounded-full bg-rule" />
        <span className="h-2.5 w-3/5 animate-pulse rounded-full bg-rule" />
      </div>
      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0" aria-hidden>
        {PLACEHOLDER_WIDTHS.map((w) => (
          <li key={w} className="flex items-start gap-2 rounded-lg border border-rule p-2">
            <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border border-rule" />
            <span className="flex flex-1 flex-col gap-1.5 py-0.5"><span className="h-2.5 animate-pulse rounded-full bg-rule" style={{ width: w }} /><span className="h-2 w-1/4 animate-pulse rounded-full bg-rule/70" /></span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex justify-end"><button className="btn btn-primary" disabled>Run experiments</button></div>
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
export type Side = 'above' | 'below' | 'left' | 'right'
const GAP = 10 // px between the node's ring and the card
const LABEL_PX = 46 // the name-and-accuracy label under a node, which a card opening below must clear
const MARGIN = 8 // px the card keeps from the edges of the scene
const TOP_CLEAR = 64 // px the card keeps from the top of the scene: the legend and the scene buttons live there
const STICKY = 0.8 // a card in fallback keeps its side while it has this share of the other side's room
const OBSTACLES = '[data-scene-obstacle]' // the floating UI a card must not cover: the dock, the results card, the chat
type Box = { left: number; top: number; right: number; bottom: number }
const hits = (a: Box, b: Box) => a.left < b.right + GAP && a.right > b.left - GAP && a.top < b.bottom + GAP && a.bottom > b.top - GAP

// Keeps a node's card in clear space: above the node, else below its label, else beside it (right, then left), wherever the
// whole card fits inside the scene without covering the dock or the cards on the right. When nowhere fits it takes the
// roomier of above and below (each stopping at the first floating card in the way) and scrolls. Re-measured every frame,
// so it holds while the camera moves and the dock changes. `ringPx` is the node's on-screen radius, kept current by the scene.
export function PlacedCard({ ringPx, children }: { ringPx: { current: number }; children: (side: Side) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<Side>('above')
  const current = useRef<Side>('above')
  useEffect(() => {
    let frame = 0
    const place = () => {
      const el = box.current, scene = el?.closest('main')?.getBoundingClientRect()
      if (el && scene) {
        const node = el.parentElement!.getBoundingClientRect() // the Html sits on the node's centre
        const x = node.left, y = node.top, ring = ringPx.current
        const w = el.offsetWidth, h = el.querySelector<HTMLElement>('[data-card-body]')?.scrollHeight ?? 0
        const minTop = scene.top + TOP_CLEAR, maxBottom = scene.bottom - MARGIN
        const obstacles = [...document.querySelectorAll(OBSTACLES)].map((o) => o.getBoundingClientRect()).filter((r) => r.width && r.height)
        // beside the node the card centres on it, slid up or down within the clear band of that column (between the
        // floating cards above and below it)
        const besideTop = (left: number) => {
          const inColumn = obstacles.filter((o) => o.left < left + w + GAP && o.right > left - GAP)
          const top = Math.max(minTop, ...inColumn.filter((o) => o.bottom <= y).map((o) => o.bottom + GAP))
          const bottom = Math.min(maxBottom, ...inColumn.filter((o) => o.top >= y).map((o) => o.top - GAP))
          return Math.min(Math.max(y - h / 2, top), bottom - h)
        }
        const right = x + ring + GAP, left = x - ring - GAP - w
        const spots: [Side, number, number][] = [
          ['above', x - w / 2, y - ring - GAP - h],
          ['below', x - w / 2, y + ring + LABEL_PX + GAP],
          ['right', right, besideTop(right)],
          ['left', left, besideTop(left)],
        ]
        // the spot it is in stays first while the whole card still fits there, so panning does not flip it around
        spots.sort((a, b) => Number(b[0] === current.current) - Number(a[0] === current.current))
        const free = spots.find(([, left, top]) => {
          const card = { left, top, right: left + w, bottom: top + h }
          return left >= scene.left + MARGIN && card.right <= scene.right - MARGIN && top >= minTop && card.bottom <= maxBottom && !obstacles.some((o) => hits(card, o))
        })
        let next: Side
        if (free) {
          const [where, left, top] = free
          next = where
          el.style.transform = `translate(${left - x}px, ${top - y}px)`
          el.style.setProperty('--card-max', 'none')
          el.style.setProperty('--arrow-y', `${y - top}px`)
        } else {
          // the room above and below, each ending at the scene's edge or the first floating card in the way
          const inColumn = obstacles.filter((o) => o.left < x + w / 2 + GAP && o.right > x - w / 2 - GAP)
          const aboveEnd = y - ring - GAP, belowStart = y + ring + LABEL_PX + GAP
          const above = aboveEnd - Math.max(minTop, ...inColumn.filter((o) => o.bottom <= aboveEnd).map((o) => o.bottom + GAP))
          const below = Math.min(maxBottom, ...inColumn.filter((o) => o.top >= belowStart).map((o) => o.top - GAP)) - belowStart
          // keeps its side until the other has clearly more room
          const stay = current.current === 'above' ? above >= below * STICKY : current.current === 'below' ? below >= above * STICKY : false
          next = stay ? current.current : above >= below ? 'above' : 'below'
          el.style.transform = next === 'above' ? `translate(-50%, calc(-100% - ${ring + GAP}px))` : `translate(-50%, ${ring + LABEL_PX + GAP}px)`
          el.style.setProperty('--card-max', `${Math.max(0, Math.max(above, below))}px`)
        }
        current.current = next
        setSide((s) => (s === next ? s : next))
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [ringPx])
  return <div ref={box}>{children(side)}</div>
}

const POINTER: Record<Side, string> = {
  above: 'left-1/2 -bottom-[7px] -translate-x-1/2 border-b border-r',
  below: 'left-1/2 -top-[7px] -translate-x-1/2 border-l border-t',
  right: '-left-[7px] -translate-y-1/2 border-b border-l',
  left: '-right-[7px] -translate-y-1/2 border-r border-t',
}

export function NodeCard({ star, items, generating, side = 'above' }: { star: Star; items: Proposal[]; generating: boolean; side?: Side }) {
  const [tab, setTab] = useState<Tab>(items.length || generating ? 'proceed' : 'about')
  const proceeds = items.length > 0 || generating
  const shown = tab === 'proceed' && !proceeds ? 'about' : tab
  return (
    <div className="pointer-events-auto relative w-[300px] rounded-2xl marble-edge border border-rule bg-surface text-[12.5px]" role="dialog" aria-label={agentName(star)}
      // the card lives inside the canvas's container: without this, pressing on it starts a camera drag that captures the
      // pointer (so the click never reaches the checkbox) and scrolling it zooms the camera
      onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {/* beside the node the pointer follows its height, kept off the rounded corners */}
      <span aria-hidden className={`absolute h-3.5 w-3.5 rotate-45 border-rule bg-surface ${POINTER[side]}`}
        style={side === 'left' || side === 'right' ? { top: 'clamp(18px, var(--arrow-y), calc(100% - 18px))' } : undefined} />
      {/* clipped separately so the pointer is not cut off; scrolls when the scene leaves less room than the card needs */}
      <div data-card-body className="relative isolate overflow-y-auto overflow-x-hidden rounded-2xl p-3" style={{ maxHeight: 'var(--card-max)' }}>
      <SceneBackdrop seed={CARD_FACETS} className="card-facets" />
      <h2 className="m-0 text-[13.5px] font-semibold">{agentName(star)}{star.parent_id && <span className="num ml-1.5 text-[11.5px] font-normal text-faint">{agentDetail(star)}</span>}</h2>
      {proceeds && (
        <div role="tablist" aria-label={`${agentName(star)} details`} className="tabs mt-2">
          <button role="tab" aria-selected={shown === 'about'} onClick={() => setTab('about')}>About</button>
          <button role="tab" aria-selected={shown === 'proceed'} onClick={() => setTab('proceed')}>Where should I proceed?</button>
        </div>
      )}
      <div role="tabpanel" className="mt-2.5">{shown === 'about' ? <About star={star} /> : (generating ? <Generating /> : <Proceed star={star} items={items} />)}</div>
      </div>
    </div>
  )
}
