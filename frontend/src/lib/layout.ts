import type { Star } from '../types'

export const DX = 250
export type Pos = { x: number; y: number }

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

// An organic, undirected-looking graph. Stars are placed in creation order, each relative only to the
// stars before it, so a star never moves once placed. Root children fan out around the baseline; deeper
// stars keep growing outward from their parent, taking whichever angle leaves the most room.
export function layoutStars(stars: Star[]): Map<string, Pos> {
  const out = new Map<string, Pos>()
  const heading = new Map<string, number>()
  const rootId = stars.find((s) => s.parent_id === null)?.id
  for (const s of stars) {
    const parent = s.parent_id ? out.get(s.parent_id) : undefined
    if (!parent) { out.set(s.id, { x: 0, y: 0 }); heading.set(s.id, -0.55); continue }
    const base = heading.get(s.parent_id!)!
    const atRoot = s.parent_id === rootId
    const shadow = s.chosen_by === 'shadow'
    const dist = shadow ? 250 : 215 + hash(s.id + 'd') * 60
    const tries = atRoot ? 14 : 11
    let best = base, bestScore = -Infinity
    for (let k = 0; k < tries; k++) {
      const ang = atRoot
        ? base + (k / tries) * Math.PI * 2 + hash(s.id) * 0.45
        : base + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4) + (hash(s.id) - 0.5) * 0.3
      const x = parent.x + Math.cos(ang) * dist, y = parent.y + Math.sin(ang) * dist
      let near = Infinity
      for (const q of out.values()) near = Math.min(near, Math.hypot(q.x - x, q.y - y))
      const score = near - (atRoot ? 0 : Math.abs(ang - base) * 14)
      if (score > bestScore) { bestScore = score; best = ang }
    }
    out.set(s.id, { x: parent.x + Math.cos(best) * dist, y: parent.y + Math.sin(best) * dist })
    heading.set(s.id, best)
  }
  return out
}
