import { hierarchy, tree } from 'd3-hierarchy'
import type { Star } from '../types'

export const DX = 250 // distance between waves
export const DY = 118 // distance between siblings
export type Pos = { x: number; y: number }

// Deterministic left-to-right tree: baseline at the origin, each wave one column to the right.
// Shadows sort after real siblings so the ghost path never pushes a real star around.
export function layoutStars(stars: Star[]): Map<string, Pos> {
  const out = new Map<string, Pos>()
  const root = stars.find((s) => s.parent_id === null)
  if (!root) return out
  const kids = (id: string) => stars.filter((s) => s.parent_id === id).sort((a, b) => Number(a.chosen_by === 'shadow') - Number(b.chosen_by === 'shadow'))
  const h = hierarchy<Star>(root, (d) => kids(d.id))
  tree<Star>().nodeSize([DY, DX]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(h)
  h.each((n) => out.set(n.data.id, { x: n.y ?? 0, y: n.x ?? 0 }))
  return out
}
