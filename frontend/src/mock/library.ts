import type { Claim, Document, Provenance } from '../types'
import snapshot from './library.json'

// A snapshot of the real Papiers library (backend/data/library_cache.json, summaries included), used when the
// backend is not running. The live library streams from GET /api/library/stream and has the same ids.
export const documents = snapshot.documents as Document[]
export const claims = snapshot.claims as Claim[]

const claim = (id: string) => claims.find((c) => c.id === id)!
const highlight = (id: string): Provenance => claim(id).provenance[0]
const note = (id: string): Provenance => claim(id).provenance.find((p) => p.kind === 'note')!

const ID = {
  mix: 'hl_0c73f204787e1043e26d4b984a8756c2', bot: 'hl_07db8d8d60e86170dda2cc24919b3c35', tta: 'hl_193fdd44b77cd074275ad6e176c7012a',
  flip: 'hl_f00e337c8a98ab91885e251883ed6dd3', ls: 'hl_550c437bfcb2078e75f1d6b912bc3f7f', whiten: 'hl_7cc061c7463f10a7ec432d498aac2595',
  dirac: 'hl_62d0d70418d9076750cb2eada98e208e', distil: 'hl_4e2b627ef691ff5db03de84f431f570e',
}

export const P = {
  mix: highlight(ID.mix), mixNote: note(ID.mix),
  bot: highlight(ID.bot), botNote: note(ID.bot),
  tta: highlight(ID.tta), ttaNote: note(ID.tta),
  flip: highlight(ID.flip), flipNote: note(ID.flip),
  ls: highlight(ID.ls), lsNote: note(ID.ls),
  whiten: highlight(ID.whiten),
  dirac: highlight(ID.dirac),
  distil: highlight(ID.distil), distilNote: note(ID.distil),
}
