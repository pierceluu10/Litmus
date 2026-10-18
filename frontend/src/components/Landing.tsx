import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { animate, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { apiFor, useStore } from '../store'
import { LowPolyScene } from './LowPolyScene'
import { nav, useAuth } from '../auth'

const ease = [0.23, 1, 0.32, 1] as const
export const GOAL = 'Which training tricks actually help a tiny CIFAR-10 classifier?'
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

function useMediaQuery(q: string) {
  const [on, setOn] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [q])
  return on
}
function useViewportHeight() {
  const [h, setH] = useState(() => innerHeight)
  useEffect(() => { const f = () => setH(innerHeight); addEventListener('resize', f); return () => removeEventListener('resize', f) }, [])
  return h
}

// ---- the demo cards: simplified copies of what the real workspace shows ----------------------------------------

const card = 'w-full rounded-xl border border-rule bg-surface shadow-[0_24px_60px_rgba(21,24,28,0.10)]'
const inView = { once: true, amount: 0.55 } as const

function Count({ to, delay = 0, suffix = '' }: { to: number; delay?: number; suffix?: string }) {
  const ref = useRef<SVGTSpanElement>(null) // only used inside SVG text
  const seen = useInView(ref, inView)
  const reduce = useReducedMotion()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (reduce) { setV(to); return }
    const c = animate(0, to, { duration: 1, delay, ease: 'easeOut', onUpdate: setV })
    return () => c.stop()
  }, [seen, to, delay, reduce])
  return <tspan ref={ref}>{v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(2)}{suffix}</tspan>
}

const CLAIMS = [
  ['Mixup beats plain training', "Zhang et al. '17 · p.4", 'They trained 200 rounds. Does this hold in a short run?'],
  ['Mixup needs longer training', "He et al. '18 · p.8", ''],
  ['Multi-crop TTA lifts accuracy', "Jordan '24 · p.5", ''],
  ['Alternating flips beat random flips', "Jordan '24 · p.3", ''],
  ['Label smoothing adds ~0.2%', "Szegedy et al. '15 · p.6", ''],
]

// The Claims rail: everything you highlighted, with your own doubts underneath
function ClaimsMock() {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-baseline justify-between border-b border-rule px-5 py-3"><span className="text-[14px] font-semibold">Claims</span><span className="font-mono text-[12px] text-faint">0/5 tested</span></div>
      <ul className="m-0 list-none p-0">
        {CLAIMS.map(([title, src, note], i) => (
          <motion.li key={title} className="border-b border-rule px-5 py-3 last:border-0" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={inView} transition={{ duration: 0.55, delay: i * 0.14, ease }}>
            <span className="label flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-faint" />untested</span>
            <span className="relative mt-0.5 block text-[15px] font-medium leading-snug">
              {note && <motion.span aria-hidden className="absolute inset-x-0 bottom-0 top-1 origin-left rounded-sm bg-agent/15" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={inView} transition={{ duration: 0.9, delay: 0.9, ease }} />}
              <span className="relative">{title}</span>
            </span>
            <span className="mt-0.5 block text-[12px] text-faint">{src}</span>
            {note && <motion.span className="mt-1.5 block text-[13px] italic text-human" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={inView} transition={{ delay: 1.5 }}>Your note: “{note}”</motion.span>}
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

const PICKS = [
  ['Mixup beats plain training', 'your note: 200 epochs. Does it hold at 10?', 'Zhang et al.'],
  ['Test-time crops add accuracy', '', 'Jordan'],
  ['Alternating flips beat random', '', 'Jordan'],
  ['Label smoothing still helps', 'your note: ImageNet only?', 'Szegedy et al.'],
]

// Litmus's first question: where to start, answered with the claims you highlighted
function DockMock() {
  const picked = 0
  return (
    <div className={`${card} p-5`}>
      <p className="m-0 text-[14px] font-semibold">Litmus: Where should we start?</p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {PICKS.map(([t, tag, src], i) => {
          const on = i === picked
          return (
            <motion.div key={t} className="rounded-lg border bg-surface p-3" style={{ borderColor: on ? 'var(--color-ink)' : 'var(--color-rule)', transition: 'border-color 200ms' }} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={inView} transition={{ duration: 0.5, delay: i * 0.1, ease }}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-ink text-[11px] leading-none" style={{ background: on ? 'var(--color-ink)' : 'transparent', color: 'var(--color-surface)', transition: 'background 160ms' }}>{on ? '✓' : ''}</span>
                <span className="text-[14px] font-medium leading-snug">{t}</span>
              </div>
              {tag && <span className="mt-1.5 block pl-6 text-[12px] text-human">{tag}</span>}
              <span className="chip mt-2 ml-6 truncate">highlight · {src}</span>
            </motion.div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted">The claim you pick gets the first agent.</span>
        <span className="btn btn-primary shrink-0">Start with this claim</span>
      </div>
    </div>
  )
}

const AGENTS = [
  { name: 'Flip agent', x: 240, v: 0, tone: 'inconclusive', note: '' },
  { name: 'TTA agent', x: 345, v: -0.68, tone: 'confirmed', note: '' },
  { name: 'Mixup agent', x: 450, v: -1.45, tone: 'waiting', note: 'needs you' },
]
const BASE = { x: 95, y: 150 }
const PT = 52 // pixels per accuracy point

// The tree: every agent starts level with the baseline, runs, then settles at its measured accuracy
function TreeMock() {
  const reduce = useReducedMotion()
  return (
    <div className={`${card} p-4`}>
      <svg viewBox="0 0 560 290" className="w-full" role="img" aria-label="Three agents leave the baseline and settle at different heights; higher means more accurate">
        <defs><radialGradient id="blob" cx="35%" cy="30%"><stop offset="0" stopColor="#5a5f67" /><stop offset="1" stopColor="#15181c" /></radialGradient></defs>
        {[['94.0%', 147], ['93.5%', 173], ['93.0%', 199], ['92.5%', 225]].map(([l, y]) => (
          <g key={l}><line x1={40} x2={520} y1={Number(y)} y2={Number(y)} stroke="var(--color-rule)" strokeDasharray="3 5" /><text x={548} y={Number(y)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">{l}</text></g>
        ))}
        <text x={40} y={22} fontSize={11} fill="var(--color-faint)">Higher means more accurate</text>
        {AGENTS.map((a, i) => {
          const d = 0.3 + i * 0.3
          const yEnd = BASE.y - a.v * PT // lower accuracy sits lower on the page
          const dy = yEnd - BASE.y
          const mid = (BASE.x + a.x) / 2
          return (
            <g key={a.name}>
              <motion.path fill="none" stroke="var(--color-graphite)" strokeWidth={1.6} initial={{ pathLength: 0, d: `M${BASE.x} ${BASE.y} C${mid} ${BASE.y} ${mid} ${BASE.y} ${a.x} ${BASE.y}` }} whileInView={{ pathLength: 1, d: `M${BASE.x} ${BASE.y} C${mid} ${BASE.y} ${mid} ${yEnd} ${a.x} ${yEnd}` }} viewport={inView} transition={{ pathLength: { delay: d, duration: 0.6, ease }, d: { delay: d + 1.1, duration: 0.9, ease } }} />
              <motion.g initial={{ opacity: 0, y: 0 }} whileInView={{ opacity: 1, y: dy }} viewport={inView} transition={{ opacity: { delay: d + 0.4, duration: 0.3 }, y: { delay: d + 1.1, type: 'spring', duration: 1, bounce: 0.12 } }}>
                <g transform={`translate(${a.x} ${BASE.y})`}>
                  <circle r={17} fill="url(#blob)" />
                  {!reduce && <motion.circle r={22} fill="none" stroke="var(--color-running)" strokeWidth={2.4} strokeLinecap="round" initial={{ pathLength: 0, opacity: 1 }} whileInView={{ pathLength: 1, opacity: 0 }} viewport={inView} transition={{ pathLength: { delay: d + 0.4, duration: 1.1 }, opacity: { delay: d + 1.6, duration: 0.3 } }} style={{ rotate: -90 }} />}
                  <motion.circle r={22} fill="none" stroke={`var(--color-${a.tone})`} strokeWidth={2.4} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={inView} transition={{ delay: d + 1.7, duration: 0.4 }} />
                  <text y={42} textAnchor="middle" fontSize={12.5} fontWeight={550} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={4} paintOrder="stroke">{a.name}</text>
                  <text y={57} textAnchor="middle" fontSize={11} fill={`var(--color-${a.tone})`} fontFamily="var(--font-mono)" stroke="var(--color-surface)" strokeWidth={4} paintOrder="stroke"><Count to={a.v} delay={d + 1.7} />{a.note && <tspan fill="var(--color-waiting)"> · {a.note}</tspan>}</text>
                </g>
              </motion.g>
            </g>
          )
        })}
        <g transform={`translate(${BASE.x} ${BASE.y})`}>
          <circle r={21} fill="url(#blob)" /><circle r={26} fill="none" stroke="var(--color-ink)" strokeWidth={2.4} />
          <text y={46} textAnchor="middle" fontSize={12.5} fontWeight={550} fill="var(--color-ink)">Baseline</text>
          <text y={61} textAnchor="middle" fontSize={11} fill="var(--color-muted)" fontFamily="var(--font-mono)">93.94%</text>
        </g>
      </svg>
    </div>
  )
}

const BOARD = [
  ['Flip agent', 'highlight · Jordan', 93.94, '+0.00', 'inconclusive'],
  ['Baseline', 'where every test starts', 93.94, '', 'baseline'],
  ['TTA agent', 'highlight · Jordan', 93.26, '−0.68', 'confirmed'],
  ['Mixup agent', 'highlight · Zhang et al.', 92.48, '−1.45', 'refuted'],
] as const

// The Results panel: every test comes from something you read, and all of them are ranked on one scale
function BoardMock() {
  return (
    <div className={`${card} p-5`}>
      <p className="m-0 text-[14px] font-semibold">Results</p>
      <p className="m-0 mt-0.5 text-[13px] text-muted">3 experiments finished</p>
      <div className="mt-4 flex items-baseline justify-between text-[11px] text-faint"><span className="label">Leaderboard</span><span>accuracy · change from where it started</span></div>
      <ol className="m-0 mt-2 list-none p-0">
        {BOARD.map(([name, src, acc, delta, tone], i) => (
          <motion.li key={name} className="border-t border-rule py-3 first:border-0" initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={inView} transition={{ duration: 0.5, delay: i * 0.18, ease }}>
            <div className="flex items-center gap-3">
              <span className="w-3 font-mono text-[12px] text-faint">{i + 1}</span>
              <span className="h-2.5 w-2.5 rounded-full bg-graphite" />
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{name}</span><span className="block truncate text-[12px] text-faint">{src}</span></span>
              <span className="font-mono text-[13px]">{acc.toFixed(2)}%</span>
              <span className="w-12 text-right font-mono text-[13px]" style={{ color: `var(--color-${tone === 'baseline' ? 'muted' : tone})` }}>{delta}</span>
            </div>
            <div className="ml-[3.1rem] mt-2 h-1 overflow-hidden rounded-full bg-rule">
              <motion.div className="h-full origin-left rounded-full" style={{ width: `${((acc - 92) / 2) * 100}%`, background: `var(--color-${tone === 'baseline' ? 'ink' : tone})` }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={inView} transition={{ duration: 0.9, delay: 0.5 + i * 0.18, ease }} />
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

// The question card: an agent asks, you decide, and Litmus remembers where you changed course
function CallMock() {
  return (
    <div className={`${card} p-5`}>
      <p className="m-0 flex items-center gap-2 text-[14px] font-semibold"><span className="h-2 w-2 rounded-full bg-waiting" />Your call on Mixup agent</p>
      <p className="m-0 mt-2 text-[14.5px] leading-snug">Mixup lost 1.45 points in a short test. The paper trained it for far longer, and your note says it needs long training. Test it longer, or drop it?</p>
      <div className="mt-2 flex flex-wrap gap-1.5"><span className="chip">highlight · Zhang et al.</span><span className="chip">your note · He et al.</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="relative rounded-lg border border-rule p-3">
          <motion.span aria-hidden className="pointer-events-none absolute -inset-px rounded-lg border-2 border-ink" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={inView} transition={{ delay: 1.1, duration: 0.3 }} />
          <span className="block text-[14px] font-medium">Test it for longer</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">About 3× the computer time of a normal test.</span>
        </div>
        <div className="rounded-lg border border-rule p-3">
          <span className="block text-[14px] font-medium">Drop mixup</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">Cheap, but leaves the claim untested.</span>
          <span className="mt-1 block text-[12px] font-medium text-agent">Mixup agent leans this way</span>
        </div>
      </div>
      <motion.div className="mt-4 border-t border-rule pt-3" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={inView} transition={{ delay: 1.8, duration: 0.5, ease }}>
        <p className="m-0 label">Where you changed course</p>
        <p className="m-0 mt-1 text-[13.5px] text-human">You: test mixup for longer</p>
        <p className="m-0 text-[13.5px] text-muted">Mixup agent: drop mixup</p>
      </motion.div>
    </div>
  )
}

// The write-up: a short summary where every line points back to an experiment
function WriteupMock() {
  return (
    <div className={`${card} p-6`}>
      <p className="m-0 text-[14px] font-semibold">What Litmus found</p>
      <p className="m-0 mt-2 text-[15px] leading-relaxed">
        Mixup lost accuracy in a short test, but recovered when it was trained for longer, as your note on the Bag of Tricks paper suggested. Switching off test-time augmentation cost about 0.7 points.
      </p>
      <motion.div className="mt-3 flex flex-wrap gap-1.5" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={inView} transition={{ delay: 0.8 }}>
        <span className="chip">Mixup agent</span><span className="chip">TTA agent</span><span className="chip">your note · He et al.</span><span className="chip">highlight · Jordan</span>
      </motion.div>
      <motion.div className="mt-5 flex gap-2" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={inView} transition={{ delay: 1.2, duration: 0.5, ease }}>
        <span className="btn btn-primary">Add to Papiers</span><span className="btn">Download as text</span>
      </motion.div>
    </div>
  )
}

// ---- the story: plain-language slides ----------------------------------------------------------------------------

type Slide = { key: string; title: string; body: string; mock?: ReactNode }
const SLIDES: Slide[] = [
  { key: 'read', title: 'Start with what you’ve read', body: 'Litmus reads the highlights and notes you saved in Papiers. Each highlight is a claim from a paper, and your notes are where you doubted it.', mock: <ClaimsMock /> },
  { key: 'suggest', title: 'You choose where to start', body: 'Litmus asks where to start, and you pick the claim you doubt most. It gets the first agent, with a quick experiment tied to the sentence you highlighted.', mock: <DockMock /> },
  { key: 'run', title: 'Agents run them side by side', body: 'Each agent runs one experiment, repeated several times so one lucky result can’t fool you. When it finishes, it reads what the other agents found and asks you: where should I proceed?', mock: <TreeMock /> },
  { key: 'compare', title: 'Everything comes from your reading', body: 'Every agent’s experiment starts from something you read, and they’re all measured against each other on the same scale, so you can see which ideas actually helped.', mock: <BoardMock /> },
  { key: 'call', title: 'You make the calls that matter', body: 'When a result surprises an agent, it stops and asks you, with the evidence attached. Litmus keeps a record of every time you overruled one, so you can see whether your judgment paid off.', mock: <CallMock /> },
  { key: 'write', title: 'A write-up you can check', body: 'Litmus has followed every agent, so at the end it writes one short summary. Every line points back to the experiment behind it and the sentence you read.', mock: <WriteupMock /> },
  { key: 'cta', title: 'Ready to test your claims?', body: '' },
]

// Slides rest in the middle of their scroll range and only move in between, so each one can be read.
const smooth = (x: number) => x * x * (3 - 2 * x)
const dwell = (p: number, n: number) => {
  const t = clamp(p) * (n - 1), i = Math.min(Math.floor(t), n - 2), f = t - i
  return i + (f < 0.28 ? 0 : f > 0.72 ? 1 : smooth((f - 0.28) / 0.44))
}

function Cta({ onStart }: { onStart: () => void }) {
  const user = useAuth((s) => s.user)
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {!user && <button className="btn btn-primary px-5 py-2.5" onClick={() => nav('#/signup')}>Get started</button>}
      <button className={`btn px-5 py-2.5 ${user ? 'btn-primary' : ''}`} onClick={onStart}>Start research</button>
    </div>
  )
}

function SlideBody({ s, cta }: { s: Slide; cta: ReactNode }) {
  return s.mock ? (
    <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-14">
      <div>
        <h2 className="m-0 text-[clamp(32px,4vw,52px)] font-bold leading-[1.02] tracking-[-0.035em]">{s.title}</h2>
        <p className="mt-4 max-w-[34ch] text-[clamp(16px,1.4vw,19px)] leading-snug text-muted">{s.body}</p>
      </div>
      <div className="mx-auto w-full max-w-[560px]">{s.mock}</div>
    </div>
  ) : (
    <div className="mx-auto max-w-[760px] text-center">
      <h2 className="m-0 text-[clamp(38px,6vw,76px)] font-bold leading-[1] tracking-[-0.04em]">{s.title}</h2>
      <div className="mt-9">{cta}</div>
    </div>
  )
}

const SCENE_DRIFT = 10 // vw the temple drifts left across the whole story, slower than the slides

function PinnedSlide({ index, pos, children }: { index: number; pos: MotionValue<number>; children: ReactNode }) {
  const d = useTransform(pos, (v) => v - index)
  const opacity = useTransform(d, [-1, -0.5, 0, 0.5, 1], [0, 0.4, 1, 0.4, 0])
  const scale = useTransform(d, [-1, 0, 1], [0.95, 1, 0.95])
  return (
    <div className="flex h-full w-screen shrink-0 items-center px-[clamp(24px,6vw,96px)] pb-14 pt-16">
      <motion.div className="w-full" style={{ opacity, scale }}>{children}</motion.div>
    </div>
  )
}

// One page: the hero is the first panel, and scrolling slides the story in from the right while the temple
// plays its intro backwards and settles into the background.
function PinnedStory({ main, hero, cta }: { main: RefObject<HTMLElement | null>; hero: ReactNode; cta: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const panels = SLIDES.length + 1
  const { scrollYProgress } = useScroll({ container: main as RefObject<HTMLElement>, target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 130, damping: 30, mass: 0.35 })
  const pos = useTransform(p, (v) => dwell(v, panels))
  const x = useTransform(pos, (v) => `${-v * 100}vw`)
  const exit = useTransform(pos, (v) => clamp(v))
  const sceneX = useTransform(pos, (v) => `${(-v / (panels - 1)) * SCENE_DRIFT}vw`)
  const chrome = useTransform(pos, [0, 0.5], [0, 1])
  const prompt = useTransform(pos, [0, 0.15], [1, 0])
  const fill = useTransform(p, (v) => clamp(v))
  const [active, setActive] = useState(0)
  useMotionValueEvent(pos, 'change', (v) => setActive(Math.round(v)))
  const next = () => main.current?.scrollBy({ top: innerHeight, behavior: 'smooth' })
  return (
    <section ref={ref} aria-label="How Litmus works" style={{ height: `${panels * 100}vh` }} className="relative -mt-[57px]">
      <div className="sticky top-0 h-screen overflow-hidden bg-[#eef2f7]">
        <motion.div className="absolute inset-0" style={{ x: sceneX }}>
          <LowPolyScene intro exit={exit} className="absolute inset-0 h-full w-full" />
        </motion.div>
        <motion.div className="relative flex h-full will-change-transform" style={{ x, width: `${panels * 100}vw` }}>
          <div className="flex h-full w-screen shrink-0 flex-col justify-end p-[clamp(20px,4vw,56px)] pb-20">{hero}</div>
          {SLIDES.map((s, i) => <PinnedSlide key={s.key} index={i + 1} pos={pos}><SlideBody s={s} cta={cta} /></PinnedSlide>)}
        </motion.div>
        <motion.button aria-label="Scroll to see how it works" className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 border-0 bg-transparent text-[12px] text-muted" onClick={next} style={{ opacity: prompt }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }}>
          Scroll
          <motion.span className="block h-6 w-px origin-top bg-muted" animate={{ scaleY: [0.2, 1, 0.2], opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }} />
        </motion.button>
        <motion.div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2" style={{ opacity: chrome }}>
          <div className="flex items-center gap-1.5" aria-hidden>
            {SLIDES.map((s, i) => <span key={s.key} className="h-1 rounded-full transition-all duration-300" style={{ width: i + 1 === active ? 28 : 8, background: i + 1 === active ? 'var(--color-ink)' : 'var(--color-rule)' }} />)}
          </div>
          <div className="h-px w-40 overflow-hidden bg-rule"><motion.div className="h-full origin-left bg-faint" style={{ scaleX: fill }} /></div>
          <span className="font-mono text-[11px] text-faint">{Math.max(1, active)} / {SLIDES.length}</span>
        </motion.div>
      </div>
    </section>
  )
}

function StackedStory({ cta }: { cta: ReactNode }) {
  return (
    <section aria-label="How Litmus works" className="bg-paper">
      {SLIDES.map((s) => (
        <motion.div key={s.key} className="px-6 py-16" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.6, ease }}>
          <SlideBody s={s} cta={cta} />
        </motion.div>
      ))}
    </section>
  )
}

// Off: the real backend trains on Modal. On: the in-browser simulation, no backend or keys needed.
function DemoSwitch() {
  const { demo, setDemo } = useStore()
  return (
    <button role="switch" aria-checked={demo} className="switch" onClick={() => setDemo(!demo)}>
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>Demo mode
    </button>
  )
}

export function Landing() {
  const { set, error, demo } = useStore()
  const main = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const { user, logout } = useAuth()
  const reduce = useReducedMotion()
  const wide = useMediaQuery('(min-width: 860px)')
  const vh = useViewportHeight()
  const { scrollY } = useScroll({ container: main as RefObject<HTMLElement> })
  // stacked layout only: the statue and headline fade as the page scrolls
  const sceneOpacity = useTransform(scrollY, [0, vh * 0.65], [1, 0])
  const textOpacity = useTransform(scrollY, [0, vh * 0.32], [1, 0])
  useEffect(() => {
    if (demo) return
    apiFor(false).health().catch((e: Error) => set({ error: `Could not reach the backend (${e.message}). Start it with ./dev.sh, or turn on Demo mode.` }))
  }, [demo, set])
  const start = () => nav('#/upload')
  const cta = <Cta onStart={start} />
  const hero = (
    <motion.div className="max-w-[440px]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.8, ease }}>
      <h1 className="m-0 text-[clamp(30px,4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em]">Turn what you highlighted into experiments.</h1>
      <p className="mt-3 max-w-[40ch] text-[16px] leading-snug text-muted">AI agents test the claims you read, and you decide where to dig deeper.</p>
      <div className="mt-5 flex gap-2">
        <button className="btn btn-primary" onClick={start}>Start research</button>
      </div>
      {error && <p role="alert" className="mb-0 mt-2 text-[13px] text-refuted">{error}</p>}
    </motion.div>
  )
  return (
    <main ref={main} className="h-full overflow-y-auto bg-surface" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}>
      <nav className={`sticky top-0 z-30 flex items-center justify-between px-[clamp(20px,4vw,56px)] py-3.5 transition-colors ${scrolled ? 'border-b border-rule bg-surface/95' : 'border-b border-transparent'}`}>
        <button className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => main.current?.scrollTo({ top: 0, behavior: 'smooth' })}><img src="/litmus-face.svg" alt="" width={28} height={28} />Litmus</button>
        <div className="flex items-center gap-2">
          <DemoSwitch />
          {user ? (
            <>
              <button className="btn" onClick={logout}>Log out</button>
              <button className="btn btn-primary" onClick={start}>Start research</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => nav('#/login')}>Log in</button>
              <button className="btn btn-primary" onClick={() => nav('#/signup')}>Get started</button>
            </>
          )}
        </div>
      </nav>

      {wide && !reduce ? <PinnedStory main={main} hero={hero} cta={cta} /> : (
        <>
          <section className="relative -mt-[57px] h-screen min-h-[640px] overflow-hidden bg-[#eef2f7]">
            <motion.div className="absolute inset-0" style={reduce ? undefined : { opacity: sceneOpacity }}>
              <LowPolyScene intro className="absolute inset-0 h-full w-full" />
            </motion.div>
            <motion.div className="relative flex h-full flex-col justify-end p-[clamp(20px,4vw,56px)] pb-20" style={reduce ? undefined : { opacity: textOpacity }}>{hero}</motion.div>
          </section>
          <StackedStory cta={cta} />
        </>
      )}
    </main>
  )
}
