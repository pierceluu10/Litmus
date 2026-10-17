import type { Document, Knobs, Provenance, Star } from '../types'

export const pts = (x: number, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}`
export const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`

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

const AGENT_NAMES: Record<keyof Knobs, string> = {
  label_smoothing: 'Smoothing', epochs: 'Long training', tta_level: 'TTA', flip: 'Flip', mixup_alpha: 'Mixup',
  cutout: 'Cutout', lr_scale: 'Learning rate', whiten: 'Whitening', dirac_init: 'Identity init', translate: 'Translate',
}
// The name shown under a star: the method it tests. Agents sharing one get A, B, C… (agent_label, set by the reducer).
function baseName(s: Star): string {
  if (!s.parent_id) return 'Baseline'
  const method = (Object.keys(s.knob_changes) as (keyof Knobs)[]).find((k) => k !== 'epochs')
  return `${AGENT_NAMES[method ?? 'epochs']} agent`
}
export const agentName = (s: Star): string => s.agent_label ?? baseName(s)
// Letters in the order the agents started, mirroring the backend's agent_name.
export function labelAgents(stars: Star[]): Star[] {
  const groups = new Map<string, string[]>()
  for (const s of stars) if (s.parent_id) groups.set(baseName(s), [...(groups.get(baseName(s)) ?? []), s.id])
  return stars.map((s) => {
    const same = groups.get(baseName(s)) ?? []
    return { ...s, agent_label: same.length > 1 ? `${baseName(s)} ${String.fromCharCode(65 + same.indexOf(s.id))}` : undefined }
  })
}
export function agentDetail(s: Star): string {
  const k = s.knob_changes
  const parts = Object.entries(k).map(([key, v]) => key === 'epochs' ? `${v} ep` : key === 'mixup_alpha' ? `α ${v}` : key === 'tta_level' ? (v === 0 ? 'off' : `level ${v}`)
    : key === 'flip' ? String(v) : typeof v === 'boolean' ? (v ? 'on' : 'off') : key === 'label_smoothing' ? `ε ${v}` : String(v))
  return parts.join(' · ')
}

// "Zhang '17" for a document.
export function shortCite(d: Document | undefined): string {
  if (!d) return ''
  const last = d.authors[0]?.split(' ').slice(-1)[0] ?? d.title
  return `${last}${d.authors.length > 1 ? ' et al.' : ''}${d.year ? ` ’${String(d.year).slice(2)}` : ''}`
}

export function provLabel(p: Provenance, docs: Document[]): string {
  const doc = docs.find((d) => d.id === p.doc_id)
  const who = doc?.authors[0]?.split(' ').slice(-1)[0] ?? ''
  const what = p.kind === 'note' ? 'Your note on' : p.kind === 'human' ? 'Your decision' : p.kind === 'search' ? 'Library search' : `${p.kind[0].toUpperCase()}${p.kind.slice(1)} from`
  return who ? `${what} ${who}${doc && doc.authors.length > 1 ? ' et al.' : ''}` : what.replace(/ (from|on)$/, '')
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

export function progressFraction(s: Star): number {
  const seeds = Math.max(5, new Set((s.progress ?? []).map((p) => p.seed)).size)
  const latest = new Map<number, number>()
  for (const p of s.progress ?? []) latest.set(p.seed, Math.max(latest.get(p.seed) ?? 0, p.epoch))
  const done = new Set(s.runs.map((r) => r.seed))
  let sum = s.runs.length
  latest.forEach((ep, seed) => { if (!done.has(seed)) sum += Math.min(1, ep / s.knobs.epochs) })
  return Math.min(1, sum / seeds)
}
