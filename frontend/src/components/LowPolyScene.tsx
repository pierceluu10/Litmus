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

function ellipseMesh(cx: number, cy: number, rx: number, ry: number, seed: number, tint?: number[], segs = 12, rings = 3): Tri[] {
  const r = seeded(seed), out: Tri[] = []
  const ring = (k: number): P[] => Array.from({ length: segs }, (_, i) => {
    const a = (i / segs) * Math.PI * 2, f = k / rings, j = k === rings ? 1 : 0.85 + r() * 0.3
    return [cx + Math.cos(a) * rx * f * j, cy + Math.sin(a) * ry * f * j] as P
  })
  let prev = ring(1)
  const center: P = [cx - rx * 0.05, cy - ry * 0.05]
  for (let i = 0; i < segs; i++) out.push(tri(center, prev[i], prev[(i + 1) % segs], facing([(prev[i][0] + prev[(i + 1) % segs][0]) / 2, (prev[i][1] + prev[(i + 1) % segs][1]) / 2], [cx, cy], r), tint))
  for (let k = 2; k <= rings; k++) {
    const cur = ring(k)
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs
      const c1: P = [(prev[i][0] + cur[i][0] + cur[j][0]) / 3, (prev[i][1] + cur[i][1] + cur[j][1]) / 3]
      const c2: P = [(prev[i][0] + prev[j][0] + cur[j][0]) / 3, (prev[i][1] + prev[j][1] + cur[j][1]) / 3]
      out.push(tri(prev[i], cur[i], cur[j], facing(c1, [cx, cy], r), tint), tri(prev[i], cur[j], prev[j], facing(c2, [cx, cy], r), tint))
    }
    prev = cur
  }
  return out
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
export function LowPolyScene({ className }: { className?: string }) {
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
  const halo = ellipseMesh(450, 270, 190, 190, 5, [176, 196, 222], 14, 3)
  const hair = ellipseMesh(450, 168, 62, 52, 31, [96, 108, 130], 12, 2)
  const pedestal = gridMesh([380, 520, 430], [370, 530, 462], 4, 2, 41)
  const chest = gridMesh([376, 524, 318], [326, 574, 430], 5, 3, 51)
  const neck = gridMesh([428, 472, 262], [424, 476, 326], 2, 2, 61)
  const head = ellipseMesh(450, 214, 49, 64, 71, undefined, 12, 3)
  const face: Tri[] = [
    tri([450, 196], [441, 238], [459, 238], 0.5), tri([450, 196], [459, 238], [452, 200], 0.9),
    tri([424, 196], [440, 192], [436, 204], 0.4), tri([476, 196], [460, 192], [464, 204], 0.55),
  ]
  const all = [...halo, ...behind, ...pediment, ...front, ...steps, ...pedestal, ...chest, ...neck, ...hair, ...head, ...face]
  return (
    <svg viewBox="0 0 900 512" className={className} role="img" aria-label="A low-poly Greek temple with a marble bust between two columns" shapeRendering="geometricPrecision">
      {all.map((t, i) => (
        <polygon key={i} points={t.pts.map((p) => p.join(',')).join(' ')} fill={t.fill} stroke={t.fill} strokeWidth={0.6} strokeLinejoin="round" />
      ))}
    </svg>
  )
}
