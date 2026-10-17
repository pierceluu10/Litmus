import { THINKER_MESH } from './thinkerMesh'

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// The STL is z-up; view space is y-up with z toward the viewer. This is a proper rotation, so winding is kept.
const toView = ([x, y, z]: number[]): V3 => [x - 138, z, -(y - 78)]
const rot = ([x, y, z]: V3, yaw: number, pitch: number): V3 => {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return [x1, y * Math.cos(pitch) - z1 * Math.sin(pitch), y * Math.sin(pitch) + z1 * Math.cos(pitch)]
}
const KEY = norm([-0.5, 0.7, 0.55]), FILL = norm([0.7, 0.1, 0.6])
// nearly the colour of the background, so the statue reads as a relief in the same material
const SHADOW = [166, 183, 208], LIT = [248, 250, 253]

export type Poly = { points: string; fill: string }

export function thinkerPolys(cx: number, baseY: number, S: number, yaw = -0.95, pitch = 0.05): Poly[] {
  const V = THINKER_MESH.v.map(toView)
  const drawn: { d: number; poly: Poly }[] = []
  for (const [i, j, k] of THINKER_MESH.t) {
    const a = rot(V[i], yaw, pitch), b = rot(V[j], yaw, pitch), c = rot(V[k], yaw, pitch)
    const n = norm(cross(sub(b, a), sub(c, a)))
    if (n[2] <= 0.02) continue
    const key = Math.max(0, dot(n, KEY)), fill = Math.max(0, dot(n, FILL))
    const t = Math.min(1, 0.05 + 0.85 * Math.pow(key, 0.85) + 0.15 * fill)
    const color = `rgb(${SHADOW.map((s, q) => Math.round(s + (LIT[q] - s) * t)).join(',')})`
    const pts = [a, b, c].map((p) => `${(cx + p[0] * S).toFixed(1)},${(baseY - p[1] * S).toFixed(1)}`).join(' ')
    drawn.push({ d: (a[2] + b[2] + c[2]) / 3, poly: { points: pts, fill: color } })
  }
  drawn.sort((p, q) => p.d - q.d)
  return drawn.map((x) => x.poly)
}
