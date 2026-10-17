import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { nav } from '../auth'
import { relevant } from '../lib/relevance'
import { toneVar } from '../lib/format'
import { claims as sampleClaims, documents as sampleDocuments } from '../mock/library'
import { apiFor, useStore } from '../store'
import type { Library, LibraryStage } from '../transport/api'
import { ClaimCard } from './ClaimPicker'
import { GOAL } from './Landing'
import { Pillar, SceneBackdrop } from './LowPolyScene'
import { STAGE_TEXT } from './Researching'

const link = 'border-0 bg-transparent p-0 text-muted underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink disabled:opacity-50'
const LIST_FACETS = 83
type Stage = 'connect' | LibraryStage | 'match'
type Source = 'token' | 'saved' | 'demo'
const rise = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] as const } }

// Sign in, connect your Papiers, say what you are researching: Litmus reads your library in stages, keeps the highlights
// and notes about that topic, and you start from one of them straight into the workspace.
export function Upload() {
  const { begin, set, error } = useStore()
  // shortcut: the sign-in is decorative; nothing is checked, sent or stored. Wire real accounts here if they ever exist
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('') // held only until it is sent; never stored in the browser
  const [topic, setTopic] = useState('')
  const [stage, setStage] = useState<Stage | null>(null)
  const [found, setFound] = useState<{ lib: Library; total: number } | null>(null)
  const [problem, setProblem] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const reduce = useReducedMotion()

  const read = async (source: Source) => {
    const api = apiFor(useStore.getState().demo)
    setProblem('')
    try {
      let lib: Library
      if (source === 'demo') lib = { documents: sampleDocuments, claims: sampleClaims }
      else {
        if (source === 'token') { setStage('connect'); await api.connectPapiers(token.trim()); setToken('') }
        lib = await api.library(setStage, new AbortController().signal)
      }
      setStage('match')
      const claims = topic.trim() ? relevant(lib.claims, topic) : lib.claims.slice().sort((a, b) => a.rank - b.rank)
      setFound({ lib: { documents: lib.documents.filter((d) => claims.some((c) => c.doc_id === d.id)), claims }, total: lib.claims.length })
    } catch (e) { setProblem((e as Error).message) }
    setStage(null)
  }
  const go = async (claimId: string) => {
    setBusy(claimId)
    set({ imported: found!.lib })
    await begin(false, topic.trim() || GOAL, claimId)
    setBusy(null)
    nav('')
  }
  const working = stage !== null
  const stageText = stage === 'connect' ? 'Connecting to Papiers' : stage === 'match' ? `Finding highlights about “${topic.trim()}”` : stage ? STAGE_TEXT[stage] : ''
  const notes = found?.lib.claims.filter((c) => c.annotation).length ?? 0

  return (
    <main className="relative h-full overflow-y-auto bg-surface">
      <SceneBackdrop seed={77} className="pointer-events-none fixed inset-0 h-full w-full" />
      {[{ seed: 31, side: 'left-[3vw]', delay: 0.15 }, { seed: 32, side: 'right-[3vw]', delay: 0.4 }].map((p) => (
        // floor to ceiling: the column's own width-to-height ratio (150:1000 in Pillar), so it never stretches
        <motion.div key={p.seed} aria-hidden className={`pointer-events-none fixed inset-y-0 hidden h-full w-[15vh] xl:block ${p.side}`}
          initial={reduce ? false : { y: '-115%' }} animate={{ y: 0 }} transition={{ duration: 1.25, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}>
          <Pillar seed={p.seed} className="h-full w-full" />
        </motion.div>
      ))}
      <button className="absolute left-[clamp(20px,4vw,56px)] top-6 z-10 inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => nav('')}><img src="/litmus-face.svg" alt="" width={28} height={28} />Litmus</button>
      <motion.div className="relative mx-auto flex min-h-full w-full max-w-[460px] flex-col items-center justify-center px-5 py-20 text-center"
        initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.55, ease: [0.23, 1, 0.32, 1] }}>
        <AnimatePresence mode="wait" initial={false}>
          {found
            ? (
              <motion.section key="claims" {...rise} className="flex w-full flex-col items-center" aria-label="Where should we start?">
                <h1 className="m-0 text-[clamp(26px,3.2vw,36px)] font-bold leading-[1.08] tracking-[-0.03em]">Where should we start?</h1>
                <p className="mb-0 mt-3 text-[14.5px] leading-snug text-muted">
                  {found.lib.claims.length
                    ? <>{found.lib.claims.length} of your {found.total} highlights{topic.trim() && <> are about <span className="text-ink">“{topic.trim()}”</span></>}, {notes} with your notes. Pick the one you doubt most.</>
                    : <>None of your {found.total} highlights mention <span className="text-ink">“{topic.trim()}”</span>.</>}
                </p>
                {found.lib.claims.length > 0 && (
                  <div className="marble-edge relative isolate mt-5 w-full overflow-hidden rounded-2xl border border-rule bg-surface text-left">
                    <SceneBackdrop seed={LIST_FACETS} className="card-facets" />
                    <ul className="m-0 flex max-h-[min(52vh,520px)] list-none flex-col gap-0.5 overflow-y-auto p-1.5">
                      {found.lib.claims.map((c) => (
                        <ClaimCard key={c.id} c={c} status="untested" stars={[]} doc={found.lib.documents.find((d) => d.id === c.doc_id)} expanded={expanded === c.id}
                          onToggle={() => setExpanded(expanded === c.id ? null : c.id)} onTest={() => go(c.id)} busy={busy === c.id} canTest={!busy}
                          action="Start" showStatus={false} />
                      ))}
                    </ul>
                  </div>
                )}
                <button className={`${link} mt-5 text-[13px]`} disabled={!!busy} onClick={() => { setFound(null); setExpanded(null) }}>Change topic</button>
              </motion.section>
            )
            : (
              <motion.form key="signin" {...rise} className="flex w-full flex-col items-center" onSubmit={(e) => { e.preventDefault(); void read('token') }}>
                <h1 className="m-0 text-[clamp(28px,3.6vw,40px)] font-bold leading-[1.08] tracking-[-0.03em]">Sign in to Litmus</h1>
                <p className="mb-0 mt-3 max-w-[36ch] text-[15px] leading-snug text-muted">Then connect your Papiers and tell Litmus what you are researching.</p>
                <div className="mt-6 flex w-full flex-col gap-2">
                  <input type="email" autoComplete="off" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="field h-11 text-[14px]" />
                  <input type="password" autoComplete="off" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="field h-11 text-[14px]" />
                </div>
                <div className="mb-3 mt-6 flex w-full items-center gap-3" aria-hidden><span className="h-px flex-1 bg-rule" /><span className="card-subtitle m-0">Your library</span><span className="h-px flex-1 bg-rule" /></div>
                <div className="flex w-full flex-col gap-2">
                  <input type="password" autoComplete="off" spellCheck={false} aria-label="Papiers API token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Papiers API token" className="field h-11 text-[14px]" />
                  <input aria-label="What are you researching?" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What are you researching? e.g. CIFAR-10 training optimization" className="field h-11 text-[14px]" />
                </div>
                <button type="submit" className="btn btn-primary mt-4 h-10 w-full text-[14px]" disabled={!token.trim() || working}>
                  {working ? <span className="inline-flex items-center gap-2" aria-live="polite"><span className="dot live-dot" style={{ background: toneVar('running') }} />{stageText}…</span> : 'Find my highlights'}
                </button>
                <p className="mb-0 mt-5 flex w-full items-center justify-center text-[13px] text-muted">
                  <button type="button" className={link} disabled={working} onClick={() => read('demo')}>Try the demo highlights</button>
                  <span className="mx-2 text-faint" aria-hidden="true">·</span>
                  <button type="button" className={link} disabled={working} onClick={() => read('saved')}>Use my saved Papiers login</button>
                </p>
              </motion.form>
            )}
        </AnimatePresence>
        {(problem || error) && <p role="alert" className="mb-0 mt-4 text-[13px] text-refuted">{problem || error}</p>}
      </motion.div>
    </main>
  )
}
