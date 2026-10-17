import { useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useAnimationFrame } from 'motion/react'
import { useStore, type Thought } from '../store'
import { statueAnchor, type Point } from '../lib/statueAnchor'

// A question's trip: the typed words collapse into a mote of the same graphite as the experiments, arc to the
// statue, wait there while Litmus thinks, then arc back and open into the answer. Seconds, not ms (motion's unit).
const GATHER = 0.42
const CHAR_STAGGER = 0.012
const MAX_STAGGER = 0.18
const FLY_OUT = 0.85
const FLY_BACK = 0.7
const MIN_THINK_MS = 700
const FIND_STATUE_MS = 1500 // the camera turns to the statue as the words gather; give it this long to come into view
const SETTLE_MS = 420
const TRAIL = [0.05, 0.1, 0.15] // how far behind the mote each trailing speck runs, in flight progress
const ORB = 13 // px
const LIFT = 0.28 // arc height as a share of the distance flown
const MIN_LIFT = 70 // px
const LANDING = { x: 12, y: 11 } // where on the answer the mote lands: its first line
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
  const orb = useRef<HTMLDivElement>(null) // scale and fade
  const orbAt = useRef<HTMLDivElement>(null) // position: kept apart because animating scale rewrites transform
  const specks = useRef<(HTMLDivElement | null)[]>([])
  const pill = useRef<HTMLDivElement>(null)
  const { from } = thought

  // the Thinking label rides above the statue's head as the camera moves
  useAnimationFrame(() => {
    if (pill.current) pill.current.style.transform = `translate(${statueAnchor.crown.x}px, ${statueAnchor.crown.y}px) translate(-50%, -100%)`
  })

  useEffect(() => {
    let alive = true
    const place = (el: HTMLElement | null, p: Point) => { if (el) el.style.transform = `translate(${p.x - ORB / 2}px, ${p.y - ORB / 2}px)` }
    const fly = async (a: Point, to: () => Point, duration: number) => {
      const lift = (b: Point) => Math.max(MIN_LIFT, Math.hypot(b.x - a.x, b.y - a.y) * LIFT)
      await animate(0, 1, {
        duration, ease: inOut,
        onUpdate: (t) => {
          const b = to(), c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift(b) }
          place(orbAt.current, bezier(a, c, b, t))
          TRAIL.forEach((lag, i) => place(specks.current[i], bezier(a, c, b, Math.max(0, t - lag))))
        },
      })
    }
    const show = (el: HTMLElement | null, on: boolean, duration = 0.2) => el && animate(el, { opacity: on ? 1 : 0 }, { duration })
    const done = () => useStore.setState({ thought: null })

    const run = async () => {
      if (reduced()) { done(); return }
      // 1. the typed words collapse into one point at their centre
      const field = { left: from.left + from.padding, right: from.left + from.width - from.padding }
      const spans = chars.current.filter((s): s is HTMLSpanElement => !!s)
      const boxes = spans.map((s) => s.getBoundingClientRect())
      const shown = boxes.filter((b) => b.right <= field.right)
      const start = { x: shown.length ? (shown[0].left + shown[shown.length - 1].right) / 2 : field.left, y: from.top + from.height / 2 }
      spans.forEach((s, i) => {
        const b = boxes[i]
        if (b.right > field.right) { s.style.opacity = '0'; return }
        animate(s, { x: start.x - (b.left + b.width / 2), y: start.y - (b.top + b.height / 2), scale: 0.15, opacity: 0, filter: 'blur(1.5px)' },
          { duration: GATHER, delay: Math.min(i * CHAR_STAGGER, MAX_STAGGER), ease: gatherEase })
      })
      place(orbAt.current, start)
      TRAIL.forEach((_, i) => place(specks.current[i], start))
      if (orb.current) animate(orb.current, { scale: [0, 1], opacity: [0, 1] }, { delay: GATHER * 0.55, duration: GATHER * 0.6, ease: 'easeOut' })
      await wait((GATHER + MAX_STAGGER) * 1000)
      if (!alive) return
      // the scene is off screen (narrow layout) or the statue never came into view: let the mote fade where it is
      if (!(await statueInView())) {
        if (orb.current) await animate(orb.current, { opacity: 0, scale: 0.4 }, { duration: 0.3 })
        if (alive) done()
        return
      }

      // 2. out to the statue
      specks.current.forEach((s) => show(s, true, 0.15))
      await fly(start, () => statueAnchor.head, FLY_OUT)
      if (!alive) return
      const head = { ...statueAnchor.head }
      setRipple(head)
      show(orb.current, false, 0.25)
      specks.current.forEach((s) => show(s, false, 0.15))
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
      place(orbAt.current, back)
      show(orb.current, true, 0.15)
      specks.current.forEach((s) => show(s, true, 0.15))
      await fly(back, target, FLY_BACK)
      if (!alive) return
      specks.current.forEach((s) => show(s, false, 0.1))
      if (orb.current) animate(orb.current, { scale: 2.4, opacity: 0 }, { duration: 0.35, ease: 'easeOut' })
      useStore.setState((s) => ({ thought: s.thought && { ...s.thought, landed: true } }))
      await wait(SETTLE_MS)
      if (alive) done()
    }
    run()
    return () => { alive = false }
  }, [from, thought.starId])

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      <div className="absolute flex items-center whitespace-pre text-ink" style={{ left: from.left + from.padding, top: from.top, height: from.height, font: from.font, letterSpacing: from.letterSpacing }}>
        {[...thought.text].map((c, i) => <span key={i} ref={(el) => { chars.current[i] = el }} className="inline-block">{c === ' ' ? ' ' : c}</span>)}
      </div>
      {TRAIL.map((_, i) => <div key={i} ref={(el) => { specks.current[i] = el }} className="mote mote-speck absolute left-0 top-0" style={{ opacity: 0, scale: 1 - (i + 1) * 0.22 }} />)}
      <div ref={orbAt} className="absolute left-0 top-0"><div ref={orb} className="mote" style={{ opacity: 0 }} /></div>
      {ripple && <motion.div className="mote-ripple absolute" style={{ left: ripple.x, top: ripple.y }} initial={{ scale: 0.4, opacity: 0.7 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }} />}
      <div ref={pill} className="absolute left-0 top-0">
        <AnimatePresence>
          {thinking && (
            <motion.div className="thinking-pill" initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
              <Spark /><span className="thinking-text">Thinking</span>
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
