import type { Document, Grade, Knobs, Provenance, Star } from '../types'

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω']
export const starLetter = (id: string) => GREEK[Number(id.replace(/\D/g, '')) % GREEK.length] ?? '•'

export const pts = (x: number, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}`
export const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`
export const effectText = (g: Grade) => g.verdict === 'baseline' ? pct(g.mean_child, 1) : `${pts(g.delta)} pts`
export const ciText = (g: Grade) => `[${(g.ci_low * 100).toFixed(2)}, ${(g.ci_high * 100).toFixed(2)}]`

const KNOB_NAMES: Record<keyof Knobs, string> = {
  label_smoothing: 'label smoothing', epochs: 'epochs', tta_level: 'TTA level', flip: 'flip', mixup_alpha: 'mixup α',
  cutout: 'cutout', lr_scale: 'LR ×', whiten: 'whitening', dirac_init: 'identity init', translate: 'translate',
}
export function knobText(changes: Partial<Knobs>): string {
  const parts = Object.entries(changes).map(([k, v]) => {
    if (k === 'tta_level') return v === 0 ? 'TTA off' : `TTA level ${v}`
    if (k === 'flip') return `${v} flip`
    if (typeof v === 'boolean') return `${KNOB_NAMES[k as keyof Knobs]} ${v ? 'on' : 'off'}`
    return `${KNOB_NAMES[k as keyof Knobs] ?? k} ${v}`
  })
  return parts.join(', ') || 'no change'
}

export function provLabel(p: Provenance, docs: Document[]): string {
  const doc = docs.find((d) => d.id === p.doc_id)
  const who = doc?.authors[0]?.split(' ').slice(-1)[0] ?? ''
  const what = p.kind === 'note' ? 'your note' : p.kind === 'human' ? 'your decision' : p.kind === 'search' ? 'library search' : p.kind
  return who ? `${what} · ${who}${doc && doc.authors.length > 1 ? ' et al.' : ''}` : what
}
export const provMatches = (p: Provenance, claimId: string) => p.id === claimId || p.id.startsWith(`${claimId}#`)

export type Tone = 'confirmed' | 'refuted' | 'inconclusive' | 'baseline' | 'running' | 'waiting'
export function starTone(s: Star): Tone {
  if (s.status === 'waiting') return 'waiting'
  if (s.status === 'running') return 'running'
  if (s.status === 'failed') return 'refuted'
  if (s.status === 'queued') return 'inconclusive'
  return s.grade?.verdict ?? 'inconclusive'
}
export const toneVar = (t: Tone) => `var(--color-${t})`
export const chosenVar = (c: Star['chosen_by']) => c === 'human' ? 'var(--color-human)' : c === 'shadow' ? 'var(--color-inconclusive)' : c === 'agent' ? 'var(--color-agent)' : 'var(--color-muted)'
export const chosenLabel = (c: Star['chosen_by']) => ({ human: 'Chosen by you', agent: 'Agent recommended, you agreed', auto: 'Automatic', shadow: 'Agent alone (shadow run)' })[c]

export function progressFraction(s: Star): number {
  const seeds = Math.max(5, new Set((s.progress ?? []).map((p) => p.seed)).size)
  const latest = new Map<number, number>()
  for (const p of s.progress ?? []) latest.set(p.seed, Math.max(latest.get(p.seed) ?? 0, p.epoch))
  const done = new Set(s.runs.map((r) => r.seed))
  let sum = s.runs.length
  latest.forEach((ep, seed) => { if (!done.has(seed)) sum += Math.min(1, ep / s.knobs.epochs) })
  return Math.min(1, sum / seeds)
}
