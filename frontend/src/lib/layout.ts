import type { Star } from '../types'

// Scene units are the statue's (its fingertip is the origin, it stands ~120 tall).
// A neural-network layout: x = generation (every star of a generation shares one column, a "layer"),
// y = its slot in that column, evenly spaced and centred on the baseline's height, so a parent fans out into a
// vertical stack of children. Accuracy is read from the labels and the leaderboard, not from height.
export const FIRST_STEP = 18
export const LAYER_GAP = 64
export const SLOT_GAP = 25

export type Pos = { x: number; y: number; z: number }

export function layoutStars(stars: Star[]): Map<string, Pos> {
  const out = new Map<string, Pos>()
  const byId = new Map(stars.map((s) => [s.id, s]))
  const depth = new Map<string, number>()
  const depthOf = (s: Star): number => {
    if (!s.parent_id || !byId.has(s.parent_id)) return 0
    if (!depth.has(s.id)) depth.set(s.id, depthOf(byId.get(s.parent_id)!) + 1)
    return depth.get(s.id)!
  }
  const layers = new Map<number, Star[]>()
  for (const s of stars) layers.set(depthOf(s), [...(layers.get(depthOf(s)) ?? []), s])
  const slot = new Map<string, number>() // slot within the layer, ordered by parent then creation
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const row = layers.get(d)!.slice().sort((a, b) => (slot.get(a.parent_id ?? '') ?? 0) - (slot.get(b.parent_id ?? '') ?? 0))
    row.forEach((s, i) => {
      slot.set(s.id, i)
      out.set(s.id, { x: FIRST_STEP + d * LAYER_GAP, y: ((row.length - 1) / 2 - i) * SLOT_GAP, z: 0 })
    })
  }
  return out
}
