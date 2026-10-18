import { scaleLinear } from 'd3-scale'
import { area, line } from 'd3-shape'
import { agentName, toneVar, starTone } from '../lib/format'
import { useStore } from '../store'
import type { Star } from '../types'

const W = 328, H = 176, M = { l: 44, r: 16, t: 14, b: 24 }
const FINE_SPAN = 0.005 // below half a point, ticks need two decimals to stay distinct

const pathTo = (s: Star, byId: Map<string, Star>) => {
  const out: Star[] = []
  for (let c: Star | undefined = s; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c)
  return out
}
const band = (s: Star): [number, number] => { const g = s.grade!; return g.verdict === 'baseline' ? [g.ci_low, g.ci_high] : [g.mean_child + g.ci_low - g.delta, g.mean_child + g.ci_high - g.delta] }

const EMPTY_TICKS = 4

// Before the baseline is graded: the frame, so the panel keeps its shape.
function EmptyChart() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Accuracy chart, waiting for the baseline">
      {Array.from({ length: EMPTY_TICKS }, (_, i) => {
        const y = M.t + ((H - M.t - M.b) * i) / (EMPTY_TICKS - 1)
        return <line key={i} x1={M.l} x2={W - M.r} y1={y} y2={y} stroke="var(--color-rule)" />
      })}
      <text x={M.l} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">base</text>
    </svg>
  )
}

// Accuracy along every root-to-leaf path. The highlighted path (the selected star's, else the best one)
// gets its 95% band; dashed paths are the agent's own runs (shadow branches).
export function PathChart({ stars, highlight }: { stars: Star[]; highlight: Star | null }) {
  const select = useStore((s) => s.select)
  const graded = stars.filter((s) => s.grade && s.status !== 'failed')
  if (!graded.length) return <EmptyChart />
  const byId = new Map(stars.map((s) => [s.id, s]))
  const hasGradedChild = new Set(graded.map((s) => s.parent_id))
  const leaves = graded.filter((s) => !hasGradedChild.has(s.id))
  const best = graded.filter((s) => s.chosen_by !== 'shadow').sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)[0]
  const focus = highlight?.grade ? highlight : best
  const focusPath = pathTo(focus, byId).filter((s) => s.grade)
  const onFocus = new Set(focusPath.map((s) => s.id))
  const values = [...graded.map((s) => s.grade!.mean_child), ...focusPath.flatMap(band)]
  const lo = Math.min(...values), hi = Math.max(...values), pad = (hi - lo) * 0.12 || 0.002
  const reached = Math.max(...graded.map((s) => s.depth))
  const depth = Math.max(1, reached)
  const x = scaleLinear().domain([0, depth]).range([M.l, W - M.r])
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([H - M.b, M.t])
  const digits = hi - lo + 2 * pad < FINE_SPAN ? 2 : 1
  const trace = line<Star>().x((s) => x(s.depth)).y((s) => y(s.grade!.mean_child))
  const bandArea = area<Star>().x((s) => x(s.depth)).y0((s) => y(band(s)[0])).y1((s) => y(band(s)[1]))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Accuracy along each path; highlighted: ${focus.title}`}>
      {y.ticks(4).map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" />
          <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">{(t * 100).toFixed(digits)}%</text>
        </g>
      ))}
      {Array.from({ length: reached + 1 }, (_, d) => (
        <text key={d} x={x(d)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">{d === 0 ? 'base' : `gen ${d}`}</text>
      ))}
      <path d={bandArea(focusPath) ?? ''} fill="var(--color-ink)" opacity={0.07} />
      {leaves.filter((l) => !onFocus.has(l.id)).map((l) => {
        const p = pathTo(l, byId).filter((s) => s.grade)
        return <path key={l.id} d={trace(p) ?? ''} fill="none" stroke="var(--color-faint)" strokeWidth={1.2} strokeDasharray={l.chosen_by === 'shadow' ? '3 3' : undefined} opacity={0.7} />
      })}
      <path d={trace(focusPath) ?? ''} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
      {graded.map((s) => (
        <circle key={s.id} cx={x(s.depth)} cy={y(s.grade!.mean_child)} r={onFocus.has(s.id) ? 4.5 : 3} fill={onFocus.has(s.id) ? toneVar(starTone(s)) : 'var(--color-surface)'}
          stroke={onFocus.has(s.id) ? 'var(--color-surface)' : 'var(--color-faint)'} strokeWidth={1.5} className="cursor-pointer" onClick={() => select(s.id)}>
          <title>{`${agentName(s)}: ${(s.grade!.mean_child * 100).toFixed(2)}%`}</title>
        </circle>
      ))}
      <text x={focus.depth === 0 ? x(0) + 8 : Math.min(x(focus.depth), W - M.r)} y={y(focus.grade!.mean_child) - 9} textAnchor={focus.depth === 0 ? 'start' : focus.depth === depth ? 'end' : 'middle'} fontSize={10.5} fontWeight={550} fill="var(--color-ink)">
        {(focus.grade!.mean_child * 100).toFixed(2)}%
      </text>
    </svg>
  )
}
