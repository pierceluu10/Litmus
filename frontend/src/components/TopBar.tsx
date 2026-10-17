import { useStore } from '../store'

export function TopBar() {
  const { app, conn, generateAbstract, error, set, leave } = useStore()
  const s = app.session!
  const graded = s.stars.filter((x) => x.grade && x.grade.verdict !== 'baseline').length
  return (
    <header className="flex h-12 items-center gap-5 border-b border-rule bg-surface px-4">
      <button className="text-[15px] font-semibold tracking-[-0.02em]" aria-label="Litmus, back to the home page" onClick={leave}>Litmus</button>
      {conn === 'reconnecting' && <span className="text-waiting">Reconnecting…</span>}
      {error && <span role="alert" className="min-w-0 truncate text-refuted">{error}</span>}
      <div className="ml-auto flex items-center gap-4">
        {s.abstract && <button className="btn" onClick={() => set({ abstractOpen: true, selectedId: null })}>Read abstract</button>}
        <button className="btn btn-primary" disabled={!graded} onClick={generateAbstract}>
          {s.abstract ? 'Regenerate abstract' : 'Generate abstract'}
        </button>
      </div>
    </header>
  )
}
