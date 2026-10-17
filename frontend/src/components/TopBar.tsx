import { useStore } from '../store'

export function TopBar() {
  const { app, conn, togglePause, generateAbstract, error, set, leave } = useStore()
  const s = app.session!
  const graded = s.stars.filter((x) => x.grade && x.grade.verdict !== 'baseline').length
  const share = s.budget_total ? Math.min(1, s.budget_used / s.budget_total) : 0
  return (
    <header className="flex h-12 items-center gap-5 border-b border-rule bg-surface px-4">
      <button className="text-[15px] font-semibold tracking-[-0.02em]" aria-label="Litmus, back to the home page" onClick={leave}>Litmus</button>
      {conn === 'reconnecting' && <span className="text-waiting">Reconnecting…</span>}
      {error && <span role="alert" className="min-w-0 truncate text-refuted">{error}</span>}
      <div className="ml-auto flex items-center gap-4">
        {s.budget_total > 0 && (
          <div className="flex items-center gap-2 text-muted" title="GPU seconds used of this session's budget">
            <span>GPU</span>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-rule" role="meter" aria-label="GPU budget used" aria-valuenow={s.budget_used} aria-valuemin={0} aria-valuemax={s.budget_total}>
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${share * 100}%`, background: share > 0.9 ? 'var(--color-refuted)' : 'var(--color-ink)' }} />
            </div>
            <span className="num text-[12px]">{Math.round(s.budget_used)}/{s.budget_total}s</span>
          </div>
        )}
        {s.status !== 'done' && <button className="btn btn-quiet" onClick={togglePause}>{s.status === 'paused' ? 'Resume' : 'Pause'}</button>}
        {s.abstract && <button className="btn" onClick={() => set({ abstractOpen: true, selectedId: null })}>Read abstract</button>}
        <button className="btn btn-primary" disabled={!graded} onClick={generateAbstract}>
          {s.abstract ? 'Regenerate abstract' : 'Generate abstract'}
        </button>
      </div>
    </header>
  )
}
