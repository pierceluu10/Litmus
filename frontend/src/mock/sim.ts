import type { Grade, Knobs, Predicted, RunResult } from '../types'

// Simulated airbench94 for the in-browser backend. Effects are calibrated from the real recorded session
// (shared/demo-session.json, Modal A100 runs, 2026-10-17); everything else follows backend/litmus/grader.py.

export const BASELINE_KNOBS: Knobs = { label_smoothing: 0.2, epochs: 9.9, tta_level: 2, flip: 'alternating', mixup_alpha: 0, cutout: 0, lr_scale: 1, whiten: true, dirac_init: true, translate: 2 }
export const BASELINE_ACC = 0.9401
export const GPU_SECONDS_PER_SEED_EPOCH = 4.2 / 9.9
export const PRACTICAL_THRESHOLD = 0.0005
export const EQUIVALENCE_MARGIN = 0.002
export const GRADER_VERSION = '1.0.0'

// Calibrated to the recorded spread: baseline sd ≈ 0.07 pts, paired-difference sd ≈ 0.1–0.2 pts (more with mixup).
const SEED_SD = 0.0004 // shared by every config at one seed, which is what pairing cancels
const RUN_SD = 0.0008
const MIXUP_NOISE = 1.5 // mixup makes individual runs noisier
const LONG_TRAINING_GAIN = 0.0084 // baseline at 30 epochs ≈ 94.78%
const EPOCH_SCALE = 9
const MIXUP_SCALE = 6

const afterBaseline = (epochs: number, scale: number) => 1 - Math.exp(-(epochs - BASELINE_KNOBS.epochs) / scale)

// Mean accuracy of a configuration (the expected tta_val_acc over seeds).
export function expectedAccuracy(k: Knobs): number {
  const longer = afterBaseline(k.epochs, MIXUP_SCALE)
  const a = k.mixup_alpha
  // measured: α=1 −1.44 and α=0.2 −0.26 at 9.9 epochs; α=0.2 +0.15 at 20 and +0.22 at 30 vs the same-epoch baseline
  const mixup = a === 0 ? 0 : (-0.0026 - (a - 0.2) * 0.0148) * (1 - longer) + (0.0024 - Math.max(0, a - 0.4) * 0.002) * longer
  const tta = ({ 0: -0.0075, 1: -0.0022, 2: 0 } as const)[k.tta_level]
  const flip = ({ alternating: 0, random: -0.0005, none: -0.0063 } as const)[k.flip]
  const smoothing = -0.0175 * (k.label_smoothing - 0.2) ** 2
  const cutout = (k.cutout / 8) * (-0.0008 + 0.0016 * afterBaseline(k.epochs, EPOCH_SCALE))
  const lr = -0.004 * Math.log2(k.lr_scale) ** 2
  const translate = -0.001 * (k.translate - 2) ** 2
  return BASELINE_ACC + LONG_TRAINING_GAIN * afterBaseline(k.epochs, EPOCH_SCALE) + mixup + tta + flip + smoothing + cutout + lr + translate
    + (k.whiten ? 0 : -0.0148) + (k.dirac_init ? 0 : -0.0054)
}

// FNV-1a plus murmur3's finalizer: without the avalanche, keys differing in one last character hash almost alike.
const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}
// Deterministic standard normal from a string (Box–Muller on two hashed uniforms).
const gauss = (key: string) => {
  const u = (hash(key) + 1) / 4294967297, v = (hash(`${key}~`) + 1) / 4294967297
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function simulateRun(k: Knobs, seed: number): RunResult {
  const acc = expectedAccuracy(k) + SEED_SD * gauss(`seed${seed}`) + RUN_SD * (1 + MIXUP_NOISE * k.mixup_alpha) * gauss(`${JSON.stringify(k)}#${seed}`)
  const tta = +acc.toFixed(4)
  return { seed, val_acc: +(acc - (k.tta_level ? 0.0021 : 0)).toFixed(4), tta_val_acc: tta, time_seconds: +(GPU_SECONDS_PER_SEED_EPOCH * k.epochs).toFixed(2) }
}

// Accuracy partway through training, for live epoch progress.
export const progressAccuracy = (final: number, fraction: number) => +(final - 0.34 * Math.exp(-3.4 * fraction)).toFixed(4)

// ---- the grader, ported from backend/litmus/grader.py ----

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }

// P(|T| <= t) for Student's t with df degrees of freedom: substitute x = √df·tanθ, so the density becomes cos^(df−1)θ.
function tCentralMass(t: number, df: number): number {
  const integral = (to: number) => {
    const steps = 400, h = to / steps
    let s = 0
    for (let i = 0; i <= steps; i++) s += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * Math.cos(i * h) ** (df - 1)
    return (s * h) / 3
  }
  return integral(Math.atan(Math.abs(t) / Math.sqrt(df))) / integral(Math.PI / 2)
}
const tQuantile975 = (df: number) => {
  let lo = 0, hi = 50
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (tCentralMass(mid, df) < 0.95) lo = mid; else hi = mid }
  return (lo + hi) / 2
}

export function verdict(predicted: Predicted, delta: number, low: number, high: number): Grade['verdict'] {
  if (predicted === 'improves') return low > 0 ? 'confirmed' : high < 0 ? 'refuted' : 'inconclusive'
  if (predicted === 'hurts') return high < 0 ? 'confirmed' : low > 0 ? 'refuted' : 'inconclusive'
  if (-EQUIVALENCE_MARGIN < low && high < EQUIVALENCE_MARGIN) return 'confirmed'
  return (low > 0 || high < 0) && Math.abs(delta) >= PRACTICAL_THRESHOLD ? 'refuted' : 'inconclusive'
}

export function grade(parent: number[], child: number[], predicted: Predicted): Grade {
  const diffs = child.map((c, i) => c - parent[i])
  const n = diffs.length, delta = mean(diffs), se = sd(diffs) / Math.sqrt(n), t = tQuantile975(n - 1)
  const ci_low = delta - t * se, ci_high = delta + t * se
  return {
    metric: 'tta_val_acc', mean_parent: mean(parent), mean_child: mean(child), delta, sd_parent: sd(parent), sd_child: sd(child), n,
    ci_low, ci_high, p_value: se ? 1 - tCentralMass(delta / se, n - 1) : 0, verdict: verdict(predicted, delta, ci_low, ci_high),
    practical: Math.abs(delta) >= PRACTICAL_THRESHOLD, grader_version: GRADER_VERSION,
  }
}

export function baselineGrade(runs: number[]): Grade {
  const m = mean(runs), s = sd(runs), half = tQuantile975(runs.length - 1) * s / Math.sqrt(runs.length)
  return { metric: 'tta_val_acc', mean_parent: m, mean_child: m, delta: 0, sd_parent: s, sd_child: s, n: runs.length, ci_low: m - half, ci_high: m + half, p_value: 1, verdict: 'baseline', practical: false, grader_version: GRADER_VERSION }
}
