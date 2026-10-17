import { api, useStore } from '../store'
import type { SessionStatus } from '../types'

const STATUS: Record<SessionStatus, { label: string; color: string }> = {
  running: { label: 'Running', color: 'var(--color-running)' },
  paused: { label: 'Paused', color: 'var(--color-muted)' },
  waiting_human: { label: 'Waiting for you', color: 'var(--color-waiting)' },
  done: { label: 'Done', color: 'var(--color-confirmed)' },
}

export function TopBar() {
  const { app, conn, togglePause, begin, set, error } = useStore()
  const s = app.session
  const st = s ? STATUS[s.status] : null
  const used = s?.budget_used ?? 0, total = s?.budget_total ?? 0
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule bg-surface px-4 py-2.5">
      <h1 className="m-0 font-serif text-[22px] font-semibold leading-none">Litmus</h1>
      <p className="m-0 min-w-0 flex-1 truncate text-muted" title={s?.goal}>{s?.goal ?? 'No session yet'}</p>
      {error && <span role="alert" className="rounded-md border border-refuted px-2 py-0.5 text-refuted">{error}</span>}
      {api.mock && <span className="chip" title="The backend is simulated in your browser">Mock data</span>}
      {s?.replay && <span className="chip" style={{ color: 'var(--color-human)' }}>Replay</span>}
      {conn !== 'live' && s && <span className="chip" style={{ color: 'var(--color-waiting)' }}>{conn === 'closed' ? 'Disconnected' : 'Reconnecting…'}</span>}
      {total > 0 && (
        <div className="flex items-center gap-2" title="GPU seconds used of the session budget">
          <span className="text-muted">GPU</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-rule" role="meter" aria-valuenow={used} aria-valuemax={total} aria-label="GPU budget used">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (used / total) * 100)}%`, background: used / total > 0.9 ? 'var(--color-refuted)' : 'var(--color-baseline)', transition: 'width 400ms var(--ease-out)' }} />
          </div>
          <span className="num text-muted">{used}/{total}s</span>
        </div>
      )}
      {st && (
        <span className="inline-flex items-center gap-2 rounded-full border border-rule px-3 py-1" aria-live="polite">
          <span className="h-2 w-2 rounded-full" style={{ background: st.color, animation: s!.status === 'running' || s!.status === 'waiting_human' ? 'breathe 2s ease-in-out infinite' : undefined }} />
          {st.label}
        </span>
      )}
      {s && s.status !== 'done' && <button className="btn" onClick={togglePause}>{s.status === 'paused' ? 'Resume' : 'Pause'}</button>}
      {s?.abstract && <button className="btn btn-primary" onClick={() => set({ abstractOpen: true })}>Abstract</button>}
      {s && <button className="btn" onClick={() => begin(true)}>Replay demo</button>}
    </header>
  )
}
