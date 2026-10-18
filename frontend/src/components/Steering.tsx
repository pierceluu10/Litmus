import { useStore } from '../store'
import { agentName, pct, pts, starTone, toneVar } from '../lib/format'
import { humanStars, moments, type Moment } from '../lib/steering'

const KIND = { answer: 'Your answer', dispatch: 'Your pick', feedback: 'Your note' }

function Card({ m }: { m: Moment }) {
  const select = useStore((st) => st.select)
  const d = m.decision
  const ran = m.yours.filter((s) => s.grade)
  return (
    <li className="rounded-xl border border-rule p-3 text-[12.5px] leading-snug">
      <div className="flex items-baseline justify-between"><span className="text-[11.5px] font-medium text-human">{KIND[d.kind]}</span>{d.changed_trajectory && <span className="text-[11px] text-muted">changed the plan</span>}</div>
      <p className="m-0 mt-1 text-ink">{d.human_choice}</p>
      {d.changed_trajectory && d.agent_recommendation && <p className="m-0 mt-0.5 text-muted">The agent would have picked: {d.agent_recommendation}</p>}
      {ran.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {ran.map((s) => (
            <li key={s.id}>
              <button className="flex w-full items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-paper" onClick={() => select(s.id)}>
                <span className="min-w-0 truncate">{d.human_choice.includes(s.title) ? 'Result' : s.title || agentName(s)}</span>
                <span className="num shrink-0 text-[12px]" style={{ color: toneVar(starTone(s)) }}>{pct(s.grade!.mean_child)} · {pts(s.grade!.delta)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.gap !== undefined
        ? <p className="num m-0 mt-1.5 text-[12px] text-muted">Your path vs the agent's pick: <span style={{ color: toneVar(m.gap >= 0 ? 'confirmed' : 'refuted') }}>{pts(m.gap)} pts</span>. Both were run.</p>
        : d.changed_trajectory && d.agent_recommendation && <p className="m-0 mt-1.5 text-[12px] text-faint">The agent's pick wasn't run, so there is nothing to compare it with.</p>}
    </li>
  )
}

// Where the human's judgment changed the investigation, and what it led to.
export function Steering() {
  const s = useStore((st) => st.app.session!)
  const claims = useStore((st) => st.app.claims)
  const list = moments(s)
  const yours = humanStars(s, claims)
  const total = s.stars.filter((x) => x.parent_id && x.chosen_by !== 'shadow').length
  if (!list.length && !yours.length) return null
  const changed = list.filter((m) => m.decision.changed_trajectory).length
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between"><h3 className="m-0 text-[12px] font-semibold text-muted">Where you steered</h3></div>
      <p className="m-0 mb-2 text-[12.5px] text-muted">
        {yours.length} of {total} experiments came from your notes and choices{changed ? `, and ${changed} ${changed === 1 ? 'decision' : 'decisions'} changed the agent's plan` : ''}.
      </p>
      <ul className="m-0 list-none space-y-2 p-0">{list.map((m) => <Card key={m.decision.id} m={m} />)}</ul>
    </section>
  )
}
