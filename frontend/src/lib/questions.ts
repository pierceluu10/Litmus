import type { SessionState } from '../types'
import { agentName } from './format'

// What you would most likely ask Litmus right now, read off the state of the research (instead of Litmus narrating every
// step): the agent you have open first, then whatever is waiting on you, then the research as a whole.
export function commonQuestions(session: SessionState | null, selectedId: string | null): string[] {
  if (!session) return []
  const stars = session.stars.filter((s) => s.parent_id)
  const open = stars.find((s) => s.id === selectedId)
  if (open) {
    const name = agentName(open)
    if (!open.grade) return [`What is ${name} testing?`, `Why test this claim?`, `What would change your mind about it?`]
    const verdict = open.grade.verdict
    return [
      verdict === 'refuted' ? `Why did ${name} go against the paper?` : verdict === 'confirmed' ? `Why did ${name} hold up?` : `Why is ${name} inconclusive?`,
      `How sure are we about ${name}?`,
      `Where should ${name} go next?`,
    ]
  }
  if (session.questions.some((q) => q.status === 'open')) return ['What is the question asking me?', 'Which option would you pick?', 'What does each option cost?']
  if (session.status === 'done' || session.abstract) return ['Summarize what we found', 'Which finding is the strongest?', 'What would you test with more time?']
  const graded = stars.filter((s) => s.grade)
  if (!graded.length) return stars.length ? ['What are the agents testing?', 'Why start with this claim?', 'How long will this take?'] : []
  const refuted = graded.find((s) => s.grade!.verdict === 'refuted')
  return [
    'What have we learned so far?',
    refuted ? `Why did ${agentName(refuted)} go against the paper?` : 'Which result is most solid?',
    'What should we test next?',
  ]
}
