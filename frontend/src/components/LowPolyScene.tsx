import { motion, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import { thinkerPolys } from './thinkerRender'
// A low-poly temple: pediment, columns and a marble bust, all flat-shaded triangles.
// Generated from seeded jitter so it renders identically every time.
type P = [number, number]
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const LIGHT: P = [-0.55, -0.83]
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const SHADOW = [128, 143, 166], LIT = [255, 255, 255]
const shade = (t: number, tint = SHADOW) => { const [r, g, b] = mix(tint, LIT, Math.max(0, Math.min(1, t))); return `rgb(${r},${g},${b})` }

type Tri = { pts: [P, P, P]; fill: string }
const tri = (a: P, b: P, c: P, t: number, tint?: number[]): Tri => ({ pts: [a, b, c], fill: shade(t, tint) })

// light falls from the upper left: facets facing it are brighter
const facing = (c: P, center: P, r: () => number) => {
  const dx = c[0] - center[0], dy = c[1] - center[1], len = Math.hypot(dx, dy) || 1
  return 0.6 - (dx / len * LIGHT[0] + dy / len * LIGHT[1]) * 0.42 + (r() - 0.5) * 0.22
}

// a trapezoid cut into a jittered grid
function gridMesh(top: [number, number, number], bottom: [number, number, number], cols: number, rows: number, seed: number, tint?: number[]): Tri[] {
  const r = seeded(seed), out: Tri[] = []
  const pt = (c: number, rw: number): P => {
    const f = rw / rows, y = top[2] + (bottom[2] - top[2]) * f
    const x0 = top[0] + (bottom[0] - top[0]) * f, x1 = top[1] + (bottom[1] - top[1]) * f
    const edge = c === 0 || c === cols || rw === 0 || rw === rows
    return [x0 + ((x1 - x0) * c) / cols + (edge ? 0 : (r() - 0.5) * 8), y + (edge ? 0 : (r() - 0.5) * 8)]
  }
  const mid = (a: P, b: P, c: P): P => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]
  const cx = (top[0] + top[1]) / 2, cy = (top[2] + bottom[2]) / 2
  for (let rw = 0; rw < rows; rw++) for (let c = 0; c < cols; c++) {
    const a = pt(c, rw), b = pt(c + 1, rw), d = pt(c, rw + 1), e = pt(c + 1, rw + 1)
    out.push(tri(a, b, d, facing(mid(a, b, d), [cx, cy], r), tint), tri(b, e, d, facing(mid(b, e, d), [cx, cy], r) - 0.04, tint))
  }
  return out
}

function column(cx: number, top: number, bottom: number, w: number, seed: number, tint?: number[]): Tri[] {
  const r = seeded(seed), out: Tri[] = []
  const strips = 5, x0 = cx - w / 2
  const shaftTop = top + 26, shaftBottom = bottom - 22
  for (let i = 0; i < strips; i++) {
    const xa = x0 + (w * i) / strips, xb = x0 + (w * (i + 1)) / strips
    const t = 0.95 - (i / (strips - 1)) * 0.5 // left-lit strips
    const cut = shaftTop + (shaftBottom - shaftTop) * (0.35 + r() * 0.3)
    out.push(tri([xa, shaftTop], [xb, shaftTop], [xa, cut], t + 0.03, tint), tri([xb, shaftTop], [xb, cut], [xa, cut], t - 0.03, tint))
    out.push(tri([xa, cut], [xb, cut], [xa, shaftBottom], t - 0.02, tint), tri([xb, cut], [xb, shaftBottom], [xa, shaftBottom], t + 0.04, tint))
  }
  // capital: abacus slab + echinus
  const aw = w * 1.45
  out.push(tri([cx - aw / 2, top], [cx + aw / 2, top], [cx - aw / 2, top + 12], 0.95, tint), tri([cx + aw / 2, top], [cx + aw / 2, top + 12], [cx - aw / 2, top + 12], 0.7, tint))
  out.push(tri([cx - aw / 2 + 6, top + 12], [cx + aw / 2 - 6, top + 12], [x0, shaftTop], 0.8, tint), tri([cx + aw / 2 - 6, top + 12], [x0 + w, shaftTop], [x0, shaftTop], 0.6, tint))
  // base
  const bw = w * 1.35
  out.push(tri([x0, shaftBottom], [x0 + w, shaftBottom], [cx - bw / 2, bottom - 8], 0.7, tint), tri([x0 + w, shaftBottom], [cx + bw / 2, bottom - 8], [cx - bw / 2, bottom - 8], 0.55, tint))
  out.push(tri([cx - bw / 2, bottom - 8], [cx + bw / 2, bottom - 8], [cx - bw / 2, bottom], 0.85, tint), tri([cx + bw / 2, bottom - 8], [cx + bw / 2, bottom], [cx - bw / 2, bottom], 0.6, tint))
  return out
}

const AEGEAN = [112, 146, 188]
// The workspace's backdrop: irregular triangles on a staggered lattice, lit smoothly from the top left, so it reads as soft
// low-poly sky instead of a patchwork. Sized to its container (slice), so it stays quiet behind the statue and the graph.
const SKY_LIGHT = [248, 250, 253], SKY_DEEP = [196, 210, 232]
export function SceneBackdrop({ seed, className }: { seed: number; className?: string }) {
  const W = 1600, H = 1000, S = 200, ROW = S * 0.866
  const r = seeded(seed)
  const rows = Math.ceil(H / ROW) + 3, cols = Math.ceil(W / S) + 3
  const v: P[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => [
    (j - 1) * S + (i % 2 ? S / 2 : 0) + (r() - 0.5) * S * 0.5,
    (i - 1) * ROW + (r() - 0.5) * S * 0.45,
  ]))
  const tris: [P, P, P][] = []
  for (let i = 0; i < rows - 1; i++) for (let j = 1; j < cols - 1; j++) {
    if (i % 2 === 0) tris.push([v[i][j], v[i + 1][j - 1], v[i + 1][j]], [v[i][j], v[i][j + 1], v[i + 1][j]])
    else tris.push([v[i][j], v[i + 1][j], v[i + 1][j + 1]], [v[i][j], v[i][j + 1], v[i + 1][j + 1]])
  }
  return (
    <svg className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {tris.map((t, i) => {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3 / W, cy = (t[0][1] + t[1][1] + t[2][1]) / 3 / H
        const k = Math.max(0, Math.min(1, 0.95 - 0.5 * (0.55 * cx + 0.45 * cy) * 1.6 + (r() - 0.5) * 0.12))
        const fill = `rgb(${mix(SKY_DEEP, SKY_LIGHT, k).join(',')})`
        return <polygon key={i} points={t.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')} fill={fill} stroke={fill} strokeWidth={0.7} strokeLinejoin="round" />
      })}
    </svg>
  )
}

// As `exit` goes 0 → 1 the intro plays backwards and stops short: the roof lifts off, the columns sink, and the
// statue and sky settle into a faint backdrop instead of vanishing.
const RECEDED = 0.14, SKY_RECEDED = 0.55

export function LowPolyScene({ className, intro = false, exit }: { className?: string; intro?: boolean; exit?: MotionValue<number> }) {
  const still = useMotionValue(0)
  const e = exit ?? still
  const roof = { opacity: useTransform(e, [0, 0.45], [1, 0]), y: useTransform(e, [0, 0.45], [0, -44]) }
  const columns = { opacity: useTransform(e, [0.15, 0.65], [1, 0]), y: useTransform(e, [0.15, 0.65], [0, 34]) }
  const statueStyle = { opacity: useTransform(e, [0.3, 1], [1, RECEDED]) }
  const skyStyle = { opacity: useTransform(e, [0.4, 1], [1, SKY_RECEDED]) }
  const sky = gridMesh([-700, 1600, -500], [-700, 1600, 504], 16, 6, 91, [214, 226, 240])
  const floor = gridMesh([-700, 1600, 504], [-700, 1600, 1000], 16, 3, 92, [196, 208, 224])
  const behind = [...column(262, 150, 462, 40, 11, AEGEAN), ...column(638, 150, 462, 40, 12, AEGEAN)]
  const front = [...column(120, 92, 462, 62, 21), ...column(780, 92, 462, 62, 22)]
  const pediment: Tri[] = [
    tri([60, 90], [840, 90], [60, 62], 0.92), tri([840, 90], [840, 62], [60, 62], 0.66),
    tri([60, 62], [450, 8], [840, 62], 0.9), tri([60, 62], [450, 8], [255, 35], 0.78), tri([450, 8], [840, 62], [645, 35], 0.5), tri([255, 35], [450, 8], [450, 62], 0.98),
    tri([450, 8], [645, 35], [450, 62], 0.72),
  ]
  const steps: Tri[] = [
    tri([40, 462], [860, 462], [40, 482], 0.92), tri([860, 462], [860, 482], [40, 482], 0.66),
    tri([20, 482], [880, 482], [20, 504], 0.88), tri([880, 482], [880, 504], [20, 504], 0.58),
  ]
  const halo: Tri[] = Array.from({ length: 16 }, (_, i) => {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2
    return tri([450, 290], [450 + Math.cos(a0) * 175, 290 + Math.sin(a0) * 175], [450 + Math.cos(a1) * 175, 290 + Math.sin(a1) * 175], 0.62 + 0.22 * Math.cos(a0 - 3.9) * (i % 2 ? 1 : 0.7), [200, 214, 234])
  })
  const statue = thinkerPolys(450, 466, 2.5)
  const cen = (pts: number[][]) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  type Anim = [number, number] | null // [delay in s, start offset in px]
  // The intro assembles the scene: sky fades in from the middle, columns rise, the roof drops, the statue builds bottom to top.
  const layer = (tris: Tri[], key: string, when: (c: number[], i: number) => Anim) => tris.map((t, i) => {
    const a = intro ? when(cen(t.pts), i) : null
    return <polygon key={key + i} points={t.pts.map((p) => p.join(',')).join(' ')} fill={t.fill} stroke={t.fill} strokeWidth={0.6} strokeLinejoin="round"
      className={a ? 'intro-in' : undefined} style={a ? ({ animationDelay: `${a[0].toFixed(2)}s`, '--dy': `${a[1]}px` } as React.CSSProperties) : undefined} />
  })
  const rise = (c: number[]): Anim => [0.45 + ((462 - c[1]) / 372) * 0.6, 34]
  return (
    <svg viewBox="-240 -60 1380 700" className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label="A low-poly Greek temple with a metal statue of a seated thinker between two columns">
      <motion.g style={skyStyle}>
        {layer(sky, 'sky', (c) => [Math.abs(c[0] - 450) / 1500 * 0.8, 0])}
        {layer(floor, 'fl', (c) => [Math.abs(c[0] - 450) / 1500 * 0.8, 0])}
      </motion.g>
      <motion.g style={statueStyle}>{layer(halo, 'ha', (_, i) => [0.5 + i * 0.03, 0])}</motion.g>
      <motion.g style={columns}>
        {layer(behind, 'bc', rise)}
        {layer(front, 'fc', rise)}
        {layer(steps, 'st', (_, i) => [0.35 + i * 0.1, 18])}
      </motion.g>
      <motion.g style={roof}>{layer(pediment, 'pe', (c) => [1.15 + (c[0] / 900) * 0.3, -44])}</motion.g>
      <motion.g style={statueStyle}>
        {statue.map((p, i) => {
          const pts = p.points.split(' ').map((q) => q.split(',').map(Number))
          const a = intro ? [1.3 + ((466 - cen(pts)[1]) / 340) * 1.0 + (i % 7) * 0.012, 10] : null
          return <polygon key={`s${i}`} points={p.points} fill={p.fill} stroke={p.fill} strokeWidth={0.6} strokeLinejoin="round"
            className={a ? 'intro-in' : undefined} style={a ? ({ animationDelay: `${a[0].toFixed(2)}s`, '--dy': `${a[1]}px` } as React.CSSProperties) : undefined} />
        })}
      </motion.g>
    </svg>
  )
}
