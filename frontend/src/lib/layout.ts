import type { Star } from '../types'

// Scene units are the statue's (its fingertip is the origin, it stands ~120 tall).
// x = generations from the fingertip (siblings fan out one column each, so labels never collide),
// y = measured accuracy, z = a little depth per sibling for parallax.
export const FIRST_STEP = 18
export const STEP = 40
export const COLUMN = 34
export const Z_SPREAD = 14
export const UNITS_PER_POINT = 22 // one accuracy point (0.01) of height

export type Pos = { x: number; y: number; z: number }

export const yFor = (accuracy: number, baseline: number) => (accuracy - baseline) * 100 * UNITS_PER_POINT

// A star sits at its measured accuracy once graded; until then it rides at its parent's height,
// so the moment a result lands the star visibly rises or sinks.
export function layoutStars(stars: Star[]): Map<string, Pos> {
  const out = new Map<string, Pos>()
  const baseline = stars[0]?.grade?.mean_child
  const children = new Map<string, Star[]>()
  for (const s of stars) if (s.parent_id) children.set(s.parent_id, [...(children.get(s.parent_id) ?? []), s])
  for (const s of stars) {
    const parent = s.parent_id ? out.get(s.parent_id) : undefined
    if (!parent) { out.set(s.id, { x: FIRST_STEP, y: 0, z: 0 }); continue }
    const siblings = children.get(s.parent_id!)!
    const i = siblings.indexOf(s)
    const graded = s.grade && baseline !== undefined && s.status !== 'failed'
    out.set(s.id, { x: parent.x + STEP + i * COLUMN, y: graded ? yFor(s.grade!.mean_child, baseline) : parent.y, z: parent.z + (i - (siblings.length - 1) / 2) * Z_SPREAD })
  }
  return out
}
