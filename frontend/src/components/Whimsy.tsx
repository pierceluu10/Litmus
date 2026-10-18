import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

// While Litmus or an agent is working: says what it is doing first ("Generating next steps"), then wanders through a few
// playful verbs so a long wait feels alive. Reduced motion keeps the plain description.
const VERBS = ['Pondering', 'Tinkering', 'Percolating', 'Noodling', 'Mulling it over', 'Cogitating', 'Ruminating', 'Brewing',
  'Untangling', 'Simmering', 'Crunching seeds', 'Consulting the papers', 'Connecting dots', 'Deliberating']
const STEP_MS = 2200

const shuffled = () => VERBS.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

export function Whimsy({ lead, className }: { lead: string; className?: string }) {
  const reduce = useReducedMotion()
  const [words] = useState(() => [lead, ...shuffled()])
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    const timer = setInterval(() => setI((n) => (n + 1) % words.length), STEP_MS)
    return () => clearInterval(timer)
  }, [reduce, words.length])
  return (
    <span className={`relative inline-grid ${className ?? ''}`} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={i} className="col-start-1 row-start-1 whitespace-nowrap" initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -4, filter: 'blur(2px)' }} transition={{ duration: 0.25 }}>
          {words[i]}…
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
