import type { Star } from '../types'

// Scene units are the statue's (its fingertip is the origin, it stands ~120 tall).
// A neural-network layout: x = generation (every star of a generation shares one column, a "layer"), y = a tidy tree:
// leaves take consecutive slots and each parent sits level with the middle of its children, so a branch never drifts
// away from the star it came from. The baseline stays level with the fingertip. Accuracy is read from the labels and
// the leaderboard, not from height.
export const FIRST_STEP = 18
export const LAYER_GAP = 64
export const SLOT_GAP = 25

export type Pos = { x: number; y: number; z: number }

export function layoutStars(stars: Star[]): Map<string, Pos> {
  const ids = new Set(stars.map((s) => s.id))
  const children = new Map<string, Star[]>() // in creation order
  for (const s of stars) if (s.parent_id && ids.has(s.parent_id)) children.set(s.parent_id, [...(children.get(s.parent_id) ?? []), s])
  const slot = new Map<string, number>(), depth = new Map<string, number>()
  let leaves = 0
  const place = (s: Star, d: number): number => {
    depth.set(s.id, d)
    const kids = children.get(s.id) ?? []
    const y = kids.length ? kids.map((k) => place(k, d + 1)).reduce((a, b) => a + b, 0) / kids.length : leaves++
    slot.set(s.id, y)
    return y
  }
  const roots = stars.filter((s) => !s.parent_id || !ids.has(s.parent_id))
  roots.forEach((r) => place(r, 0))
  const level = roots.length ? slot.get(roots[0].id)! : 0 // the baseline's slot sits at y = 0
  return new Map(stars.map((s) => [s.id, { x: FIRST_STEP + depth.get(s.id)! * LAYER_GAP, y: (level - slot.get(s.id)!) * SLOT_GAP, z: 0 }]))
}
