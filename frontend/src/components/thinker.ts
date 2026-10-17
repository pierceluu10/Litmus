// A faceted metal "Thinker": a seated figure leaning forward, elbow on knee, fist under the chin.
// Built from low-poly limbs and masses in 3D, then lit and depth-sorted as flat triangles.
type V3 = [number, number, number]
type Tri3 = { v: [V3, V3, V3]; c: V3 }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

// Turn rings of vertices into triangles. `center` lets each part decide which way is outward.
function skin(rings: V3[][], center: V3): Tri3[] {
  const out: Tri3[] = []
  for (let r = 0; r < rings.length - 1; r++) {
    const n = rings[r].length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const a = rings[r][i], b = rings[r][j], c = rings[r + 1][j], d = rings[r + 1][i]
      out.push({ v: [a, b, c], c: center }, { v: [a, c, d], c: center })
    }
  }
  return out
}
const centroid = (rings: V3[][]): V3 => {
  const all = rings.flat()
  return mul(all.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / all.length)
}

// An arm, leg or the torso: rings along p0 -> p1, with depth (rx, front-back) and width (rz, side to side).
function limb(p0: V3, p1: V3, a: { rx: number; rz: number }, b: { rx: number; rz: number }, bulge = 0.12, n = 6): Tri3[] {
  const d = norm(sub(p1, p0))
  const side: V3 = Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1]
  const u = norm(cross(side, d)), v = norm(cross(d, u))
  const ring = (t: number, k: number): V3[] => {
    const p = add(p0, mul(sub(p1, p0), t))
    const rx = (a.rx + (b.rx - a.rx) * t) * (1 + bulge * Math.sin(Math.PI * t)) * k
    const rz = (a.rz + (b.rz - a.rz) * t) * (1 + bulge * Math.sin(Math.PI * t)) * k
    return Array.from({ length: n }, (_, i) => {
      const th = (i / n) * Math.PI * 2 + 0.3
      return add(p, add(mul(u, Math.cos(th) * rx), mul(v, Math.sin(th) * rz)))
    })
  }
  const cap = (p: V3): V3[] => Array.from({ length: n }, () => p)
  const rings = [cap(sub(p0, mul(d, a.rx * 0.5))), ring(0, 0.85), ring(0.5, 1), ring(1, 0.85), cap(add(p1, mul(d, b.rx * 0.5)))]
  return skin(rings, centroid(rings))
}

// A rounded mass (head, hand, shoulder): an ellipsoid with a slightly uneven surface so it reads as faceted.
function blob(c: V3, rx: number, ry: number, rz: number, n = 7): Tri3[] {
  const lats = [-1, -0.62, -0.1, 0.5, 0.88, 1]
  const rings = lats.map((s, r) => {
    const rad = Math.sqrt(Math.max(0, 1 - s * s))
    return Array.from({ length: n }, (_, i): V3 => {
      const th = (i / n) * Math.PI * 2 + (r % 2) * 0.22
      const wob = 1 + 0.08 * Math.sin(i * 2.7 + r * 1.9)
      return [c[0] + Math.cos(th) * rx * rad * wob, c[1] + s * ry, c[2] + Math.sin(th) * rz * rad * wob]
    })
  })
  return skin(rings, c)
}

// The seat: a rough block of rock.
function rock(): Tri3[] {
  const prof = [{ y: -22, rx: 36, rz: 27 }, { y: -12, rx: 38, rz: 29 }, { y: -3, rx: 32, rz: 25 }, { y: 0, rx: 28, rz: 22 }]
  const n = 7
  const rings = prof.map((p, r) => Array.from({ length: n }, (_, i): V3 => {
    const th = (i / n) * Math.PI * 2 + 0.4
    const k = 1 + 0.1 * Math.sin(i * 2.3 + r * 1.7)
    return [2 + Math.cos(th) * p.rx * k, p.y, Math.sin(th) * p.rz * k]
  }))
  rings.push(Array.from({ length: n }, () => [2, 0, 0] as V3))
  return skin(rings, [2, -11, 0])
}

function figure(): Tri3[] {
  const t: Tri3[] = []
  t.push(...rock())
  // pelvis, torso leaning forward (toward -x), neck, head tilted down, jaw
  t.push(...blob([4, 10, 0], 12, 9, 15))
  t.push(...limb([3, 12, 0], [-12, 42, 0], { rx: 11, rz: 15 }, { rx: 12, rz: 22 }, 0.1, 7))
  t.push(...limb([-12, 42, 0], [-20, 51, 1], { rx: 5, rz: 5 }, { rx: 4.6, rz: 4.6 }, 0, 6))
  t.push(...blob([-25, 58, 1], 8, 9.5, 7.2, 8))
  t.push(...blob([-28.5, 52.5, 2], 5, 4, 5))
  t.push(...blob([-12, 41, 13], 6.5, 6.5, 6.5), ...blob([-12, 41, -13], 6.5, 6.5, 6.5))
  // propped arm: elbow on the near knee, forearm up, fist under the chin
  t.push(...limb([-12, 40, 13], [-27, 19, 12], { rx: 5.6, rz: 5.6 }, { rx: 4.6, rz: 4.6 }, 0.16))
  t.push(...limb([-27, 19, 12], [-31, 44, 7], { rx: 4.6, rz: 4.6 }, { rx: 3.6, rz: 3.6 }, 0.1))
  t.push(...blob([-30.5, 48.5, 6], 4.2, 4, 4.2))
  // resting arm: hand draped over the far knee
  t.push(...limb([-12, 40, -13], [-18, 24, -15], { rx: 5.2, rz: 5.2 }, { rx: 4.4, rz: 4.4 }, 0.14))
  t.push(...limb([-18, 24, -15], [-22, 13, -12], { rx: 4.4, rz: 4.4 }, { rx: 3.6, rz: 3.6 }, 0.1))
  t.push(...blob([-23, 11, -12], 4, 3, 3.6))
  // near leg forward, far leg tucked back
  t.push(...limb([4, 10, 8], [-27, 15, 11], { rx: 8.4, rz: 8.4 }, { rx: 6.2, rz: 6.2 }, 0.1))
  t.push(...limb([-27, 15, 11], [-31, 2, 12], { rx: 6.2, rz: 6.2 }, { rx: 4.2, rz: 4.2 }, 0.1))
  t.push(...limb([-31, 2, 12], [-41, 1.5, 12], { rx: 2.8, rz: 4.2 }, { rx: 2, rz: 3.4 }, 0.05))
  t.push(...limb([4, 10, -8], [-20, 14, -12], { rx: 8.4, rz: 8.4 }, { rx: 6.2, rz: 6.2 }, 0.1))
  t.push(...limb([-20, 14, -12], [-8, 2, -14], { rx: 6.2, rz: 6.2 }, { rx: 4.2, rz: 4.2 }, 0.1))
  t.push(...limb([-8, 2, -14], [-17, 1.5, -14], { rx: 2.8, rz: 4.2 }, { rx: 2, rz: 3.4 }, 0.05))
  return t
}

const rot = ([x, y, z]: V3, yaw: number, pitch: number): V3 => {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return [x1, y * Math.cos(pitch) - z1 * Math.sin(pitch), y * Math.sin(pitch) + z1 * Math.cos(pitch)]
}
const KEY = norm([-0.5, 0.7, 0.55]), FILL = norm([0.7, 0.1, 0.6])
const SHADOW = [48, 56, 72], LIT = [244, 246, 249]

export type Poly = { points: string; fill: string }

// cx: screen x of the figure's middle, baseY: screen y of the rock's underside, S: pixels per model unit
export function thinkerPolys(cx: number, baseY: number, S: number): Poly[] {
  const yaw = 0.62, pitch = 0.07
  const drawn: { d: number; poly: Poly }[] = []
  for (const t of figure()) {
    const [a, b, c] = t.v
    let n = cross(sub(b, a), sub(c, a))
    if (!Math.hypot(...n)) continue
    const mid: V3 = mul(add(add(a, b), c), 1 / 3)
    if (dot(n, sub(mid, t.c)) < 0) n = mul(n, -1)
    const nr = norm(rot(n, yaw, pitch))
    if (nr[2] <= 0.02) continue
    const key = Math.max(0, dot(nr, KEY)), fill = Math.max(0, dot(nr, FILL))
    const k = Math.min(1, 0.06 + 0.82 * Math.pow(key, 0.8) + 0.18 * fill)
    const color = `rgb(${SHADOW.map((s, i) => Math.round(s + (LIT[i] - s) * k)).join(',')})`
    const pts = t.v.map((p) => { const r = rot(p, yaw, pitch); return `${(cx + r[0] * S).toFixed(1)},${(baseY - (r[1] + 22) * S).toFixed(1)}` }).join(' ')
    drawn.push({ d: rot(mid, yaw, pitch)[2], poly: { points: pts, fill: color } })
  }
  drawn.sort((p, q) => p.d - q.d)
  return drawn.map((x) => x.poly)
}
