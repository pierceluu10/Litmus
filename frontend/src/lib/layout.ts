import type { Star } from '../types'

// Scene units are the statue's (its fingertip is the origin, it stands ~120 tall).
// A neural-network layout: x = generation (every star of a generation shares one column, a "layer") and y = accuracy,
// on the same scale for every star, so the nodes line up with the accuracy graph: higher accuracy sits higher, and the
// baseline stays level with the fingertip. A star that is still training sits level with its parent until it is graded.
// Two stars of one generation never overlap: when their accuracies are too close they are nudged apart, keeping their
// order and their side of the baseline (a star below the baseline never sits above it).
export const FIRST_STEP = 18
export const LAYER_GAP = 120 // wide enough that a star's label never reaches the next column
export const MIN_GAP = 58 // the least vertical room two stars of one column get: the sphere plus its two-line label
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
  for (const col of columns.values()) {
    const order = [...col].sort((a, b) => raw.get(b.id)! - raw.get(a.id)!) // stable: ties keep start order, first on top
    // stars above the baseline are only nudged up and stars below only down, so none crosses the baseline
    const above = order.filter((s) => raw.get(s.id)! >= 0).reverse()
    let floor = -Infinity
    for (const s of above) { y.set(s.id, Math.max(raw.get(s.id)!, floor)); floor = y.get(s.id)! + MIN_GAP }
    let ceiling = above.length ? y.get(above[0].id)! - MIN_GAP : Infinity
    for (const s of order.filter((s) => raw.get(s.id)! < 0)) { y.set(s.id, Math.min(raw.get(s.id)!, ceiling)); ceiling = y.get(s.id)! - MIN_GAP }
  }
  return new Map(stars.map((s) => [s.id, { x: FIRST_STEP + depth.get(s.id)! * LAYER_GAP, y: y.get(s.id)!, z: 0 }]))
}
