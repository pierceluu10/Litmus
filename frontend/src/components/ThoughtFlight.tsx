import { useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useAnimationFrame } from 'motion/react'
import { useStore, type Thought } from '../store'
import { statueAnchor, type Point } from '../lib/statueAnchor'
import { Whimsy } from './Whimsy'
import { AUTORESEARCH } from '../lib/questions'

// A question's trip: the typed words fold into a pearl of marble light, which flies to the statue trailing a thin comet
// tail, rests there while Litmus thinks, then flies back and opens into the answer. Seconds, not ms (motion's unit).
const GATHER = 0.45
const CHAR_STAGGER = 0.012
const MAX_STAGGER = 0.18
const FLY_OUT = 0.9
const FLY_BACK = 0.75
const MIN_THINK_MS = 700
const FIND_STATUE_MS = 1500 // the camera turns to the statue as the words gather; give it this long to come into view
const SETTLE_MS = 420
const PEARL = 10 // px
const LIFT = 0.28 // arc height as a share of the distance flown
const MIN_LIFT = 70 // px
const TAIL = 0.22 // how far back along the arc the tail reaches, in flight progress
const TAIL_SEGMENTS = 16
const TAIL_WIDTH = 3.2 // px at the pearl, tapering to a hairline
const LANDING = { x: 12, y: 11 } // where on the answer the pearl lands: its first line
const inOut = [0.65, 0, 0.35, 1] as const
const gatherEase = [0.55, 0, 1, 0.45] as const

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const bezier = (a: Point, c: Point, b: Point, t: number): Point => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
})
const statueInView = () => new Promise<boolean>((resolve) => {
  const until = performance.now() + FIND_STATUE_MS
  const look = () => statueAnchor.visible ? resolve(true) : performance.now() > until ? resolve(false) : requestAnimationFrame(look)
  look()
})
const answered = (starId: string) => new Promise<void>((resolve) => {
  if (useStore.getState().thinking !== starId) return resolve()
  const stop = useStore.subscribe((s) => { if (s.thinking !== starId) { stop(); resolve() } })
})

function Spark() {
  return (
    <svg className="spark" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => <line key={i} x1="6.5" y1="1.2" x2="6.5" y2="4.4" transform={`rotate(${i * 45} 6.5 6.5)`} style={{ animationDelay: `${i * 0.11}s` }} />)}
    </svg>
  )
}

function Flight({ thought }: { thought: Thought }) {
  const [thinking, setThinking] = useState(false)
  const [ripple, setRipple] = useState<Point | null>(null)
  const chars = useRef<(HTMLSpanElement | null)[]>([])
  const pearl = useRef<HTMLDivElement>(null) // scale and fade
  const pearlAt = useRef<HTMLDivElement>(null) // position: kept apart because animating scale rewrites transform
  const tail = useRef<SVGGElement>(null)
  const pill = useRef<HTMLDivElement>(null)
  const { from } = thought

  // the Thinking label rides above the statue's head as the camera moves
  useAnimationFrame(() => {
    if (pill.current) pill.current.style.transform = `translate(${statueAnchor.crown.x}px, ${statueAnchor.crown.y}px) translate(-50%, -100%)`
  })

  useEffect(() => {
    let alive = true
    const place = (p: Point) => { if (pearlAt.current) pearlAt.current.style.transform = `translate(${p.x - PEARL / 2}px, ${p.y - PEARL / 2}px)` }
    // the tail: short segments along the arc behind the pearl, each a little wider and brighter than the one before
    const drawTail = (a: Point, c: Point, b: Point, t: number) => {
      const lines = tail.current?.children
      if (!lines) return
      for (let k = 0; k < TAIL_SEGMENTS; k++) {
        const t0 = Math.max(0, t - TAIL * (1 - k / TAIL_SEGMENTS)), t1 = Math.max(0, t - TAIL * (1 - (k + 1) / TAIL_SEGMENTS))
        const p0 = bezier(a, c, b, t0), p1 = bezier(a, c, b, t1), line = lines[k] as SVGLineElement
        line.setAttribute('x1', `${p0.x}`); line.setAttribute('y1', `${p0.y}`); line.setAttribute('x2', `${p1.x}`); line.setAttribute('y2', `${p1.y}`)
      }
    }
    const fly = async (a: Point, to: () => Point, duration: number) => {
      const lift = (b: Point) => Math.max(MIN_LIFT, Math.hypot(b.x - a.x, b.y - a.y) * LIFT)
      if (tail.current) animate(tail.current, { opacity: 1 }, { duration: 0.15 })
      await animate(0, 1, {
        duration, ease: inOut,
        onUpdate: (t) => {
          const b = to(), c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift(b) }
          place(bezier(a, c, b, t))
          drawTail(a, c, b, t)
        },
      })
      if (tail.current) animate(tail.current, { opacity: 0 }, { duration: 0.25 })
    }
    const show = (on: boolean, duration = 0.2) => pearl.current && animate(pearl.current, { opacity: on ? 1 : 0, scale: on ? 1 : 0.5 }, { duration })
    const done = () => useStore.setState({ thought: null })

    const run = async () => {
      if (reduced()) { done(); return }
      // 1. the typed words fold into one point at their centre, and the pearl lights up there
      const field = { left: from.left + from.padding, right: from.left + from.width - from.padding }
      const spans = chars.current.filter((s): s is HTMLSpanElement => !!s)
      const boxes = spans.map((s) => s.getBoundingClientRect())
      const shown = boxes.filter((b) => b.right <= field.right)
      const start = { x: shown.length ? (shown[0].left + shown[shown.length - 1].right) / 2 : field.left, y: from.top + from.height / 2 }
      spans.forEach((s, i) => {
        const b = boxes[i]
        if (b.right > field.right) { s.style.opacity = '0'; return }
        animate(s, { x: start.x - (b.left + b.width / 2), y: start.y - (b.top + b.height / 2), scale: 0.2, opacity: 0, color: 'var(--color-agent)', filter: 'blur(1.5px)' },
          { duration: GATHER, delay: Math.min(i * CHAR_STAGGER, MAX_STAGGER), ease: gatherEase })
      })
      place(start)
      if (pearl.current) animate(pearl.current, { scale: [0, 1.5, 1], opacity: [0, 1, 1] }, { delay: GATHER * 0.55, duration: GATHER * 0.7, ease: 'easeOut' })
      await wait((GATHER + MAX_STAGGER) * 1000)
      if (!alive) return
      // the scene is off screen (narrow layout) or the statue never came into view: let the pearl fade where it is
      if (!(await statueInView())) {
        await show(false, 0.3)
        if (alive) done()
        return
      }

      // 2. out to the statue
      await fly(start, () => statueAnchor.head, FLY_OUT)
      if (!alive) return
      setRipple({ ...statueAnchor.head })
      show(false, 0.3)
      if (thought.oneWay) {
        await wait(SETTLE_MS)
        if (alive) done()
        return
      }
      setThinking(true)

      // 3. Litmus thinks until the backend answers (and long enough to read the label)
      await Promise.all([answered(thought.starId), wait(MIN_THINK_MS)])
      if (!alive) return
      setThinking(false)

      // 4. back to where the answer will open, or to the input if the request failed
      const slot = document.querySelector<HTMLElement>('[data-answer-slot="pending"]')
      const target = (): Point => {
        if (!slot) return { x: from.left + from.width / 2, y: from.top + from.height / 2 }
        const r = slot.getBoundingClientRect()
        return { x: r.left + LANDING.x, y: r.top + LANDING.y }
      }
      const back = { ...statueAnchor.head }
      place(back)
      show(true, 0.15)
      await fly(back, target, FLY_BACK)
      if (!alive) return
      if (pearl.current) animate(pearl.current, { scale: 2.6, opacity: 0 }, { duration: 0.35, ease: 'easeOut' })
      useStore.setState((s) => ({ thought: s.thought && { ...s.thought, landed: true } }))
      await wait(SETTLE_MS)
      if (alive) done()
    }
    run()
    return () => { alive = false }
  }, [from, thought.starId, thought.oneWay])

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      <div className="absolute flex items-center whitespace-pre text-ink" style={{ left: from.left + from.padding, top: from.top, height: from.height, font: from.font, letterSpacing: from.letterSpacing }}>
        {[...thought.text].map((c, i) => <span key={i} ref={(el) => { chars.current[i] = el }} className="inline-block">{c === ' ' ? ' ' : c}</span>)}
      </div>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <g ref={tail} className="pearl-tail" style={{ opacity: 0 }}>
          {Array.from({ length: TAIL_SEGMENTS }, (_, k) => <line key={k} strokeWidth={0.4 + (TAIL_WIDTH - 0.4) * ((k + 1) / TAIL_SEGMENTS)} strokeOpacity={((k + 1) / TAIL_SEGMENTS) ** 1.6} />)}
        </g>
      </svg>
      <div ref={pearlAt} className="absolute left-0 top-0"><div ref={pearl} className="pearl" style={{ opacity: 0 }} /></div>
      {ripple && <motion.div className="pearl-ripple absolute" style={{ left: ripple.x, top: ripple.y }} initial={{ scale: 0.4, opacity: 0.8 }} animate={{ scale: 2.8, opacity: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }} />}
      <div ref={pill} className="absolute left-0 top-0">
        <AnimatePresence>
          {thinking && (
            <motion.div className="thinking-pill" initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
              <Spark /><Whimsy lead={thought.text === AUTORESEARCH ? 'Searching arXiv' : 'Thinking'} className="thinking-text" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function ThoughtFlight() {
  const thought = useStore((s) => s.thought)
  return thought ? <Flight key={thought.key} thought={thought} /> : null
}
