// A faceted marble bust of a man, built as a real 3D mesh (lofted rings) and lit from the upper left.
// Low-poly comes from the low ring/segment count, not from random jitter.
type V3 = [number, number, number]
type Tri3 = { v: [V3, V3, V3] }
type Ring = { y: number; rx: number; rz: number; cz: number }
type Disp = (ri: number, i: number, p: V3) => V3

const N = 14 // segments around the head; index 0 is straight ahead

function loft(rings: Ring[], n: number, disp?: Disp, start = 0, mult = 1): Tri3[] {
  const vert = rings.map((r, ri) => Array.from({ length: n }, (_, i): V3 => {
    const t = start + (i / n) * Math.PI * 2
    const p: V3 = [r.rx * mult * Math.sin(t), r.y, r.cz + r.rz * mult * Math.cos(t)]
    return disp ? disp(ri, i, p) : p
  }))
  const out: Tri3[] = []
  for (let ri = 0; ri < rings.length - 1; ri++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = vert[ri][i], b = vert[ri][j], c = vert[ri + 1][j], d = vert[ri + 1][i]
    out.push({ v: [a, b, c] }, { v: [a, c, d] })
  }
  return out
}

const HEAD: Ring[] = [
  { y: 0.0, rx: 2.8, rz: 3.0, cz: 6.0 },   // chin
  { y: 2.0, rx: 5.8, rz: 6.5, cz: 2.8 },   // jaw
  { y: 4.5, rx: 7.0, rz: 8.4, cz: 1.0 },   // lips
  { y: 6.5, rx: 7.3, rz: 8.7, cz: 0.6 },   // under the nose
  { y: 8.5, rx: 7.6, rz: 9.0, cz: 0.4 },   // nose tip, cheekbones
  { y: 11.5, rx: 7.6, rz: 9.2, cz: 0.2 },  // eyes
  { y: 13.5, rx: 7.5, rz: 9.3, cz: 0.3 },  // brow
  { y: 16.5, rx: 7.3, rz: 9.0, cz: 0.0 },  // forehead
  { y: 19.5, rx: 6.4, rz: 8.2, cz: -0.5 },
  { y: 22.0, rx: 4.2, rz: 6.2, cz: -1.0 },
  { y: 23.6, rx: 0.1, rz: 0.1, cz: -1.0 }, // crown
]
const face: Disp = (ri, i, [x, y, z]) => {
  const m = Math.min(i, N - i)
  switch (ri) {
    case 1: if (m === 0) z -= 0.4; break // groove under the lip
    case 2: if (m === 0) z += 0.7; else if (m === 1) z += 0.15; break // lips
    case 3: if (m === 0) z += 1.5; else if (m === 1) z += 0.2; break // underside of the nose
    case 4: if (m === 0) z += 3.1; else if (m === 1) z += 0.6; else if (m === 2) x *= 1.07; break // nose tip, cheekbones
    case 5: if (m === 0) z += 1.3; else if (m === 1) z -= 0.9; else if (m === 2) x *= 1.05; break // bridge, eye sockets
    case 6: if (m === 0) z += 0.3; else if (m === 1) z += 1.0; else if (m === 2) z += 0.3; break // brow ridge
    case 7: if (m === 0) z += 0.2; break
  }
  return [x, y, z]
}

const prof = (y: number) => {
  const r = HEAD
  if (y <= r[0].y) return r[0]
  for (let k = 0; k < r.length - 1; k++) if (y <= r[k + 1].y) {
    const t = (y - r[k].y) / (r[k + 1].y - r[k].y)
    const l = (a: number, b: number) => a + (b - a) * t
    return { y, rx: l(r[k].rx, r[k + 1].rx), rz: l(r[k].rz, r[k + 1].rz), cz: l(r[k].cz, r[k + 1].cz) }
  }
  return r[r.length - 1]
}

// Hair: a shell over the skull with a hem that rises over the ears and drops at the nape, and alternating curls.
function hair(): Tri3[] {
  const hem = [17.2, 16.6, 15.6, 14.4, 14.4, 10.5, 8.0, 7.0]
  const L = 5
  const v = (i: number, j: number): V3 => {
    const m = Math.min(i % N, N - (i % N))
    const t = j / L
    const y = hem[m] + (23.9 - hem[m]) * t
    const p = prof(y)
    const th = (i / N) * Math.PI * 2
    const curl = (((i + j) % 2) ? 1 : -1) * 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.4))
    const k = 1.1 + curl / 8
    const front = i % N === 0 || i % N === 1 || i % N === N - 1 ? (t < 0.35 ? 0.7 : 0) : 0
    return [p.rx * k * Math.sin(th), y, p.cz + p.rz * k * Math.cos(th) + front]
  }
  const out: Tri3[] = []
  for (let i = 0; i < N; i++) for (let j = 0; j < L; j++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1)
    out.push({ v: [a, b, c] }, { v: [a, c, d] })
  }
  return out
}

function ears(): Tri3[] {
  return [1, -1].flatMap((s) => {
    const P1: V3 = [s * 8.8, 12.6, -2.2], P2: V3 = [s * 8.7, 8.9, -2.0], P3: V3 = [s * 7.6, 12.0, -0.4], P4: V3 = [s * 7.6, 9.2, -0.6], P5: V3 = [s * 8.0, 12.2, -4.0], P6: V3 = [s * 8.0, 9.4, -3.8]
    return [{ v: [P3, P1, P2] }, { v: [P3, P2, P4] }, { v: [P1, P5, P2] }, { v: [P5, P6, P2] }] as Tri3[]
  })
}

const NECK: Ring[] = [
  { y: 6, rx: 4.6, rz: 5.0, cz: 0.6 }, { y: 0, rx: 4.8, rz: 5.2, cz: 0.5 }, { y: -3, rx: 5.2, rz: 5.5, cz: 0.2 }, { y: -6, rx: 6.4, rz: 6.0, cz: 0 },
]
const TORSO: Ring[] = [
  { y: -6, rx: 6.4, rz: 6.0, cz: 0 }, { y: -8.5, rx: 13, rz: 7.2, cz: -0.2 }, { y: -11.5, rx: 19.5, rz: 8.6, cz: -0.3 },
  { y: -17, rx: 18.8, rz: 9.4, cz: 0 }, { y: -26, rx: 16.5, rz: 9.6, cz: 0.2 }, { y: -33, rx: 15, rz: 9.2, cz: 0.2 },
]
// A sash across the chest and shallow vertical folds, as drapery.
const drape: Disp = (ri, i, [x, y, z]) => {
  const front = Math.cos((i / N) * Math.PI * 2)
  if (front < 0.1 || ri < 2) return [x, y, z]
  const ax = 14, ay = -11, bx = -13, by = -32
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy)
  const dist = Math.abs((x - ax) * dy - (y - ay) * dx) / len
  let push = dist < 5 ? 2.0 : 0
  if (ri >= 4) push += (i % 2 ? 0.5 : -0.4)
  return [x * (1 + push / 20), y, z + push]
}
const PLINTH: { r: Ring[] } = {
  r: [
    { y: -34.2, rx: 12, rz: 8, cz: 0 }, { y: -35, rx: 19, rz: 13.5, cz: 0 }, { y: -37.5, rx: 19, rz: 13.5, cz: 0 }, { y: -37.5, rx: 15, rz: 10.5, cz: 0 },
    { y: -50, rx: 15, rz: 10.5, cz: 0 }, { y: -50, rx: 19, rz: 13.5, cz: 0 }, { y: -53, rx: 19, rz: 13.5, cz: 0 },
  ],
}

const rot = ([x, y, z]: V3, yaw: number, pitch: number): V3 => {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return [x1, y * Math.cos(pitch) - z1 * Math.sin(pitch), y * Math.sin(pitch) + z1 * Math.cos(pitch)]
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const LIGHT = norm([-0.4, 0.68, 0.78])
const SHADOW = [112, 127, 154], LIT = [253, 253, 251]

// the head reads small on a bust, so it is built at 1.3x of the other parts
const bigHead = (g: Tri3[]): Tri3[] => g.map((t) => ({ v: t.v.map(([x, y, z]) => [x * 1.3, y * 1.3, z * 1.3]) as Tri3['v'] }))

export type Poly = { points: string; fill: string }

// groups are painted back to front; within a group triangles are depth sorted
export function bustPolys(cx: number, baseY: number, S: number): Poly[] {
  const yaw = -0.5, pitch = 0.05
  const groups: Tri3[][] = [
    loft(PLINTH.r, 4, undefined, Math.PI / 4, Math.SQRT2),
    loft(TORSO, N, drape),
    loft(NECK, N),
    ...[loft(HEAD, N, face), ears(), hair()].map(bigHead),
  ]
  const out: Poly[] = []
  for (const g of groups) {
    const drawn: { d: number; poly: Poly }[] = []
    for (const t of g) {
      const [a, b, c] = t.v
      let n = cross(sub(b, a), sub(c, a))
      const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      if (n[0] * mid[0] + n[2] * mid[2] < 0) n = [-n[0], -n[1], -n[2]] // point away from the vertical axis
      const nr = norm(rot(n, yaw, pitch))
      if (nr[2] <= 0.03) continue
      const lit = Math.max(0, nr[0] * LIGHT[0] + nr[1] * LIGHT[1] + nr[2] * LIGHT[2])
      const k = 0.1 + 0.9 * Math.pow(lit, 0.85)
      const fill = `rgb(${SHADOW.map((s, i) => Math.round(s + (LIT[i] - s) * k)).join(',')})`
      const pts = t.v.map((p) => { const r = rot(p, yaw, pitch); return `${(cx + r[0] * S).toFixed(1)},${(baseY - (r[1] + 53) * S).toFixed(1)}` }).join(' ')
      drawn.push({ d: rot(mid, yaw, pitch)[2], poly: { points: pts, fill } })
    }
    drawn.sort((p, q) => p.d - q.d)
    out.push(...drawn.map((x) => x.poly))
  }
  return out
}
