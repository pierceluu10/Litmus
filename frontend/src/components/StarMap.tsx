import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { layoutStars, type Pos } from '../lib/layout'
import { chosenVar, knobText, progressFraction, provLabel, provMatches, starLetter, starTone, toneVar } from '../lib/format'
import type { Document, Star } from '../types'

const R = 20
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Eases node positions toward their layout targets so new stars grow out of their parent and nothing jumps.
function useAnimatedPositions(target: Map<string, Pos>, parentOf: Map<string, string | null>) {
  const [cur, setCur] = useState<Map<string, Pos>>(new Map())
  const ref = useRef(new Map<string, Pos>())
  const targetRef = useRef(target)
  targetRef.current = target
  useEffect(() => {
    let raf = 0
    const instant = reduced()
    target.forEach((t, id) => {
      if (ref.current.has(id)) return
      const p = ref.current.get(parentOf.get(id) ?? '')
      ref.current.set(id, instant || !p ? { ...t } : { ...p })
    })
    const tick = () => {
      let moving = false
      ref.current.forEach((c, id) => {
        const t = targetRef.current.get(id)
        if (!t) return
        const dx = t.x - c.x, dy = t.y - c.y
        if (Math.abs(dx) + Math.abs(dy) > 0.4 && !instant) { c.x += dx * 0.16; c.y += dy * 0.16; moving = true } else { c.x = t.x; c.y = t.y }
      })
      setCur(new Map(ref.current))
      if (moving) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target, parentOf])
  return cur
}

function useCountUp(target: number, ms = 750) {
  const [v, setV] = useState(target)
  const prev = useRef(target)
  useEffect(() => {
    const from = prev.current
    prev.current = target
    if (from === target) return
    if (reduced()) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms)
      setV(from + (target - from) * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Edge({ star, from, to, docs, selected, dim }: { star: Star; from: Pos; to: Pos; docs: Document[]; selected: boolean; dim: boolean }) {
  const x1 = from.x + R, y1 = from.y, x2 = to.x - R, y2 = to.y
  const mx = (x1 + x2) / 2
  const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
  const shadow = star.chosen_by === 'shadow'
  const color = chosenVar(star.chosen_by)
  const prov = star.provenance.find((p) => p.kind === 'note' || p.kind === 'human') ?? star.provenance[0]
  const landing = useMemo(() => d, []) // the travelling dot keeps its launch path; the line itself keeps easing
  return (
    <g opacity={dim ? 0.18 : shadow ? 0.55 : 1} style={{ transition: 'opacity 200ms' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={selected ? 2.4 : 1.6} strokeDasharray={shadow ? '5 5' : undefined} pathLength={shadow ? undefined : 1} className={shadow ? undefined : 'line-draw'} />
      {star.status !== 'done' && star.status !== 'failed' && !shadow && (
        <circle r={4} fill={color} className="agent-dot"><animateMotion dur="1.2s" path={landing} fill="freeze" /></circle>
      )}
      <g transform={`translate(${mx} ${(y1 + y2) / 2 - 8})`} textAnchor="middle" style={{ pointerEvents: 'none' }}>
        <text fontSize={11.5} fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke">{knobText(star.knob_changes)}</text>
        {prov && (selected || shadow) && <text y={13} fontSize={10.5} fill={color} stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke">{shadow ? 'agent alone would run this' : `from ${provLabel(prov, docs)}`}</text>}
      </g>
    </g>
  )
}

function Node({ star, pos, selected, dim, onSelect }: { star: Star; pos: Pos; selected: boolean; dim: boolean; onSelect: () => void }) {
  const tone = starTone(star)
  const color = toneVar(tone)
  const g = star.grade
  const effect = useCountUp(g && g.verdict !== 'baseline' ? g.delta * 100 : g ? g.mean_child * 100 : 0)
  const frac = star.status === 'running' ? progressFraction(star) : 0
  const C = 2 * Math.PI * (R + 6)
  const shadow = star.chosen_by === 'shadow'
  const latest = star.progress?.length ? star.progress.reduce((a, b) => (b.epoch >= a.epoch ? b : a)) : undefined
  const sub =
    star.status === 'running' ? (latest ? `seed ${latest.seed + 1} · epoch ${latest.epoch}/${star.knobs.epochs}` : 'starting…')
    : star.status === 'waiting' ? 'waiting for you'
    : star.status === 'queued' ? 'queued'
    : star.status === 'failed' ? (star.error ?? 'failed')
    : g ? (g.verdict === 'baseline' ? 'baseline' : `${g.verdict} · ${g.n} seeds`) : ''
  const effectLabel = g ? (g.verdict === 'baseline' ? `${effect.toFixed(1)}%` : `${effect >= 0 ? '+' : '−'}${Math.abs(effect).toFixed(2)} pts`) : ''
  return (
    <g transform={`translate(${pos.x} ${pos.y})`} opacity={dim ? 0.25 : shadow ? 0.6 : 1} style={{ transition: 'opacity 200ms' }}
       role="button" tabIndex={0} aria-label={`${star.title}, ${sub}`} aria-pressed={selected}
       onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }} className="cursor-pointer outline-none">
      <title>{star.title}</title>
      {star.status === 'running' && <circle r={R} fill={color} className="star-pulse" />}
      {star.status === 'waiting' && <circle r={R + 4} fill={color} className="star-breathe" />}
      {g && <circle key={g.verdict + g.n} r={R} fill={color} className="star-bloom" />}
      {star.status === 'running' && (
        <>
          <circle r={R + 6} fill="none" stroke="var(--color-rule)" strokeWidth={2.5} />
          <circle r={R + 6} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90)" style={{ transition: 'stroke-dasharray 500ms var(--ease-out)' }} />
        </>
      )}
      {selected && <circle r={R + 11} fill="none" stroke="var(--color-ink)" strokeWidth={1.2} />}
      <circle r={R} fill={`color-mix(in srgb, ${color} 16%, var(--color-surface))`} stroke={color} strokeWidth={2} strokeDasharray={star.status === 'queued' || shadow ? '3 3' : undefined} style={{ transition: 'fill 500ms, stroke 500ms' }} />
      <text textAnchor="middle" dy="0.34em" fontSize={19} fill={color} fontFamily="var(--font-serif)" style={{ pointerEvents: 'none' }}>{starLetter(star.id)}</text>
      <g textAnchor="middle" style={{ pointerEvents: 'none' }}>
        <text y={R + 17} fontSize={12.5} fontWeight={500} fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke">{star.title.length > 26 ? star.title.slice(0, 25) + '…' : star.title}</text>
        {effectLabel && <text y={R + 33} fontSize={12.5} fontWeight={600} fill={color} stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke" className="num">{effectLabel}</text>}
        <text y={R + (effectLabel ? 48 : 33)} fontSize={10.5} fill="var(--color-muted)" stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke">{sub}</text>
      </g>
    </g>
  )
}

export function StarMap() {
  const { app, selectedId, hoveredClaim, follow, select, set } = useStore()
  const stars = app.session?.stars ?? []
  const docs = app.documents
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [cam, setCam] = useState({ x: 120, y: 250, k: 1 })
  const camTarget = useRef<{ x: number; y: number; k: number } | null>(null)
  const camRef = useRef(cam)
  camRef.current = cam

  const key = stars.map((s) => `${s.id}:${s.parent_id}:${s.chosen_by}`).join('|')
  // layout depends only on tree structure; progress updates must not re-run it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo(() => layoutStars(stars), [key])
  const parentOf = useMemo(() => new Map(stars.map((s) => [s.id, s.parent_id])), [key])
  const pos = useAnimatedPositions(target, parentOf)

  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // camera: ease toward target
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = camTarget.current
      if (t) {
        const c = camRef.current
        const f = reduced() ? 1 : 0.1
        const nx = c.x + (t.x - c.x) * f, ny = c.y + (t.y - c.y) * f, nk = c.k + (t.k - c.k) * f
        if (Math.abs(t.x - nx) + Math.abs(t.y - ny) + Math.abs(t.k - nk) < 0.3) { camTarget.current = null; setCam(t) } else setCam({ x: nx, y: ny, k: nk })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // the proposals/question dock covers the lower map, so frame stars in the upper part while it is open
  const dockOpen = !!app.session && (app.session.proposals.some((p) => p.status === 'open') || app.session.questions.some((q) => q.status === 'open'))
  const fit = (ids?: string[]) => {
    const pts = (ids?.length ? ids : stars.map((s) => s.id)).map((id) => target.get(id)).filter(Boolean) as Pos[]
    if (!pts.length) return
    const minX = Math.min(...pts.map((p) => p.x)) - 110, maxX = Math.max(...pts.map((p) => p.x)) + 150
    const minY = Math.min(...pts.map((p) => p.y)) - 80, maxY = Math.max(...pts.map((p) => p.y)) + 110
    const h = dockOpen ? size.h * 0.4 : size.h
    const k = Math.max(0.5, Math.min(1.15, (size.w - 40) / (maxX - minX), (h - 40) / (maxY - minY)))
    camTarget.current = { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k }
  }
  const activeIds = stars.filter((s) => s.status === 'running' || s.status === 'waiting' || s.status === 'queued').map((s) => s.id)
  const activeKey = activeIds.join(',') + '|' + stars.length + '|' + size.w + 'x' + size.h + dockOpen
  useEffect(() => {
    if (!follow) return
    const withParents = new Set(activeIds)
    activeIds.forEach((id) => { const p = parentOf.get(id); if (p) withParents.add(p) })
    fit([...withParents])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, follow, key])

  // pan + zoom
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const el = box.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const c = camRef.current
      const k = Math.max(0.3, Math.min(2.2, c.k * Math.exp(-e.deltaY * 0.0015)))
      const mx = e.clientX - r.left, my = e.clientY - r.top
      camTarget.current = null
      set({ follow: false })
      setCam({ k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [set])

  const hovered = hoveredClaim
  const dimmed = (s: Star) => !!hovered && !s.provenance.some((p) => provMatches(p, hovered))
  const children = stars.filter((s) => s.parent_id)

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <svg className="h-full w-full touch-none select-none" style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as Element).tagName === 'rect') { drag.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as Element).setPointerCapture(e.pointerId) } }}
        onPointerMove={(e) => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; camTarget.current = null; set({ follow: false }); setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy })) }}
        onPointerUp={() => { drag.current = null }}>
        <rect width="100%" height="100%" fill="transparent" onClick={() => select(null)} />
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          {children.map((s) => {
            const a = pos.get(s.parent_id!), b = pos.get(s.id)
            return a && b ? <Edge key={s.id} star={s} from={a} to={b} docs={docs} selected={selectedId === s.id} dim={dimmed(s)} /> : null
          })}
          {stars.map((s) => {
            const p = pos.get(s.id)
            return p ? <Node key={s.id} star={s} pos={p} selected={selectedId === s.id} dim={dimmed(s)} onSelect={() => select(s.id)} /> : null
          })}
        </g>
      </svg>
      {!stars.length && <p className="absolute inset-0 grid place-items-center text-muted">Waiting for the first star…</p>}
      <div className="absolute right-3 top-3 flex gap-2">
        <button className={`btn ${follow ? 'btn-primary' : ''}`} aria-pressed={follow} onClick={() => set({ follow: !follow })} title="Camera follows whatever is running">Follow activity</button>
        <button className="btn" onClick={() => { set({ follow: false }); fit() }}>Fit all</button>
      </div>
    </div>
  )
}
