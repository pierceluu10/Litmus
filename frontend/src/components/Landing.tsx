import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { api, useStore } from '../store'
import { claims } from '../mock/library'
import { LowPolyScene, LowPolySky } from './LowPolyScene'
import { nav, useAuth } from '../auth'

const ease = [0.23, 1, 0.32, 1] as const
const HELV = 'font-[Helvetica_Neue,Helvetica,Arial,sans-serif]'
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.7, delay, ease }}>
      {children}
    </motion.div>
  )
}

function Count({ to, dec = 2, delay = 0, suffix = ' pts' }: { to: number; dec?: number; delay?: number; suffix?: string }) {
  const ref = useRef<SVGTSpanElement>(null) // only used inside SVG text
  const seen = useInView(ref, { once: true, margin: '-80px' })
  const reduce = useReducedMotion()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (reduce) { setV(to); return }
    const c = animate(0, to, { duration: 0.9, delay, ease: 'easeOut', onUpdate: setV })
    return () => c.stop()
  }, [seen, to, delay, reduce])
  return <tspan ref={ref}>{v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(dec)}{suffix}</tspan>
}

function Section({ id, tone, title, sub, children }: { id: string; tone: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} className={`flex min-h-[88vh] items-center px-[clamp(20px,6vw,96px)] py-24 ${tone}`}>
      <div className="mx-auto grid w-full max-w-[1180px] items-center gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Reveal>
          <h2 className="m-0 text-[clamp(36px,4.6vw,56px)] font-bold leading-none tracking-[-0.035em]">{title}</h2>
          <p className="mt-4 max-w-[30ch] text-[19px] leading-snug text-muted">{sub}</p>
        </Reveal>
        <div>{children}</div>
      </div>
    </section>
  )
}

const card = 'rounded-xl border border-rule bg-surface shadow-[0_18px_50px_rgba(30,40,60,0.08)]'

// Read: highlights sweep in, your notes appear underneath
function ReadMock() {
  const rows = [claims[0], claims[1], claims[2]]
  return (
    <div className={`${card} space-y-4 p-6`}>
      {rows.map((c, i) => (
        <motion.div key={c.id} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.6, delay: i * 0.3, ease }} className="rounded-lg border border-rule p-4">
          <p className="m-0 text-[15px] leading-snug">
            <span className="relative">
              <motion.span aria-hidden className="absolute inset-0 origin-left rounded-sm bg-agent/15" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.1, delay: i * 0.3 + 0.4, ease }} />
              <span className="relative">{c.text.length > 120 ? c.text.slice(0, 118) + '…' : c.text}</span>
            </span>
          </p>
          <motion.p className="m-0 mt-2 text-[13px] italic text-human" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.3 + 1.2 }}>
            Your note: “{c.annotation}”
          </motion.p>
          <p className="m-0 mt-1 text-[12px] text-muted">{c.doc_title}</p>
        </motion.div>
      ))}
    </div>
  )
}

const NODES = [
  { id: 'LS', x: 380, y: 70, label: 'Label smoothing', v: 0.21, tone: 'confirmed', l: 'α' },
  { id: 'FL', x: 480, y: 210, label: 'Alternating flip', v: 0.12, tone: 'inconclusive', l: 'β' },
  { id: 'TT', x: 340, y: 320, label: 'TTA off', v: -0.31, tone: 'confirmed', l: 'γ' },
  { id: 'MX', x: 70, y: 300, label: 'Mixup', v: -0.62, tone: 'refuted', l: 'δ' },
]
const BASE = { x: 190, y: 190 }

// a dot that travels along a quadratic curve once the section is on screen
function Traveller({ d, from, to, ctrl, color }: { d: number; from: [number, number]; to: [number, number]; ctrl: [number, number]; color: string }) {
  const ref = useRef<SVGCircleElement>(null)
  const seen = useInView(ref, { once: true, margin: '-80px' })
  const [t, setT] = useState<number | null>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!seen || reduce) return
    const c = animate(0, 1, { duration: 0.8, delay: d, ease: 'easeInOut', onUpdate: setT, onComplete: () => setT(null) })
    return () => c.stop()
  }, [seen, d, reduce])
  const u = t ?? 0
  const x = (1 - u) ** 2 * from[0] + 2 * (1 - u) * u * ctrl[0] + u * u * to[0]
  const y = (1 - u) ** 2 * from[1] + 2 * (1 - u) * u * ctrl[1] + u * u * to[1]
  return <circle ref={ref} cx={x} cy={y} r={4.5} fill={color} opacity={t === null ? 0 : 1} />
}

// Test: agents travel out to new stars, each runs, then settles into a verdict
function TestMock() {
  const reduce = useReducedMotion()
  return (
    <div className={`${card} p-4`}>
      <svg viewBox="0 0 560 380" className="w-full" role="img" aria-label="Four agents leave the baseline star and return verdicts">
        {NODES.map((n, i) => {
          const d = 0.4 + i * 0.4
          const mx = (BASE.x + n.x) / 2 - (n.y - BASE.y) * 0.08, my = (BASE.y + n.y) / 2 + (n.x - BASE.x) * 0.08
          return (
            <g key={n.id}>
              <motion.path d={`M${BASE.x} ${BASE.y} Q${mx} ${my} ${n.x} ${n.y}`} fill="none" stroke="var(--color-agent)" strokeWidth={2} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.8, delay: d, ease }} />
              <Traveller d={d} from={[BASE.x, BASE.y]} to={[n.x, n.y]} ctrl={[mx, my]} color="var(--color-agent)" />
              <g transform={`translate(${n.x} ${n.y})`}>
                <motion.circle r={24} fill="var(--color-surface)" stroke="var(--color-running)" strokeWidth={2} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: d + 0.7 }} />
                {!reduce && <motion.circle r={31} fill="none" stroke="var(--color-running)" strokeWidth={3} strokeLinecap="round" initial={{ pathLength: 0, opacity: 1 }} whileInView={{ pathLength: 1, opacity: 0 }} viewport={{ once: true }} transition={{ pathLength: { delay: d + 0.8, duration: 1.1 }, opacity: { delay: d + 1.9, duration: 0.3 } }} style={{ rotate: -90 }} />}
                <motion.circle r={24} fill={`color-mix(in srgb, var(--color-${n.tone}) 16%, white)`} stroke={`var(--color-${n.tone})`} strokeWidth={2} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: d + 1.9, duration: 0.4 }} />
                <text textAnchor="middle" dy="0.34em" fontSize={20} fill="var(--color-ink)">{n.l}</text>
                <text y={44} textAnchor="middle" fontSize={13} fontWeight={500} fill="var(--color-ink)">{n.label}</text>
                <text y={61} textAnchor="middle" fontSize={13} fontWeight={600} fill={`var(--color-${n.tone})`}><Count to={n.v} delay={d + 1.9} /></text>
              </g>
            </g>
          )
        })}
        <g transform={`translate(${BASE.x} ${BASE.y})`}>
          <circle r={26} fill="color-mix(in srgb, var(--color-baseline) 14%, white)" stroke="var(--color-baseline)" strokeWidth={2.4} />
          <text textAnchor="middle" dy="0.34em" fontSize={22}>ω</text>
          <text y={46} textAnchor="middle" fontSize={13} fontWeight={500}>Baseline 94.0%</text>
        </g>
      </svg>
    </div>
  )
}

// Steer: you override the agent; its pick keeps running as a ghost
function SteerMock() {
  return (
    <div className={`${card} p-6`}>
      <p className="m-0 text-[15px] leading-snug">Mixup lost 0.6 pts, but your note says it needs long training. Test it longer, or drop it?</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border-2 border-rule px-3 py-2 text-[13px] text-muted">Drop mixup, stack the winners <span className="tag block" style={{ color: 'var(--color-agent)' }}>agent leans this way</span></div>
        <motion.div className="rounded-lg border-2 px-3 py-2 text-[13px]" initial={{ borderColor: '#dde3ea', backgroundColor: '#ffffff' }} whileInView={{ borderColor: '#7b2d62', backgroundColor: '#f8f1f5' }} viewport={{ once: true, margin: '-60px' }} transition={{ delay: 0.9, duration: 0.4 }}>
          Test mixup at 30 epochs <span className="tag block text-human">you chose this</span>
        </motion.div>
      </div>
      <svg viewBox="0 0 520 250" className="mt-4 w-full" role="img" aria-label="The agent's path continues as a ghost while your choice is drawn solid">
        <motion.path d="M70 125 Q170 40 330 52" fill="none" stroke="var(--color-inconclusive)" strokeWidth={2} strokeDasharray="6 6" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ delay: 1.5, duration: 0.9, ease }} />
        <motion.path d="M70 125 Q170 210 330 198" fill="none" stroke="var(--color-human)" strokeWidth={2.6} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ delay: 1.5, duration: 0.9, ease }} />
        <circle cx={70} cy={125} r={22} fill="color-mix(in srgb, var(--color-refuted) 16%, white)" stroke="var(--color-refuted)" strokeWidth={2} />
        <text x={70} y={125} dy="0.34em" textAnchor="middle" fontSize={18}>δ</text>
        <motion.g initial={{ opacity: 0 }} whileInView={{ opacity: 0.6 }} viewport={{ once: true }} transition={{ delay: 2.3 }}>
          <circle cx={330} cy={52} r={20} fill="white" stroke="var(--color-inconclusive)" strokeWidth={2} strokeDasharray="3 3" />
          <text x={330} y={92} textAnchor="middle" fontSize={12.5} fill="var(--color-muted)">Stack winners (agent alone)</text>
        </motion.g>
        <motion.g initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 2.3 }}>
          <circle cx={330} cy={198} r={22} fill="color-mix(in srgb, var(--color-human) 14%, white)" stroke="var(--color-human)" strokeWidth={2.4} />
          <text x={330} y={238} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-human)">Mixup + longer training</text>
        </motion.g>
        <motion.g initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 2.7 }}>
          <rect x={390} y={108} width={118} height={30} rx={15} fill="white" stroke="var(--color-human)" />
          <text x={449} y={123} dy="0.34em" textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--color-human)">changed course</text>
        </motion.g>
      </svg>
    </div>
  )
}

const RESULTS = [
  { label: 'Label smoothing', m: 0.21, lo: 0.07, hi: 0.35, tone: 'confirmed' },
  { label: 'Alternating flip', m: 0.12, lo: -0.03, hi: 0.27, tone: 'inconclusive' },
  { label: 'TTA off', m: -0.31, lo: -0.42, hi: -0.2, tone: 'confirmed' },
  { label: 'Mixup, 10 epochs', m: -0.62, lo: -0.81, hi: -0.44, tone: 'refuted' },
]

// Trace: every verdict shows its confidence interval and where it came from
function TraceMock() {
  const x = (v: number) => 150 + ((v + 0.9) / 1.4) * 330
  return (
    <div className={`${card} p-6`}>
      <svg viewBox="0 0 500 220" className="w-full" role="img" aria-label="Effect sizes with 95% confidence intervals">
        <line x1={x(0)} x2={x(0)} y1={8} y2={184} stroke="var(--color-muted)" strokeDasharray="3 4" />
        {RESULTS.map((r, i) => {
          const y = 34 + i * 42, d = 0.3 + i * 0.25
          return (
            <g key={r.label}>
              <text x={0} y={y} dy="0.34em" fontSize={13}>{r.label}</text>
              <motion.rect x={x(r.lo)} y={y - 3} width={x(r.hi) - x(r.lo)} height={6} rx={3} fill={`var(--color-${r.tone})`} opacity={0.35} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-60px' }} transition={{ delay: d, duration: 0.7, ease }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              <motion.circle cx={x(r.m)} cy={y} r={6} fill={`var(--color-${r.tone})`} initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: d + 0.5, type: 'spring', duration: 0.5, bounce: 0.3 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
            </g>
          )
        })}
        <text x={x(-0.6)} y={206} textAnchor="middle" fontSize={11.5} fill="var(--color-muted)">hurts</text>
        <text x={x(0)} y={206} textAnchor="middle" fontSize={11.5} fill="var(--color-muted)">no change</text>
        <text x={x(0.35)} y={206} textAnchor="middle" fontSize={11.5} fill="var(--color-muted)">helps</text>
      </svg>
      <Reveal delay={1.2}>
        <p className="m-0 mt-2 text-[14px] leading-snug">Label smoothing moved accuracy +0.21 pts [0.07, 0.35] over 5 seeds, in line with Szegedy et al. <span className="chip">S1</span> <span className="chip">your note · Szegedy et al.</span></p>
        <p className="m-0 mt-2 text-[13px] text-muted">Findings go back into your Papiers library.</p>
      </Reveal>
    </div>
  )
}

export function Landing() {
  const { begin, health, set, error } = useStore()
  const [goal, setGoal] = useState('Which training tricks actually help a tiny CIFAR-10 classifier?')
  const [scrolled, setScrolled] = useState(false)
  const { user, logout } = useAuth()
  useEffect(() => { api.health().then((h) => set({ health: h })).catch((e) => set({ error: api.mock ? null : `Could not read backend health (${e.message}). Is the backend running, and is OPENAI_API_KEY set in backend/.env? Replay demo works without keys.` })) }, [set])
  const status = api.mock ? 'Mock mode: the backend is simulated in your browser.' : health ? `GPU ${health.modal_warm ? 'warm' : 'cold'} · Papiers ${health.papiers_ok ? 'ok' : 'unavailable'} · OpenAI ${health.openai_ok ? 'ok' : 'unavailable'}` : 'Checking the backend…'
  return (
    <main className={`h-full overflow-y-auto bg-surface ${HELV}`} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}>
      <nav className={`sticky top-0 z-30 flex items-center justify-between px-[clamp(20px,4vw,56px)] py-3.5 transition-colors ${scrolled ? 'border-b border-rule bg-surface/95' : 'border-b border-transparent'}`}>
        <button className="border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}>Litmus</button>
        <div className="flex gap-7 text-[14px] max-md:hidden">
          {[['read', 'Read'], ['test', 'Test'], ['steer', 'Steer'], ['trace', 'Trace']].map(([id, l]) => <button key={id} className="border-0 bg-transparent p-0 text-muted transition-colors hover:text-ink" onClick={() => go(id)}>{l}</button>)}
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="mr-1 text-[14px] text-muted max-sm:hidden">{user.name}</span>
              <button className="btn" onClick={logout}>Log out</button>
              <button className="btn btn-primary" onClick={() => begin(false, goal)}>Start research</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => nav('#/login')}>Log in</button>
              <button className="btn btn-primary" onClick={() => nav('#/signup')}>Get started</button>
            </>
          )}
        </div>
      </nav>

      <section className="relative -mt-[57px] h-screen min-h-[640px] overflow-hidden bg-[#eef2f7]">
        <LowPolyScene intro className="absolute inset-0 h-full w-full" />
        <div className="relative flex h-full flex-col justify-end gap-6 p-[clamp(20px,4vw,56px)] pb-16">
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
            <motion.div className="max-w-[400px]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.8, ease }}>
              <h1 className="m-0 text-[clamp(30px,4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em]">Turn what you highlighted into experiments.</h1>
              <p className="mt-3 max-w-[46ch] text-[16px] leading-snug text-muted">Parallel agents test the claims you read, and you steer at every branch.</p>
            </motion.div>
            <motion.div className="w-full max-w-[400px]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.8, ease }}>
              <label htmlFor="goal" className="block text-[13px] font-medium">Research goal</label>
              <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2" />
              <div className="mt-3 flex gap-2">
                <button className="btn btn-primary" onClick={() => begin(false, goal)}>Start research</button>
                <button className="btn" onClick={() => begin(true)}>Replay demo</button>
              </div>
              <p className="mb-0 mt-3 text-[12.5px] text-muted">{status}</p>
              {error && <p role="alert" className="mb-0 mt-2 text-[13px] text-refuted">{error}</p>}
            </motion.div>
          </div>
        </div>
        <motion.button aria-label="Scroll to learn more" className="absolute bottom-4 left-1/2 -translate-x-1/2 border-0 bg-transparent text-[12.5px] text-muted" onClick={() => go('read')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }}>
          <motion.span className="block" animate={{ y: [0, 5, 0] }} transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}>Scroll ↓</motion.span>
        </motion.button>
      </section>

      <Section id="read" tone="bg-surface" title="Read" sub="Your highlights and notes become hypotheses, ranked by how much you engaged with them."><ReadMock /></Section>
      <Section id="test" tone="bg-[#eef2f7]" title="Test" sub="Agents travel out to each claim, run it across several seeds, and grade the result."><TestMock /></Section>
      <Section id="steer" tone="bg-surface" title="Steer" sub="At every fork you choose. The agent's own pick keeps running as a ghost, so you can see what your judgment changed."><SteerMock /></Section>
      <Section id="trace" tone="bg-[#eef2f7]" title="Trace" sub="Every verdict shows its seeds, its interval, and the sentence you read that started it."><TraceMock /></Section>

      <section className="relative overflow-hidden bg-[#eef2f7] px-[clamp(20px,6vw,96px)] py-32 text-center">
        <LowPolySky className="pointer-events-none absolute inset-0 h-full w-full" />
        <Reveal className="relative">
          <h2 className="m-0 text-[clamp(34px,5vw,60px)] font-bold leading-none tracking-[-0.035em]">Find out what your highlights are worth.</h2>
          <div className="mt-8 flex justify-center gap-3">
            <button className="btn btn-primary px-5 py-2.5" onClick={() => begin(false, goal)}>Start research</button>
            <button className="btn px-5 py-2.5" onClick={() => begin(true)}>Replay demo</button>
          </div>
        </Reveal>
      </section>
      <footer className="border-t border-rule bg-surface px-[clamp(20px,4vw,56px)] py-6 text-[13px] text-muted">
        Built at Hack the Valley 11 for the Papiers Human-Centred Autoresearch Challenge. Training testbed: airbench by Keller Jordan.
      </footer>
    </main>
  )
}
