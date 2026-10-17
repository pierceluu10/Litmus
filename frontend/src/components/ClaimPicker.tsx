import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { provMatches } from '../lib/format'
import { useStore } from '../store'

// "Test another claim": one click from the scene lists every highlight no agent has touched yet, notes first.
export function ClaimPicker() {
  const { app, pivot } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const stars = app.session?.stars ?? []
  const untested = app.claims.filter((c) => !stars.some((s) => s.provenance.some((p) => provMatches(p, c.id)))).sort((a, b) => a.rank - b.rank)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [open])
  if (!app.session?.start_claim_ids?.length || !untested.length) return null
  const go = async (id: string) => { setBusy(id); await pivot(id); setBusy(null); setOpen(false) }
  return (
    <div className="relative">
      <button className="btn h-7 px-2.5 text-[12px]" aria-expanded={open} onClick={() => setOpen(!open)} style={open ? { borderColor: 'var(--color-ink)' } : undefined}>
        Test another claim <span className="ml-1 text-faint">{untested.length}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-0 top-9 z-40 m-0 flex max-h-[min(60vh,460px)] w-[340px] list-none flex-col gap-1 overflow-y-auto rounded-xl border border-rule bg-surface p-1.5 shadow-[0_16px_40px_-12px_rgba(43,58,82,0.32)]">
            {untested.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-paper">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium leading-snug">{c.summary ?? c.text.split(/\s+/).slice(0, 8).join(' ') + '…'}</span>
                  {c.annotation && <span className="block truncate text-[11px] text-human">Your note: {c.annotation}</span>}
                </span>
                <button className="btn btn-primary h-7 shrink-0 px-2.5 text-[12px]" disabled={!!busy} onClick={() => go(c.id)}>{busy === c.id ? 'Starting…' : 'Test'}</button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
