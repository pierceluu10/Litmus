import { Fragment, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { askLitmus, openAgent, sessionApi, useStarting, useStore } from '../store'
import { agentDetail, agentName, pct, provLabel, pts, starTone, toneVar } from '../lib/format'
import { AUTORESEARCH, commonQuestions } from '../lib/questions'
import type { Provenance, ReadingItem } from '../types'
import { PathChart } from './PathChart'
import { ProvChip } from './Prov'
import { ExternalIcon, SearchIcon } from './Icons'
import { Steering } from './Steering'
import { SceneBackdrop } from './LowPolyScene'
import { Whimsy } from './Whimsy'
import { StartBubble } from './StartBubble'

const H = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-2 flex items-baseline justify-between"><h3 className="m-0 text-[12px] font-semibold text-muted">{children}</h3>{aside}</div>
)

// ---------------------------------------------------------------- overview

function Overview() {
  const { app, select } = useStore()
  const s = app.session!
  const graded = s.stars.filter((x) => x.grade && x.grade.verdict !== 'baseline' && x.status !== 'failed')
  const ranked = s.stars.filter((x) => x.grade && x.status !== 'failed').sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)
  const count = (v: string) => graded.filter((x) => x.grade!.verdict === v).length
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
      <Steering />
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
        <h3 className="m-0 text-[12px] font-semibold text-muted">Research log</h3><span className="label">{open ? 'hide' : `${app.feed.length} ${app.feed.length === 1 ? 'entry' : 'entries'}`}</span>
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

const CARD = 'marble-edge relative isolate rounded-2xl border border-rule bg-surface'
const RESULTS_FACETS = 23, LITMUS_FACETS = 61
// The results card keeps one height whether or not the chat is open; the chat fills the room under it.
const MAX_CITED = 3

// Litmus's face: the statue's bearded head, low poly (also the favicon). Nudged down so it sits level with the
// bubble's first line.
function Face() {
  return <img src="/litmus-face.svg" alt="" width={24} height={24} className="mt-[7px] shrink-0" />
}

const IMPORT_POLL_MS = 2000
const IMPORT_POLLS = 45 // 90 s of checking; after that Papiers keeps importing on its own
const IMPORT_DONE = ['ready', 'failed']
type Importing = { phase: 'idle' | 'adding' | 'ready' | 'slow' | 'failed'; error?: string }

// Adds one paper autoresearch found to the person's Papiers library. The click is their approval; nothing is added without it.
function AddToPapiers({ url }: { url: string }) {
  const [state, setState] = useState<Importing>({ phase: 'idle' })
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const add = async () => {
    setState({ phase: 'adding' })
    try {
      let s = await sessionApi().importPaper(url)
      for (let i = 0; alive.current && !IMPORT_DONE.includes(s.status) && i < IMPORT_POLLS; i++) {
        await new Promise((r) => setTimeout(r, IMPORT_POLL_MS))
        s = await sessionApi().importStatus(s.operationId)
      }
      if (!alive.current) return
      setState(s.status === 'ready' ? { phase: 'ready' } : s.status === 'failed' ? { phase: 'failed', error: s.error?.message ?? 'Papiers could not import it.' } : { phase: 'slow' })
    } catch (e) { if (alive.current) setState({ phase: 'failed', error: (e as Error).message }) }
  }
  if (state.phase === 'ready') return <p className="m-0 mt-2 text-[11.5px] font-medium" style={{ color: toneVar('confirmed') }}>In your Papiers library</p>
  if (state.phase === 'slow') return <p className="m-0 mt-2 text-[11.5px] text-muted">Papiers is still importing it; it will appear in your library.</p>
  return (
    <div className="mt-2">
      <button className="btn h-7 px-2.5 text-[12px]" disabled={state.phase === 'adding'} title={`Imports ${url}`} onClick={add}>
        {state.phase === 'adding' ? 'Adding to Papiers…' : state.phase === 'failed' ? 'Try again' : 'Add to Papiers'}
      </button>
      {state.error && <p role="alert" className="m-0 mt-1 text-[11px] leading-snug text-refuted">{state.error}</p>}
    </div>
  )
}

// The answer opens out from where the pearl lands on its first line.
const HIDDEN_ANSWER = { clipPath: 'circle(0px at 12px 11px)', opacity: 0, filter: 'blur(4px)' }
const SHOWN_ANSWER = { clipPath: 'circle(150% at 12px 11px)', opacity: 1, filter: 'blur(0px)' }

function LitmusMessage({ text, provenance, papers, pending }: { text: string; provenance?: Provenance[]; papers?: ReadingItem[]; pending?: boolean }) {
  const claims = useStore((st) => st.app.claims)
  const cited = (provenance ?? []).filter((p, i, all) => p.kind === 'highlight' && all.findIndex((q) => q.id === p.id) === i).slice(0, MAX_CITED)
  return (
    <div className="flex items-start gap-2">
      <Face />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <motion.div className="msg-litmus" data-answer-slot={pending ? 'pending' : undefined} initial={pending ? HIDDEN_ANSWER : { opacity: 0, y: 4 }}
          animate={pending ? HIDDEN_ANSWER : { ...SHOWN_ANSWER, y: 0 }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}>
          {text}
        </motion.div>
        {!pending && cited.length > 0 && <div className="flex flex-wrap gap-1">{cited.map((p) => <ProvChip key={p.id} p={p} label={claims.find((c) => c.id === p.id)?.summary} />)}</div>}
        {!pending && !!papers?.length && (
          <ol aria-label="Papers to read" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {papers.map((p) => (
              <li key={p.url} className="plate p-2.5">
                <a href={p.url} target="_blank" rel="noreferrer" className="block no-underline">
                  <span className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-ink">{p.title}<ExternalIcon /></span>
                  <span className="mt-0.5 block text-[11px] text-faint">{p.authors.join(', ')}{p.year ? ` · ${p.year}` : ''} · arXiv</span>
                  <span className="mt-1 block text-[12px] leading-snug text-muted">{p.why}</span>
                </a>
                <AddToPapiers url={p.pdf ?? p.url} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

// The conversation with Litmus: your questions in graphite, its answers in marble beside its face.
function Story() {
  const { chat: turns, thinking, thought } = useStore()
  const busy = !!thinking
  const flying = !!thought
  const pending = flying && !thought.landed // the newest answer stays hidden until the pearl lands on it
  if (!turns.length && !busy) return null
  return (
    <section aria-label="Conversation with Litmus" className="flex flex-col gap-3">
      {turns.map((t, i) => t.role === 'human'
        ? <p key={i} className="msg-human">{t.text}</p>
        : <LitmusMessage key={i} text={t.text} provenance={t.provenance} papers={t.papers} pending={pending && i === turns.length - 1} />)}
      {busy && !flying && (
        <div className="flex items-start gap-2" aria-live="polite" aria-label="Litmus is thinking">
          <Face /><div className="msg-litmus thinking"><Whimsy lead={turns.at(-1)?.text === AUTORESEARCH ? 'Searching arXiv' : 'Thinking'} className="thinking-text" /></div>
        </div>
      )}
    </section>
  )
}

// The conversation scrolls inside the Litmus card, newest at the bottom.
function Thread() {
  const { chat, thinking, thought } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const count = chat.length
  const landed = thought?.landed
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [count, thinking, landed])
  return (
    <div ref={box} className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3">
      <Story />
    </div>
  )
}

const OFFERS_DEBOUNCE_MS = 700 // a burst of events (a wave finishing) asks for questions once

// The questions to offer right now: the ones Litmus generated for this exact state of the research when they have
// arrived, else the rule-based ones, never one already asked. `key` changes whenever the state they describe does.
export function useOffers() {
  const st = useStore()
  const session = st.app.session
  const agent = openAgent(st)
  const asked = st.chat.filter((t) => t.role === 'human').map((t) => t.text)
  const key = session ? [session.status, agent, session.questions.filter((q) => q.status === 'open').length, asked.length,
    session.stars.map((s) => `${s.id}${s.status}${s.grade?.verdict ?? ''}`).join()].join('|') : ''
  const fresh = st.offers?.key === key ? st.offers.questions : commonQuestions(session, agent ?? null)
  return { key, asked, questions: fresh.filter((q) => !asked.includes(q)) }
}

// The Litmus card: its own card under the results, holding the whole conversation. Litmus answers about the agent you
// have open, or the research as a whole.
function AskBar() {
  const { thinking, selectedId, app, select } = useStore()
  const [draft, setDraft] = useState('')
  const busy = !!thinking
  const about = app.session?.stars.find((x) => x.id === selectedId && x.parent_id)
  const send = (q: string, source: HTMLElement) => {
    if (!q.trim() || busy) return
    askLitmus(source, q)
    setDraft('')
  }
  const { key, asked, questions: offers } = useOffers()
  const loadOffers = useStore((s) => s.loadOffers)
  // asks Litmus for questions about this state of the research once it settles (one request per state)
  useEffect(() => {
    if (!key) return
    const timer = setTimeout(() => void loadOffers(key, asked), OFFERS_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.section data-scene-obstacle aria-label="Ask Litmus" className={`${CARD} flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3`}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
      <SceneBackdrop seed={LITMUS_FACETS} className="card-facets" />
      <div className="flex items-center gap-2">
        <img src="/litmus-face.svg" alt="" width={22} height={22} />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Litmus</span>
        {about
          ? <button className="chip ml-auto hover:border-faint" title="Ask about the whole research instead" onClick={() => select(null)}>about {agentName(about)} ×</button>
          : <span className="text-[11.5px] text-faint">about the whole research</span>}
      </div>
      <Thread />
      {!busy && (
        <div className="flex flex-wrap gap-1.5">
          {/* autoresearch is always on offer; the rest follow the state of the research */}
          <button className="chip gap-1.5 border-ink/40 text-ink hover:border-ink" onClick={(e) => send(AUTORESEARCH, e.currentTarget)}><SearchIcon />{AUTORESEARCH}</button>
          {offers.filter((q) => q !== AUTORESEARCH).map((q) => <button key={q} className="chip hover:border-faint hover:text-ink" onClick={(e) => send(q, e.currentTarget)}>{q}</button>)}
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(draft, e.currentTarget.querySelector('input')!) }}>
        <label className="sr-only" htmlFor="ask-litmus">Ask Litmus</label>
        <input id="ask-litmus" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Litmus" className="field min-w-0 flex-1" />
        <button className="btn btn-primary" disabled={!draft.trim() || busy}>Ask</button>
      </form>
    </motion.section>
  )
}

// ---------------------------------------------------------------- abstract

const citeText = 'border-0 bg-transparent p-0 text-muted underline decoration-rule underline-offset-[3px] hover:text-ink hover:decoration-ink'

function AbstractView() {
  const { app, sid, select, set } = useStore()
  const a = app.session!.abstract!
  const cite = (id: string, i: number) => {
    if (/^S\d+$/.test(id)) {
      const star = app.session!.stars.find((x) => x.id === id)
      return <button key={i} className={citeText} onClick={() => select(id)}>({star ? agentName(star) : id})</button>
    }
    const p = a.citations.find((c) => c.id === id || c.id.startsWith(id) || id.startsWith(c.id)) ?? app.claims.find((c) => c.id === id)?.provenance[0]
    return p ? <button key={i} className={citeText} title={`“${p.text}”`} onClick={() => p.papiers_url && window.open(p.papiers_url, '_blank', 'noreferrer')}>({provLabel(p, app.documents)})</button> : null
  }
  const render = (text: string) => text.split(/\[((?:S\d+)|(?:hl_[\w-]+(?:#\w+)?))\]/g).map((part, i) => (i % 2 ? cite(part, i) : <Fragment key={i}>{part}</Fragment>))
  const download = async () => {
    const md = sid ? await sessionApi().exportMarkdown(sid) : ''
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const el = document.createElement('a'); el.href = url; el.download = 'litmus-findings.md'; el.click(); URL.revokeObjectURL(url)
  }
  return (
    <article className="flex flex-col gap-4 p-4" aria-label="Abstract">
      <button className="btn btn-quiet -ml-2 h-7 self-start px-2" onClick={() => set({ abstractOpen: false })}>← All results</button>
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.02em]">Abstract</h2>
        <button type="button" aria-label="Close abstract" title="Close" className="btn btn-quiet h-7 w-7 justify-center p-0 text-[18px] leading-none" onClick={() => set({ abstractOpen: false })}>×</button>
      </div>
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
  const { app, abstractOpen, chatOpen, set } = useStore()
  const starting = useStarting()
  const showAbstract = abstractOpen && !!app.session?.abstract
  // Two tabs over the whole right side: the results, or the conversation with Litmus (`chatOpen`).
  const column = floating ? 'absolute bottom-3 right-3 top-3 z-20 flex w-[348px] flex-col gap-2.5' : 'flex flex-col gap-2.5 border-t border-rule bg-paper p-3'
  if (starting) {
    return (
      <div className={column}>
        <div className="flex min-h-0 flex-1 flex-col justify-end"><StartBubble /></div>
        <img src="/litmus-face.svg" alt="Litmus" width={44} height={44} className="self-end rounded-full border border-rule bg-surface p-1 shadow-[0_8px_24px_-10px_rgba(43,58,82,0.3)]" />
      </div>
    )
  }
  return (
    <div className={column}>
      <div role="tablist" aria-label="Right panel" className="marble-edge flex shrink-0 gap-1 rounded-full border border-rule bg-surface p-1">
        {([['Results', false], ['Litmus chat', true]] as const).map(([label, chat]) => (
          <button key={label} role="tab" aria-selected={chatOpen === chat} onClick={() => set({ chatOpen: chat })}
            className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors ${chatOpen === chat ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`}>
            {chat && <img src="/litmus-face.svg" alt="" width={18} height={18} />}{label}
          </button>
        ))}
      </div>
      {chatOpen
        ? <AskBar />
        : (
          <aside data-scene-obstacle className={`${CARD} flex min-h-0 flex-1 flex-col overflow-hidden`} aria-label="Results">
            <SceneBackdrop seed={RESULTS_FACETS} className="card-facets" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {showAbstract ? <AbstractView /> : <Overview />}
            </div>
          </aside>
        )}
    </div>
  )
}
