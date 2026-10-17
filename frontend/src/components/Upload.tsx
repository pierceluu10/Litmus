import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { nav } from '../auth'
import { claims as sampleClaims, documents as sampleDocuments } from '../mock/library'
import { apiFor, useStore } from '../store'
import type { Library } from '../transport/api'
import { GOAL } from './Landing'
import { Pillar, SceneBackdrop } from './LowPolyScene'

const link = 'border-0 bg-transparent p-0 text-muted underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink disabled:opacity-50'

// Where the claims come from: the person's own Papiers. Paste a token, Litmus reads the highlights and notes, and you start.
export function Upload() {
  const { begin, set, error } = useStore()
  const [token, setToken] = useState('') // held only until Connect is pressed; never stored in the browser
  const [step, setStep] = useState<'idle' | 'connecting' | 'reading' | 'ok'>('idle')
  const [problem, setProblem] = useState('')
  const [live, setLive] = useState<Library | null>(null)
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion()

  const connect = async () => {
    const api = apiFor(useStore.getState().demo)
    setProblem('')
    try {
      if (token.trim()) { setStep('connecting'); await api.connectPapiers(token.trim()); setToken('') }
      setStep('reading')
      setLive(await api.library(() => {}, new AbortController().signal))
      setStep('ok')
    } catch (e) { setProblem((e as Error).message); setStep(live ? 'ok' : 'idle') }
  }
  const go = async (lib: Library | null) => {
    setBusy(true)
    set({ imported: lib })
    await begin(false, GOAL)
    setBusy(false)
    nav('')
  }
  const working = step === 'connecting' || step === 'reading'
  const notes = live?.claims.filter((c) => c.annotation).length ?? 0

  return (
    <main className="relative h-full overflow-y-auto bg-surface">
      <SceneBackdrop seed={77} className="pointer-events-none fixed inset-0 h-full w-full" />
      {[{ seed: 31, side: 'left-[3vw]', delay: 0.15 }, { seed: 32, side: 'right-[3vw]', delay: 0.4 }].map((p) => (
        <motion.div key={p.seed} aria-hidden className={`pointer-events-none fixed bottom-[7vh] top-[5vh] hidden h-[88vh] w-[clamp(110px,12vw,180px)] xl:block ${p.side}`}
          initial={reduce ? false : { y: '-115%' }} animate={{ y: 0 }} transition={{ duration: 1.25, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}>
          <Pillar seed={p.seed} className="h-full w-full" />
        </motion.div>
      ))}
      <button className="absolute left-[clamp(20px,4vw,56px)] top-6 z-10 inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => nav('')}><img src="/litmus-face.svg" alt="" width={28} height={28} />Litmus</button>
      <motion.div className="relative mx-auto flex min-h-full w-full max-w-[440px] flex-col items-center justify-center px-5 py-20 text-center"
        initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.55, ease: [0.23, 1, 0.32, 1] }}>
        <h1 className="m-0 text-[clamp(28px,3.6vw,40px)] font-bold leading-[1.08] tracking-[-0.03em]">Connect your Papiers</h1>
        {step === 'ok' && live
          ? (
            <>
              <p className="mb-0 mt-3 text-[15px] leading-snug text-muted"><span className="font-medium text-confirmed">Connected.</span> Found {live.claims.length} highlights from {live.documents.length} papers, {notes} with your notes.</p>
              <button className="btn btn-primary mt-6 h-10 px-6 text-[14px]" disabled={busy} onClick={() => go(live)}>{busy ? 'Starting…' : 'Start research'}</button>
              <button className={`${link} mt-4 text-[13px]`} disabled={working} onClick={connect}>Refresh</button>
            </>
          )
          : (
            <form className="mt-3 flex w-full flex-col items-center" onSubmit={(e) => { e.preventDefault(); void connect() }}>
              <p className="m-0 max-w-[34ch] text-[15px] leading-snug text-muted">Paste your Papiers token and Litmus will read your highlights and notes.</p>
              <input type="password" autoComplete="off" spellCheck={false} aria-label="Papiers token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Papiers token" className="field mt-6 h-11 text-center text-[14px]" />
              <button type="submit" className="btn btn-primary mt-3 h-10 w-full text-[14px]" disabled={!token.trim() || working}>{step === 'connecting' ? 'Connecting…' : step === 'reading' ? 'Reading your highlights…' : 'Connect'}</button>
              <p className="mb-0 mt-3 text-[12.5px] text-faint">You can find it in Papiers under Settings, API tokens.</p>
            </form>
          )}
        {(problem || error) && <p role="alert" className="mb-0 mt-4 text-[13px] text-refuted">{problem || error}</p>}
        <p className="mb-0 mt-10 text-[13px] text-muted">
          <button className={link} disabled={busy || working} onClick={() => go({ documents: sampleDocuments, claims: sampleClaims })}>Try the demo highlights</button>
          <span className="mx-2 text-faint" aria-hidden="true">·</span>
          <button className={link} disabled={busy || working} onClick={() => go(null)}>Use my saved login</button>
        </p>
      </motion.div>
    </main>
  )
}
