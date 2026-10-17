import type { Star } from '../types'

// Scene units are the statue's (its fingertip is the origin, it stands ~120 tall).
// A neural-network layout: x = generation (every star of a generation shares one column, a "layer") and y = accuracy,
// on the same scale for every star, so the nodes line up with the accuracy graph: higher accuracy sits higher, and the
// baseline stays level with the fingertip. A star that is still training sits level with its parent until it is graded.
// Two stars of one generation never overlap: when their accuracies are too close they are nudged apart, keeping their
// order, and the column is re-centred so it does not drift.
export const FIRST_STEP = 18
export const LAYER_GAP = 64
export const MIN_GAP = 24 // the least vertical room two stars of one column get
export const UNITS_PER_POINT = 30 // scene units per accuracy point (0.01)

export type Pos = { x: number; y: number; z: number }

export function layoutStars(stars: Star[]): Map<string, Pos> {
  const byId = new Map(stars.map((s) => [s.id, s]))
  const roots = stars.filter((s) => !s.parent_id || !byId.has(s.parent_id))
  const base = roots[0]?.grade?.mean_child
  const depth = new Map<string, number>(), raw = new Map<string, number>()
  const walk = (s: Star): void => {
    if (depth.has(s.id)) return
    const parent = s.parent_id ? byId.get(s.parent_id) : undefined
    if (parent) walk(parent)
    depth.set(s.id, parent ? depth.get(parent.id)! + 1 : 0)
    raw.set(s.id, s.grade && base !== undefined && parent ? (s.grade.mean_child - base) * 100 * UNITS_PER_POINT : parent ? raw.get(parent.id)! : 0)
  }
  stars.forEach(walk)
  const y = new Map<string, number>()
  const columns = new Map<number, Star[]>()
  stars.forEach((s) => columns.set(depth.get(s.id)!, [...(columns.get(depth.get(s.id)!) ?? []), s]))
  for (const [d, col] of columns) {
    const order = col.map((s, i) => ({ s, i })).sort((a, b) => raw.get(b.s.id)! - raw.get(a.s.id)! || a.i - b.i).map((o) => o.s)
    const placed: number[] = []
    order.forEach((s, i) => placed.push(i ? Math.min(raw.get(s.id)!, placed[i - 1] - MIN_GAP) : raw.get(s.id)!))
    // pushing downward drifts the column; share the shift so the stars stay as near their accuracy as they can
    const shift = d === 0 ? 0 : placed.reduce((sum, v, i) => sum + (raw.get(order[i].id)! - v), 0) / placed.length
    order.forEach((s, i) => y.set(s.id, placed[i] + shift))
  }
  return new Map(stars.map((s) => [s.id, { x: FIRST_STEP + depth.get(s.id)! * LAYER_GAP, y: y.get(s.id)!, z: 0 }]))
}
