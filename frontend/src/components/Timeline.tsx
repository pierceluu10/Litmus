import { useStore } from '../store'

export function Timeline() {
  const { app, select } = useStore()
  const ds = app.session?.decisions ?? []
  return (
    <section aria-label="Your decisions" className="flex items-stretch gap-3 border-t border-rule bg-surface px-4 py-2">
      <h2 className="m-0 w-28 shrink-0 self-center font-serif text-[15px] font-semibold leading-tight">Where you steered</h2>
      {!ds.length && <p className="m-0 self-center text-muted">Your decisions will appear here, next to what the agent would have done alone.</p>}
      <ol className="m-0 flex min-w-0 flex-1 list-none gap-3 overflow-x-auto p-0">
        {ds.map((d) => (
          <li key={d.id} className="shrink-0">
            <button className="block max-w-[360px] rounded-md border bg-paper px-3 py-1.5 text-left" style={{ borderColor: d.changed_trajectory ? 'var(--color-human)' : 'var(--color-rule)' }} onClick={() => select(d.star_id)}>
              <span className="tag" style={{ color: d.changed_trajectory ? 'var(--color-human)' : 'var(--color-muted)' }}>{d.changed_trajectory ? 'changed course' : 'agreed'}</span>
              <span className="block truncate text-[12.5px]"><span className="text-muted">Agent: </span>{d.agent_recommendation}</span>
              <span className="block truncate text-[12.5px]"><span className="text-human">You: </span>{d.human_choice}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
