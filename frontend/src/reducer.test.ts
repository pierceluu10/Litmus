import { describe, expect, it } from 'vitest'
import { applyEvent, initialState } from './reducer'
import type { LitmusEvent } from './types'

const ev = (seq: number, type: string, payload: any): LitmusEvent => ({ seq, ts: 't', session_id: 's', type, payload })
const star = { id: 'S1', parent_id: 'S0', depth: 1, title: 'x', status: 'queued', knob_changes: {}, runs: [], parent_runs: [] }

describe('applyEvent', () => {
  it('ignores duplicate seq', () => {
    const a = applyEvent(initialState, ev(1, 'session.started', { goal: 'g' }))
    expect(applyEvent(a, ev(1, 'session.started', { goal: 'other' })).session?.goal).toBe('g')
  })
  it('creates, progresses and grades a star', () => {
    let s = applyEvent(initialState, ev(1, 'star.created', { star }))
    s = applyEvent(s, ev(2, 'experiment.progress', { star_id: 'S1', seed: 0, epoch: 3, val_acc: 0.9 }))
    expect(s.session?.stars[0].status).toBe('running')
    s = applyEvent(s, ev(3, 'star.graded', { star_id: 'S1', grade: { verdict: 'confirmed', mean_child: 0.95, delta: 0.01 } }))
    expect(s.session?.stars[0]).toMatchObject({ status: 'done', grade: { verdict: 'confirmed', mean_child: 0.95, delta: 0.01 } })
    expect(s.lastSeq).toBe(3)
  })
  it('a question pauses only its own star', () => {
    let s = applyEvent(initialState, ev(1, 'star.created', { star }))
    s = applyEvent(s, ev(2, 'star.created', { star: { ...star, id: 'S2' } }))
    s = applyEvent(s, ev(3, 'question.asked', { question: { id: 'q', star_id: 'S1', options: [], evidence: [], status: 'open' } }))
    expect(s.session?.stars.map((x) => x.status)).toEqual(['waiting', 'queued'])
  })
  it('choosing from one agent’s card closes only that card', () => {
    const prop = (id: string, star_id: string) => ({ id, star_id, title: id, knob_changes: {}, provenance: [] })
    let s = applyEvent(initialState, ev(1, 'proposals.ready', { star_id: 'S1', proposals: [prop('P1', 'S1'), prop('P2', 'S1')] }))
    s = applyEvent(s, ev(2, 'proposals.ready', { star_id: 'S2', proposals: [prop('P3', 'S2')] }))
    s = applyEvent(s, ev(3, 'human.dispatched', { star_id: 'S1', selections: [{ proposal_id: 'P1' }], decision: { id: 'D1' } }))
    expect(s.session?.proposals.map((x) => [x.id, x.status])).toEqual([['P1', 'dispatched'], ['P2', 'skipped'], ['P3', 'open']])
  })
  it('records where the session starts', () => {
    expect(applyEvent(initialState, ev(1, 'start.chosen', { claim_ids: ['hl_a'] })).session?.start_claim_ids).toEqual(['hl_a'])
  })
  it('agents that share a name get A, B, C in start order', () => {
    let s = applyEvent(initialState, ev(1, 'star.created', { star: { ...star, knob_changes: { mixup_alpha: 1 } } }))
    expect(s.session?.stars[0].agent_label).toBeUndefined()
    s = applyEvent(s, ev(2, 'star.created', { star: { ...star, id: 'S2', knob_changes: { mixup_alpha: 0.2, epochs: 20 } } }))
    s = applyEvent(s, ev(3, 'star.created', { star: { ...star, id: 'S3', knob_changes: { tta_level: 0 } } }))
    expect(s.session?.stars.map((x) => x.agent_label)).toEqual(['Mixup agent A', 'Mixup agent B', undefined])
  })
  it('ignores unknown events', () => {
    expect(applyEvent(initialState, ev(1, 'future.thing', {})).lastSeq).toBe(1)
  })
})
