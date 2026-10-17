import { useState } from 'react'

const tones: [string, string][] = [
  ['confirmed', 'Confirmed'], ['refuted', 'Refuted'], ['inconclusive', 'Inconclusive'], ['baseline', 'Baseline'], ['running', 'Running'], ['waiting', 'Waiting for you'],
]
const lines: [string, string, boolean?][] = [
  ['human', 'You chose'], ['agent', 'Agent chose'], ['inconclusive', 'Agent alone (ghost)', true],
]
export function Legend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="absolute left-3 top-3">
      <button className="btn text-[12.5px]" aria-expanded={open} onClick={() => setOpen(!open)}>Key</button>
      {open && (
        <div className="mt-1 rounded-md border border-rule bg-surface px-3 py-2 text-[12px] text-muted">
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0">
            {tones.map(([t, l]) => (
              <li key={t} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--color-${t})` }} />{l}</li>
            ))}
          </ul>
          <ul className="m-0 mt-2 list-none space-y-1 border-t border-rule p-0 pt-2">
            {lines.map(([t, l, dashed]) => (
              <li key={l} className="flex items-center gap-2">
                <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke={`var(--color-${t})`} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} /></svg>{l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
