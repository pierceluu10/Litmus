import { describe, expect, it } from 'vitest'
import { humanStars, moments } from './steering'
import type { SessionState, Star } from '../types'

const grade = (mean_child: number) => ({ mean_child, mean_parent: 0.94, delta: mean_child - 0.94, verdict: 'confirmed' }) as Star['grade']
const star = (o: Partial<Star>): Star => ({ id: 'S1', parent_id: 'S0', depth: 1, title: 't', knob_changes: {}, provenance: [], chosen_by: 'human', status: 'done', runs: [], parent_runs: [], ...o }) as Star
const session = (o: Partial<SessionState>): SessionState => ({ id: 's', stars: [], proposals: [], questions: [], decisions: [], ...o }) as SessionState

describe('moments', () => {
  it('links a dispatch to the stars it created and compares with the agent pick when it also ran', () => {
    const s = session({
      decisions: [{ id: 'd', star_id: 'S0', kind: 'dispatch', agent_recommendation: 'A', human_choice: 'B', agent_recommendation_ids: ['pa'], human_choice_ids: ['pb'], changed_trajectory: true } as any],
      stars: [star({ id: 'S1', proposal_id: 'pb', grade: grade(0.95) }), star({ id: 'S2', proposal_id: 'pa', chosen_by: 'auto', grade: grade(0.94) })],
    })
    const [m] = moments(s)
    expect(m.yours.map((x) => x.id)).toEqual(['S1'])
    expect(m.gap).toBeCloseTo(0.01)
  })
  it('has no gap when the agent pick never ran', () => {
    const s = session({
      decisions: [{ id: 'd', star_id: 'S0', kind: 'dispatch', agent_recommendation: 'A', human_choice: 'B', agent_recommendation_ids: ['pa'], human_choice_ids: ['pb'], changed_trajectory: true } as any],
      stars: [star({ proposal_id: 'pb', grade: grade(0.95) })],
    })
    expect(moments(s)[0].gap).toBeUndefined()
  })
  it('links an answer through the question id on the star provenance', () => {
    const s = session({
      questions: [{ id: 'q1', star_id: 'S0', options: [], answer: { option_id: 'O2' } } as any],
      decisions: [{ id: 'd', star_id: 'S0', kind: 'answer', agent_recommendation: 'A', human_choice: 'B', human_choice_ids: ['O2'], changed_trajectory: true } as any],
      stars: [star({ provenance: [{ kind: 'human', id: 'answer:q1', text: 'x' }] })],
    })
    expect(moments(s)[0].yours).toHaveLength(1)
  })
  it('counts stars from human notes and ignores shadows', () => {
    const s = session({ stars: [star({ provenance: [{ kind: 'human', id: 'answer:q', text: 'x' }] }), star({ id: 'S2', provenance: [{ kind: 'human', id: 'answer:q', text: 'x' }], chosen_by: 'shadow' }), star({ id: 'S3', provenance: [] })] })
    expect(humanStars(s, []).map((x) => x.id)).toEqual(['S1'])
  })
})
