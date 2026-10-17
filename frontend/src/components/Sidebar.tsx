import { useState } from 'react'
import { useStore } from '../store'
import { chosenLabel, chosenVar, ciText, effectText, knobText, pct, pts, starLetter, starTone, toneVar } from '../lib/format'
import type { Star } from '../types'
import { PathChart } from './PathChart'
import { ProvList } from './Prov'

const H = ({ children }: { children: React.ReactNode }) => <h3 className="m-0 mb-1.5 font-serif text-[14.5px] font-semibold">{children}</h3>

function Verdict({ s }: { s: Star }) {
  const g = s.grade
  if (!g) return <p className="m-0 text-muted">{s.status === 'running' ? 'Running. The verdict appears when all seeds finish.' : s.status === 'waiting' ? 'This branch is waiting for your answer.' : 'Not graded yet.'}</p>
  const color = toneVar(g.verdict)
  const crosses = g.ci_low <= 0 && g.ci_high >= 0
  return (
    <div className="rounded-md border bg-surface p-3" style={{ borderColor: color }}>
      <div className="flex items-baseline justify-between">
        <span className="tag" style={{ color }}>{g.verdict}</span>
        <span className="num text-[12px] text-muted">{g.n} seeds · {g.metric === 'tta_val_acc' ? 'accuracy with TTA' : 'accuracy'}</span>
      </div>
      <div className="mt-1 font-serif text-[26px] leading-tight num" style={{ color }}>{g.verdict === 'baseline' ? pct(g.mean_child, 2) : `${effectText(g)}`}</div>
      <div className="num text-[13px]">{g.verdict === 'baseline' ? `95% CI ${ciText(g)} pts around the mean` : `95% CI ${ciText(g)}`}</div>
      {g.verdict !== 'baseline' && (
        <p className="m-0 mt-1.5 text-[12.5px] text-muted">
          {crosses ? 'The interval includes zero, so this could be noise.' : 'The interval excludes zero.'}{' '}
          {g.practical ? 'Large enough to matter in practice.' : 'Smaller than a practical difference.'} p = {g.p_value.toFixed(3)}.
        </p>
      )}
    </div>
  )
}

function Runs({ s, parent }: { s: Star; parent?: Star }) {
  const seeds = [...new Set([...s.runs.map((r) => r.seed), ...(s.progress ?? []).map((p) => p.seed)])].sort((a, b) => a - b)
  if (!seeds.length) return <p className="m-0 text-muted">No runs yet.</p>
  const lat = (seed: number) => (s.progress ?? []).filter((p) => p.seed === seed).sort((a, b) => b.epoch - a.epoch)[0]
  const allAcc = [...s.runs.map((r) => r.val_acc), ...(s.parent_runs.map((r) => r.val_acc))]
  const lo = Math.min(...allAcc, 1), hi = Math.max(...allAcc, 0)
  const px = (v: number) => 8 + ((v - lo) / Math.max(hi - lo, 0.0005)) * 124
  return (
    <div>
      <table className="w-full border-collapse text-[12.5px] num">
        <thead><tr className="text-left text-muted"><th className="py-0.5 font-normal">Seed</th><th className="font-normal">Parent</th><th className="font-normal">This star</th><th className="text-right font-normal">Change</th></tr></thead>
        <tbody>
          {seeds.map((seed) => {
            const r = s.runs.find((x) => x.seed === seed), p = s.parent_runs.find((x) => x.seed === seed) ?? s.parent_runs[seed % Math.max(1, s.parent_runs.length)]
            const l = lat(seed)
            return (
              <tr key={seed} className="border-t border-rule">
                <td className="py-0.5">{seed + 1}</td>
                <td>{p ? pct(p.val_acc) : '–'}</td>
                <td style={{ color: r ? undefined : 'var(--color-running)' }}>{r ? pct(r.val_acc) : l ? `${pct(l.val_acc)} · ep ${l.epoch}` : '…'}</td>
                <td className="text-right">{r && p ? pts(r.val_acc - p.val_acc, 2) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {s.runs.length > 0 && s.parent_runs.length > 0 && (
        <svg viewBox="0 0 140 34" className="mt-2 w-full" role="img" aria-label="Per-seed accuracy, parent against this star">
          <line x1={4} x2={136} y1={17} y2={17} stroke="var(--color-rule)" />
          {s.parent_runs.map((r) => <circle key={`p${r.seed}`} cx={px(r.val_acc)} cy={11} r={3} fill="var(--color-muted)" opacity={0.7} />)}
          {s.runs.map((r) => <circle key={`c${r.seed}`} cx={px(r.val_acc)} cy={24} r={3} fill={toneVar(starTone(s))} />)}
        </svg>
      )}
      {parent && s.runs.length > 0 && <p className="m-0 mt-0.5 text-[11.5px] text-muted">Grey dots: {parent.title}. Coloured dots: this star.</p>}
    </div>
  )
}

function Actions({ s }: { s: Star }) {
  const { feedback, explain, explained, explainBusy, stopBranch } = useStore()
  const [mode, setMode] = useState<null | 'challenge' | 'suggest' | 'prioritize'>(null)
  const [text, setText] = useState('')
  const ex = explained[s.id]
  const submit = async () => { if (!mode || !text.trim()) return; await feedback(s.id, mode, text.trim()); setText(''); setMode(null) }
  const PH = { challenge: 'Why do you doubt this? e.g. “this looks like noise”', suggest: 'What should we test next from here?', prioritize: 'Why should this go first?' }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className={`btn ${mode === 'challenge' ? 'btn-human' : ''}`} onClick={() => setMode(mode === 'challenge' ? null : 'challenge')} disabled={s.status === 'running'}>Challenge</button>
        <button className={`btn ${mode === 'suggest' ? 'btn-human' : ''}`} onClick={() => setMode(mode === 'suggest' ? null : 'suggest')}>Suggest experiment</button>
        <button className={`btn ${mode === 'prioritize' ? 'btn-human' : ''}`} onClick={() => setMode(mode === 'prioritize' ? null : 'prioritize')}>Prioritize</button>
        <button className="btn" disabled={explainBusy} onClick={() => explain(s.id)}>{explainBusy ? 'Explaining…' : 'Explain this'}</button>
        {(s.status === 'running' || s.status === 'queued') && <button className="btn" onClick={() => stopBranch(s.id)}>Stop branch</button>}
      </div>
      {mode && (
        <div className="space-y-2">
          <label className="sr-only" htmlFor="fb">Your feedback</label>
          <textarea id="fb" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={PH[mode]}
            className="w-full resize-none rounded-md border border-rule bg-surface p-2" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />
          <button className="btn btn-human" disabled={!text.trim()} onClick={submit}>Send to the agent</button>
        </div>
      )}
      {ex && (
        <div className="rounded-md border border-rule bg-surface p-2.5 text-[13px] leading-snug">
          <p className="m-0 font-serif">{ex.answer}</p>
          {ex.provenance.length > 0 && <div className="mt-2"><ProvList items={ex.provenance} /></div>}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { app, selectedId } = useStore()
  const stars = app.session?.stars ?? []
  const s = stars.find((x) => x.id === selectedId)
  if (!s) return <aside className="p-4 text-muted">Select a star on the map to see its verdict, evidence and where it came from.</aside>
  const parent = stars.find((x) => x.id === s.parent_id)
  const replans = app.replans.filter((r) => r.star_id === s.id)
  return (
    <aside className="space-y-4 p-4" aria-label={`Details for ${s.title}`}>
      <div>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 font-serif text-[18px]" style={{ borderColor: toneVar(starTone(s)), color: toneVar(starTone(s)) }}>{starLetter(s.id)}</span>
          <h2 className="m-0 font-serif text-[18px] font-semibold leading-tight">{s.title}</h2>
        </div>
        <p className="m-0 mt-1.5 text-[13px]"><span className="tag" style={{ color: chosenVar(s.chosen_by) }}>{chosenLabel(s.chosen_by)}</span> · {s.knob_changes && Object.keys(s.knob_changes).length ? knobText(s.knob_changes) : 'reference configuration'}</p>
        <p className="m-0 mt-1.5 font-serif text-[14px] leading-snug">{s.hypothesis}</p>
      </div>
      <section><H>Verdict</H><Verdict s={s} /></section>
      <section><H>Accuracy along this path</H><PathChart stars={stars} selected={s} /></section>
      <section><H>Seeds</H><Runs s={s} parent={parent} /></section>
      {s.reflection && <section><H>What the agent makes of it</H><p className="m-0 font-serif text-[14px] leading-snug">{s.reflection}</p></section>}
      {replans.length > 0 && (
        <section><H>Because of you</H>
          {replans.map((r) => <p key={r.seq} className="m-0 text-[13px]"><span className="text-human">“{r.because}”</span> → {r.change}</p>)}
        </section>
      )}
      <section><H>Where this came from</H><ProvList items={s.provenance} /></section>
      <section><H>Your move</H><Actions s={s} key={s.id} /></section>
    </aside>
  )
}
