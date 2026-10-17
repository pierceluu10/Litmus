import { Fragment, useState } from 'react'
import { motion } from 'motion/react'
import { sessionApi, useStore } from '../store'
import { agentDetail, agentName, pct, progressFraction, pts, starTone, toneVar } from '../lib/format'
import type { Provenance, Star } from '../types'
import { PathChart } from './PathChart'
import { ProvChip } from './Prov'

const H = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-2 flex items-baseline justify-between"><h3 className="m-0 text-[12px] font-semibold text-muted">{children}</h3>{aside}</div>
)
const VERDICT_TEXT = { confirmed: 'Confirmed', refuted: 'Refuted', inconclusive: 'Inconclusive', baseline: 'Baseline' }

// ---------------------------------------------------------------- overview

function Overview() {
  const { app, select } = useStore()
  const s = app.session!
  const graded = s.stars.filter((x) => x.grade && x.grade.verdict !== 'baseline' && x.status !== 'failed')
  const ranked = s.stars.filter((x) => x.grade && x.status !== 'failed').sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)
  const count = (v: string) => graded.filter((x) => x.grade!.verdict === v).length
  const steered = s.decisions.filter((d) => d.kind === 'answer' && d.changed_trajectory)
  return (
    <div className="space-y-6 p-4">
      <section>
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Results</h2>
        {graded.length > 0 && (
          <p className="m-0 mt-0.5 text-muted">
            {graded.length} graded · <span style={{ color: toneVar('confirmed') }}>{count('confirmed')} confirmed</span> · <span style={{ color: toneVar('refuted') }}>{count('refuted')} refuted</span> · {count('inconclusive')} inconclusive
          </p>
        )}
      </section>
      <section><H>Accuracy by path</H><div className="plate px-3 pb-1.5 pt-2.5"><PathChart stars={s.stars} highlight={null} /></div></section>
      {ranked.length > 0 && (
        <section>
          <H>Rankings</H>
          <ol className="plate m-0 list-none p-1">
            {ranked.map((x, i) => (
              <li key={x.id}>
                <button className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-paper" onClick={() => select(x.id)}>
                  <span className="num w-4 text-[11px] text-faint">{i + 1}</span>
                  <span className="dot" style={{ background: toneVar(starTone(x)) }} />
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{agentName(x)}</span> <span className="num text-[11px] text-faint">{agentDetail(x)}</span></span>
                  <span className="num text-[12px]">{pct(x.grade!.mean_child)}</span>
                  <span className="num w-12 text-right text-[11.5px]" style={{ color: toneVar(starTone(x)) }}>{x.grade!.verdict === 'baseline' ? '' : pts(x.grade!.delta)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {steered.length > 0 && (
        <section>
          <H>Where you changed course</H>
          <ul className="m-0 list-none space-y-2 p-0">
            {steered.map((d) => (
              <li key={d.id}>
                <button className="block w-full rounded-md border border-rule px-3 py-2 text-left text-[12.5px] leading-snug hover:border-faint" onClick={() => select(d.star_id)}>
                  <span className="block text-human">You: {d.human_choice}</span>
                  <span className="block text-muted">Agent: {d.agent_recommendation || 'nothing'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Activity />
    </div>
  )
}

function Activity() {
  const { app, select } = useStore()
  const [open, setOpen] = useState(false)
  if (!app.feed.length) return null
  return (
    <section>
      <button className="flex w-full items-baseline justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h3 className="m-0 text-[12px] font-semibold text-muted">Agent log</h3><span className="label">{open ? 'hide' : `${app.feed.length} ${app.feed.length === 1 ? 'entry' : 'entries'}`}</span>
      </button>
      {open && (
        <ol className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12.5px] leading-snug" aria-live="polite">
          {app.feed.slice().reverse().map((f) => (
            <li key={f.seq}>
              <button className="text-left text-muted hover:text-ink disabled:opacity-100" disabled={!f.star_id} onClick={() => f.star_id && select(f.star_id)}>
                {f.kind === 'search' ? `Searched your library: ${f.text}` : f.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- one agent

function Verdict({ s }: { s: Star }) {
  const g = s.grade
  if (s.status === 'running' || s.status === 'queued') {
    const latest = (s.progress ?? []).reduce<{ epoch: number; val_acc: number } | null>((m, p) => (!m || p.epoch > m.epoch ? p : m), null)
    const f = progressFraction(s)
    return (
      <div className="rounded-xl border border-rule p-3.5">
        <div className="flex items-baseline justify-between"><span className="text-[12px] font-medium" style={{ color: toneVar('running') }}>Training</span><span className="num text-[11.5px] text-muted">{latest ? `epoch ${latest.epoch}/${s.knobs.epochs} · ${pct(latest.val_acc)}` : 'starting'}</span></div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-rule"><div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${f * 100}%`, background: toneVar('running') }} /></div>
        <p className="m-0 mt-2 text-[12px] text-muted">{s.runs.length}/{Math.max(5, s.runs.length)} runs done. The verdict lands when they all finish.</p>
      </div>
    )
  }
  if (!g) return <p className="m-0 text-muted">{s.status === 'waiting' ? 'Waiting for your answer below.' : s.status === 'failed' ? s.error ?? 'Stopped.' : 'Not graded yet.'}</p>
  const color = toneVar(starTone(s))
  if (g.verdict === 'baseline') return (
    <div className="rounded-xl border border-rule p-3.5">
      <div className="flex items-baseline justify-between"><span className="text-[12px] font-medium">Baseline</span><span className="text-[11.5px] text-muted">{g.n} runs</span></div>
      <div className="num mt-1 text-[30px] font-medium leading-none tracking-[-0.03em]">{pct(g.mean_child)}</div>
      <p className="num m-0 mt-2 text-[12px] text-faint">Likely range {pct(g.ci_low)} to {pct(g.ci_high)}</p>
    </div>
  )
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--color-rule))` }} title={`${g.n} paired seeds · p ${g.p_value < 0.001 ? '< 0.001' : g.p_value.toFixed(3)}`}>
      <div className="flex items-baseline justify-between"><span className="text-[12px] font-medium" style={{ color }}>{VERDICT_TEXT[g.verdict]}</span><span className="text-[11.5px] text-muted">{g.n} runs</span></div>
      <div className="num mt-1 text-[30px] font-medium leading-none tracking-[-0.03em]" style={{ color }}>{pts(g.delta)} <span className="text-[14px]">pts</span></div>
      <p className="num m-0 mt-2 text-[12px] text-muted">{pct(g.mean_parent)} → {pct(g.mean_child)}</p>
      <p className="num m-0 mt-0.5 text-[12px] text-faint">Likely range {pts(g.ci_low)} to {pts(g.ci_high)}</p>
    </div>
  )
}

// "Branch from here" lives in the header; this is the little form it opens.
function BranchForm({ s, done }: { s: Star; done: () => void }) {
  const branch = useStore((st) => st.branch)
  const [text, setText] = useState('')
  const submit = async () => { await branch(s.id, text); setText(''); done() }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="steer" className="label block">Agents will propose experiments that start from this result. Steer them (optional):</label>
      <textarea id="steer" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. try it with longer training"
        className="w-full resize-none rounded-md border border-rule bg-surface p-2 focus:border-ink focus:outline-none"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />
      <button className="btn btn-primary self-start" onClick={submit}>Ask for proposals</button>
    </div>
  )
}

// Each claim the star tested once, named by its short title rather than "Highlight from …".
function TestedClaims({ s }: { s: Star }) {
  const claims = useStore((st) => st.app.claims)
  const tested = s.provenance.filter((p, i, all) => p.kind !== 'note' && p.kind !== 'human' && all.findIndex((q) => q.id === p.id) === i)
  if (!tested.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label mr-0.5">Tests</span>
      {tested.map((p) => <ProvChip key={p.id} p={p} label={claims.find((c) => c.id === p.id)?.summary} />)}
    </div>
  )
}

// The answer opens out from where the mote lands on its first line.
const HIDDEN_ANSWER = { clipPath: 'circle(0px at 12px 11px)', opacity: 0, filter: 'blur(4px)' }
const SHOWN_ANSWER = { clipPath: 'circle(150% at 12px 11px)', opacity: 1, filter: 'blur(0px)' }
const MAX_CITED = 3
const OPENERS = ['What did you run?', 'Is this result real?', 'What should I try next?']
const firstSentence = (t: string) => t.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? t

// Litmus's mark: a few marble facets, one of them lit, like the statue it speaks for.
function FacetMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <polygon points="9,1 16,6 9,9" fill="#f4f6f9" /><polygon points="9,1 9,9 2,6" fill="#c9d3e0" />
      <polygon points="2,6 9,9 5,16" fill="#aebccf" /><polygon points="16,6 13,16 9,9" fill="#dfe5ee" />
      <polygon points="5,16 9,9 13,16" fill="var(--color-agent)" />
    </svg>
  )
}

function LitmusMessage({ text, provenance, pending, clamp }: { text: string; provenance?: Provenance[]; pending?: boolean; clamp?: boolean }) {
  const claims = useStore((st) => st.app.claims)
  const [full, setFull] = useState(false)
  const cited = (provenance ?? []).filter((p, i, all) => p.kind === 'highlight' && all.findIndex((q) => q.id === p.id) === i).slice(0, MAX_CITED)
  return (
    <div className="flex items-start gap-2">
      <FacetMark />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <motion.div className="msg-litmus" data-answer-slot={pending ? 'pending' : undefined} initial={false}
          animate={pending ? HIDDEN_ANSWER : SHOWN_ANSWER} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}>
          {clamp
            ? <button className={`block text-left ${full ? '' : 'line-clamp-4'}`} aria-expanded={full} onClick={() => setFull(!full)} title={full ? undefined : 'Show all'}>{text}</button>
            : text}
        </motion.div>
        {!pending && cited.length > 0 && <div className="flex flex-wrap gap-1">{cited.map((p) => <ProvChip key={p.id} p={p} label={claims.find((c) => c.id === p.id)?.summary} />)}</div>}
      </div>
    </div>
  )
}

// The conversation with Litmus: its conclusion opens it, replans read as notes between messages, then your questions.
function Story({ s }: { s: Star }) {
  const { chats, thinking, thought, app } = useStore()
  const turns = chats[s.id] ?? []
  const replans = app.replans.filter((r) => r.star_id === s.id)
  const busy = thinking === s.id
  const flying = thought?.starId === s.id
  const pending = flying && !thought.landed // the newest answer waits for the mote to land on it
  const opener = s.parent_id ? s.reflection : null // the baseline's note only repeats its result card
  if (!opener && !replans.length && !turns.length && !busy) return null
  return (
    <section aria-label="Conversation with Litmus" className="flex flex-col gap-3">
      {opener && <LitmusMessage text={opener} clamp />}
      {replans.map((r) => <p key={r.seq} className="thread-note" title={r.because}>{firstSentence(r.change)}</p>)}
      {turns.map((t, i) => t.role === 'human'
        ? <p key={i} className="msg-human">{t.text}</p>
        : <LitmusMessage key={i} text={t.text} provenance={t.provenance} pending={pending && i === turns.length - 1} />)}
      {busy && !flying && (
        <div className="flex items-start gap-2" aria-live="polite" aria-label="Litmus is thinking">
          <FacetMark /><div className="msg-litmus typing"><span /><span /><span /></div>
        </div>
      )}
    </section>
  )
}

// The question bar is pinned to the bottom of the panel, so the details above can scroll without losing it.
function AskBar({ s }: { s: Star }) {
  const { chats, thinking, ask } = useStore()
  const [draft, setDraft] = useState('')
  const turns = chats[s.id] ?? []
  const busy = thinking === s.id
  const send = (q: string) => { if (!q.trim() || busy) return; setDraft(''); ask(s.id, q.trim()) }
  return (
    <div className="flex flex-col gap-2 border-t border-rule bg-surface p-3">
      {!turns.length && !busy && <div className="flex flex-wrap gap-1.5">{OPENERS.map((q) => <button key={q} className="chip hover:border-faint hover:text-ink" onClick={() => send(q)}>{q}</button>)}</div>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <label className="sr-only" htmlFor={`ask-${s.id}`}>Ask Litmus about this experiment</label>
        <input id={`ask-${s.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Litmus about this experiment" className="field min-w-0 flex-1" />
        <button className="btn btn-primary" disabled={!draft.trim() || busy}>Ask</button>
      </form>
    </div>
  )
}

function Detail({ s }: { s: Star }) {
  const { app, select } = useStore()
  const stars = app.session!.stars
  const [branching, setBranching] = useState(false)
  const parent = stars.find((x) => x.id === s.parent_id)
  const live = s.status === 'running' || s.status === 'queued'
  const pending = app.session?.proposals.some((p) => p.star_id === s.id && p.status === 'open')
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn btn-quiet -ml-2 h-7 px-2" onClick={() => select(null)}>← All results</button>
        <div className="flex gap-1.5">
          {live && <StopButton id={s.id} />}
          <button className="btn h-7 px-2.5 text-[12.5px]" disabled={live || pending} aria-expanded={branching} onClick={() => setBranching(!branching)}>{pending ? 'Proposals ready' : 'Branch from here'}</button>
        </div>
      </div>
      {branching && <BranchForm s={s} done={() => setBranching(false)} />}
      <header>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full ring-2 ring-offset-2 ring-offset-surface" style={{ background: 'var(--color-graphite)', ['--tw-ring-color' as string]: toneVar(starTone(s)) }} />
          <h2 className="m-0 text-[17px] font-semibold tracking-[-0.02em]">{agentName(s)}</h2>
          {s.parent_id && <span className="num text-[12px] text-faint">{agentDetail(s)}</span>}
        </div>
        <p className="m-0 mt-1.5 text-[13px] leading-snug text-muted">{s.title}{parent && ` · from ${agentName(parent)}`}</p>
      </header>
      <Verdict s={s} />
      <div className="plate px-3 pb-1.5 pt-2.5">
        <p className="label m-0 mb-1">Accuracy along this path</p>
        <PathChart stars={stars} highlight={s} />
      </div>
      <TestedClaims s={s} />
      <Story s={s} />
    </div>
  )
}

function StopButton({ id }: { id: string }) {
  const stop = useStore((st) => st.stopBranch)
  return <button className="btn h-7 px-2.5 text-[12.5px]" onClick={() => stop(id)}>Stop</button>
}

// ---------------------------------------------------------------- abstract

function AbstractView() {
  const { app, sid, select, set } = useStore()
  const a = app.session!.abstract!
  const cite = (id: string, i: number) => {
    if (/^S\d+$/.test(id)) {
      const star = app.session!.stars.find((x) => x.id === id)
      return <button key={i} className="chip mx-0.5 align-baseline hover:border-faint" onClick={() => select(id)}>{star ? agentName(star) : id}</button>
    }
    const p = a.citations.find((c) => c.id === id || c.id.startsWith(id)) ?? app.claims.find((c) => c.id === id)?.provenance[0]
    return p ? <ProvChip key={i} p={p} /> : null
  }
  const render = (text: string) => text.split(/\[((?:S\d+)|(?:hl_[\w-]+))\]/g).map((part, i) => (i % 2 ? cite(part, i) : <Fragment key={i}>{part}</Fragment>))
  const download = async () => {
    const md = sid ? await sessionApi().exportMarkdown(sid) : ''
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const el = document.createElement('a'); el.href = url; el.download = 'litmus-findings.md'; el.click(); URL.revokeObjectURL(url)
  }
  return (
    <article className="flex flex-col gap-4 p-4" aria-label="Abstract">
      <button className="btn btn-quiet -ml-2 h-7 self-start px-2" onClick={() => set({ abstractOpen: false })}>← All results</button>
      <h2 className="m-0 text-[17px] font-semibold tracking-[-0.02em]">Abstract</h2>
      <p className="m-0 text-[13.5px] leading-relaxed">{render(a.text)}</p>
      <section>
        <H>Findings</H>
        <ul className="m-0 list-none space-y-2 p-0 text-[12.5px] leading-snug">{a.findings.map((f, i) => <li key={i} className="border-t border-rule pt-2">{render(f)}</li>)}</ul>
      </section>
      {app.exportInfo && <p className="m-0 rounded-md bg-paper p-3 text-[12.5px] leading-snug text-muted">{app.exportInfo.instructions}</p>}
      <button className="btn btn-primary self-start" onClick={download}>Download findings (.md)</button>
    </article>
  )
}

// On wide screens the panel floats over the scene as a card with space around it; on narrow ones it sits below the scene.
export function Inspector({ floating }: { floating: boolean }) {
  const { app, selectedId, abstractOpen } = useStore()
  const s = app.session?.stars.find((x) => x.id === selectedId)
  const showAbstract = abstractOpen && !!app.session?.abstract
  const shell = floating
    ? 'absolute bottom-3 right-3 top-3 z-20 flex w-[348px] flex-col overflow-hidden rounded-2xl border border-rule bg-surface shadow-[0_20px_50px_-14px_rgba(43,58,82,0.30)]'
    : 'flex flex-col border-t border-rule bg-surface'
  return (
    <aside data-tour="results" className={shell} aria-label="Results">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showAbstract ? <AbstractView /> : s ? <Detail s={s} key={s.id} /> : <Overview />}
      </div>
      {s && !showAbstract && <AskBar s={s} key={`ask-${s.id}`} />}
    </aside>
  )
}
