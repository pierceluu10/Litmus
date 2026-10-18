import type { Claim, Document, Knobs, Provenance, SessionState, Star } from '../types'

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
  // the setting this agent changed, written as a setting: "α = 1", "ε = 0", "20 epochs", "TTA off", "random flip"
  const parts = Object.entries(k).map(([key, v]) => key === 'epochs' ? `${v} epochs` : key === 'mixup_alpha' ? `α = ${v}` : key === 'label_smoothing' ? `ε = ${v}`
    : key === 'tta_level' ? (v === 0 ? 'TTA off' : `TTA level ${v}`) : key === 'flip' ? `${v} flip` : typeof v === 'boolean' ? `${KNOB_NAMES[key as keyof Knobs]} ${v ? 'on' : 'off'}`
    : `${KNOB_NAMES[key as keyof Knobs] ?? key} = ${v}`)
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

const SUMMARY_WORDS = 7
// A claim the backend could not summarize falls back to its opening words.
export const summarize = (c: Claim) => c.summary ?? c.text.split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') + '…'
// A claim's number: its place in the session's ranked library, so it stays the same wherever it is listed.
export const claimNumber = (claims: Claim[], id: string) => claims.findIndex((c) => c.id === id) + 1
// The claim a proposal or star is tied to (its first provenance that is one of the library's claims), with its number.
export function claimOf(claims: Claim[], provenance: Provenance[]): { claim: Claim; n: number } | null {
  for (const p of provenance) {
    const i = claims.findIndex((c) => provMatches(p, c.id))
    if (i >= 0) return { claim: claims[i], n: i + 1 }
  }
  return null
}

export type Tone = 'confirmed' | 'refuted' | 'inconclusive' | 'baseline' | 'running' | 'waiting'
export function starTone(s: Star): Tone {
  if (s.status === 'waiting') return 'waiting'
  if (s.status === 'running') return 'running'
  if (s.status === 'failed') return 'refuted'
  if (s.status === 'queued') return 'inconclusive'
  return s.grade?.verdict ?? 'inconclusive'
}
export const VERDICT_TEXT = { confirmed: 'Confirmed', refuted: 'Refuted', inconclusive: 'Inconclusive', baseline: 'Baseline' }
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

// The human answered this agent's question with an option that changes nothing ("Drop mixup"): its line is closed, so it
// offers no next steps. Mirrors `graph.dropped` on the backend.
export function dropped(session: SessionState | null, starId: string): boolean {
  const q = session?.questions.find((x) => x.star_id === starId && x.status === 'answered' && x.answer)
  const chosen = q?.options.find((o) => o.id === q.answer!.option_id)
  return !!chosen && !Object.keys(chosen.knob_changes ?? {}).length
}
