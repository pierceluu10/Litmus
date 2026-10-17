import { scaleLinear } from 'd3-scale'
import { line, area } from 'd3-shape'
import { starLetter, starTone, toneVar, pct } from '../lib/format'
import type { Star } from '../types'

const W = 336, H = 168, M = { l: 40, r: 12, t: 12, b: 26 }

// Accuracy along the path from the baseline to the selected star, with 95% CI bands.
// The dashed ghost line is the agent-alone shadow run branching off the same path.
export function PathChart({ stars, selected }: { stars: Star[]; selected: Star }) {
  const byId = new Map(stars.map((s) => [s.id, s]))
  const path: Star[] = []
  for (let s: Star | undefined = selected; s; s = s.parent_id ? byId.get(s.parent_id) : undefined) path.unshift(s)
  const graded = path.filter((s) => s.grade)
  if (!graded.length) return <p className="m-0 text-muted">The path chart appears once a star on this path is graded.</p>

  const band = (s: Star) => { const g = s.grade!; return g.verdict === 'baseline' ? [g.ci_low, g.ci_high] : [g.mean_child + (g.ci_low - g.delta), g.mean_child + (g.ci_high - g.delta)] }
  const ghosts = stars.filter((s) => s.chosen_by === 'shadow' && s.grade && path.some((p) => p.id === s.parent_id))
  const all = [...graded.flatMap(band), ...ghosts.flatMap(band)]
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 0.002
  const x = scaleLinear().domain([0, Math.max(1, path.length - 1)]).range([M.l, W - M.r])
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([H - M.b, M.t])
  const idx = (s: Star) => path.findIndex((p) => p.id === s.id)
  const pts = graded.map((s) => ({ s, i: idx(s), m: s.grade!.mean_child, b: band(s) }))
  const mean = line<(typeof pts)[0]>().x((d) => x(d.i)).y((d) => y(d.m))
  const bandArea = area<(typeof pts)[0]>().x((d) => x(d.i)).y0((d) => y(d.b[0])).y1((d) => y(d.b[1]))
  const ticks = y.ticks(3)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Accuracy along the path to ${selected.title}`}>
      {ticks.map((t) => (
        <g key={t}><line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeDasharray="2 3" /><text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10.5} fill="var(--color-muted)" className="num">{pct(t, 1)}</text></g>
      ))}
      <path d={bandArea(pts) ?? ''} fill="var(--color-agent)" opacity={0.14} />
      <path d={mean(pts) ?? ''} fill="none" stroke="var(--color-agent)" strokeWidth={1.8} />
      {ghosts.map((g) => {
        const p = pts.find((d) => d.s.id === g.parent_id)
        if (!p) return null
        const gx = x(p.i + 1)
        return (
          <g key={g.id}>
            <line x1={x(p.i)} y1={y(p.m)} x2={gx} y2={y(g.grade!.mean_child)} stroke="var(--color-inconclusive)" strokeWidth={1.6} strokeDasharray="4 3" />
            <circle cx={gx} cy={y(g.grade!.mean_child)} r={4} fill="var(--color-paper)" stroke="var(--color-inconclusive)" strokeWidth={1.5} />
            <text x={gx} y={y(g.grade!.mean_child) - 8} textAnchor="middle" fontSize={10} fill="var(--color-muted)">agent alone</text>
          </g>
        )
      })}
      {pts.map((d) => (
        <g key={d.s.id}>
          <circle cx={x(d.i)} cy={y(d.m)} r={5} fill={toneVar(starTone(d.s))} stroke="var(--color-surface)" strokeWidth={1.5} />
          <text x={x(d.i)} y={H - 8} textAnchor="middle" fontSize={13} fontFamily="var(--font-serif)" fill="var(--color-ink)">{starLetter(d.s.id)}</text>
        </g>
      ))}
    </svg>
  )
}
