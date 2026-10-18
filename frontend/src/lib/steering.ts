import type { Claim, Decision, SessionState, Star } from '../types'

export type Moment = {
  decision: Decision
  yours: Star[]              // stars that exist because of this decision
  agents?: Star              // the agent's alternative, only when it also ran
  gap?: number               // your best graded star minus the agent's alternative (accuracy, 0-1)
}

const done = (s?: Star) => !!s?.grade && s.status === 'done'
const sameChanges = (a: object, b: object) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

// The stars a decision produced, matched the way the backend and the practice backend tag them.
function starsOf(s: SessionState, d: Decision): Star[] {
  const real = s.stars.filter((x) => x.chosen_by !== 'shadow' && x.parent_id)
  if (d.kind === 'dispatch') return real.filter((x) => x.proposal_id && d.human_choice_ids?.includes(x.proposal_id))
  if (d.kind === 'answer') {
    const q = s.questions.find((x) => x.star_id === d.star_id && x.answer?.option_id === d.human_choice_ids?.[0])
    return real.filter((x) => x.provenance.some((p) => p.kind === 'human' && (p.id === d.id || (q && p.id === `answer:${q.id}`))))
  }
  return real.filter((x) => x.parent_id === d.star_id && x.provenance.some((p) => p.kind === 'human' && p.id.startsWith(`feedback:${d.star_id}:`)))
}

// What the agent would have done instead, found among the stars only if it actually ran.
function agentsStar(s: SessionState, d: Decision): Star | undefined {
  const id = d.agent_recommendation_ids?.[0]
  if (!id) return undefined
  const byProposal = s.stars.find((x) => x.proposal_id === id && x.chosen_by !== 'human')
  if (byProposal) return byProposal
  const opt = s.questions.find((q) => q.star_id === d.star_id)?.options.find((o) => o.id === id)
  if (!opt?.knob_changes) return undefined
  return s.stars.find((x) => x.parent_id === (opt.parent_star_id ?? d.star_id) && x.chosen_by !== 'human' && sameChanges(x.knob_changes, opt.knob_changes!))
}

export function moments(s: SessionState): Moment[] {
  return s.decisions.map((decision) => {
    const yours = starsOf(s, decision)
    const agents = decision.changed_trajectory ? agentsStar(s, decision) : undefined
    const best = yours.filter(done).sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)[0]
    return { decision, yours, agents, gap: best && done(agents) ? best.grade!.mean_child - agents!.grade!.mean_child : undefined }
  }).filter((m) => m.decision.changed_trajectory || m.yours.length)
}

// Experiments that exist because of something the human wrote: a note on a highlight, an answer, an instruction.
export function humanStars(s: SessionState, claims: Claim[]): Star[] {
  const annotated = new Set(claims.filter((c) => c.annotation).map((c) => c.id))
  return s.stars.filter((x) => x.parent_id && x.chosen_by !== 'shadow'
    && x.provenance.some((p) => p.kind === 'note' || (p.kind === 'human' && p.id !== 'testbed') || (p.kind === 'highlight' && annotated.has(p.id.split('#')[0]))))
}
