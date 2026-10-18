import { describe, expect, it } from 'vitest'
import { commonQuestions } from './questions'
import type { SessionState, Star } from '../types'

const star = (o: Partial<Star>): Star => ({ id: 'S1', parent_id: 'S0', depth: 1, title: 't', knobs: {}, knob_changes: { mixup_alpha: 1 }, provenance: [], chosen_by: 'human', status: 'done', runs: [], parent_runs: [], ...o }) as Star
const base = star({ id: 'S0', parent_id: null, depth: 0, knob_changes: {} })
const session = (o: Partial<SessionState>): SessionState => ({ id: 's', status: 'running', stars: [base], proposals: [], questions: [], decisions: [], ...o }) as SessionState
const refuted = { verdict: 'refuted', delta: -0.0144 } as Star['grade']

describe('commonQuestions', () => {
  it('asks nothing before any agent exists', () => {
    expect(commonQuestions(session({}), null)).toEqual([])
  })
  it('asks about what is running before anything is graded', () => {
    expect(commonQuestions(session({ stars: [base, star({ status: 'running' })] }), null)[0]).toBe('What are the agents testing?')
  })
  it('names the refuted agent once results are in', () => {
    const qs = commonQuestions(session({ stars: [base, star({ grade: refuted })] }), null)
    expect(qs).toHaveLength(3)
    expect(qs[1]).toMatch(/^Why did Mixup agent go against the paper\?$/)
  })
  it('puts an open question first, and the agent you have open before everything', () => {
    const s = session({ stars: [base, star({ grade: refuted })], questions: [{ id: 'q', status: 'open' } as SessionState['questions'][number]] })
    expect(commonQuestions(s, null)[0]).toBe('What is the question asking me?')
    expect(commonQuestions(s, 'S1')[0]).toBe('Why did Mixup agent go against the paper?')
  })
  it('wraps up when the session is done', () => {
    expect(commonQuestions(session({ status: 'done', stars: [base, star({ grade: refuted })] }), null)[0]).toBe('Summarize what we found')
  })
})
