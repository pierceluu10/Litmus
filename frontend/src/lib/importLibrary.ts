import type { Claim, Document } from '../types'

export type Library = { documents: Document[]; claims: Claim[] }
export type Source = { name: string; text: string }

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, '0') }
const DEFAULT_PAPER = 'Pasted notes'

type Raw = { id: string; text: string; note?: string; docId?: string; docTitle?: string; page?: number; note_only?: boolean }

// Papiers CLI output (`papiers list` / `papiers read`, schema papiers.list.v1 and papiers.read.v1), merged by id.
function fromPapiers(json: any, docs: Map<string, Document>, raws: Map<string, Raw>) {
  for (const it of json.items ?? []) {
    const m = it.metadata ?? {}
    if (it.kind === 'document') {
      docs.set(it.id, { id: it.id, title: it.title ?? m.title ?? it.id, authors: m.authors ?? [], year: m.publishedYear ?? undefined, url: it.source?.url, highlight_count: 0, note_count: 0, papiers_url: it.source?.url })
    } else if (it.kind === 'highlight' || it.kind === 'note') {
      if (it.ok === false) continue
      const text = (it.content ?? it.preview ?? '').trim()
      if (!text) continue
      const known = raws.get(it.id)
      // a `read` has the full text and the note; a `list` only has a preview, so it never overwrites one
      if (known && it.content === undefined) continue
      raws.set(it.id, { id: it.id, text, note: m.annotationText || undefined, docId: it.documentId ?? m.documentId, docTitle: m.documentTitle ?? it.title, page: m.pageNumber ?? undefined, note_only: it.kind === 'note' })
    }
  }
}

// Plain text or markdown: a blank line starts a new passage, "# Paper" names the paper, "Note: ..." is your note.
function fromText(text: string, raws: Map<string, Raw>) {
  let paper = DEFAULT_PAPER
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const body: string[] = []
    let note: string | undefined
    for (const l of lines) {
      const h = l.match(/^#{1,6}\s+(.+)/)
      if (h) { paper = h[1].trim(); continue }
      const n = l.match(/^(?:note|my note)\s*[:—-]\s*(.+)/i)
      if (n) { note = n[1].trim(); continue }
      body.push(l.replace(/^(?:>|[-*•])\s*/, ''))
    }
    const passage = body.join(' ').trim()
    if (!passage) continue
    const id = `hl_${hash(passage)}`
    raws.set(id, { id, text: passage, note, docId: `doc_${hash(paper)}`, docTitle: paper })
  }
}

export function parseLibrary(sources: Source[]): Library & { skipped: string[] } {
  const docs = new Map<string, Document>()
  const raws = new Map<string, Raw>()
  const skipped: string[] = []
  for (const { name, text } of sources) {
    const t = text.trim()
    if (!t) continue
    if (/^[[{]/.test(t)) {
      try {
        const json = JSON.parse(t)
        if (Array.isArray(json.claims)) {
          // already a Litmus library (the shape /api/library returns)
          for (const d of json.documents ?? []) docs.set(d.id, d)
          for (const c of json.claims) raws.set(c.id, { id: c.id, text: c.text, note: c.annotation, docId: c.doc_id, docTitle: c.doc_title, page: c.page })
        } else if (Array.isArray(json.items)) fromPapiers(json, docs, raws)
        else skipped.push(`${name}: not a Papiers export`)
      } catch { skipped.push(`${name}: not valid JSON`) }
    } else fromText(t, raws)
  }
  // documents come from the list export when there is one, otherwise from the highlights themselves
  for (const r of raws.values()) {
    const id = r.docId ?? `doc_${hash(r.docTitle ?? DEFAULT_PAPER)}`
    r.docId = id
    if (!docs.has(id)) docs.set(id, { id, title: r.docTitle ?? DEFAULT_PAPER, authors: [], highlight_count: 0, note_count: 0 })
  }
  const claims: Claim[] = [...raws.values()].map((r) => {
    const d = docs.get(r.docId!)!
    const weight = r.note ? 3 : r.note_only ? 2.5 : 2
    return {
      id: r.id, text: r.text, doc_id: d.id, doc_title: d.title, annotation: r.note, weight, rank: 0, page: r.page,
      provenance: [{ kind: r.note_only ? 'note' as const : 'highlight' as const, id: r.id, doc_id: d.id, doc_title: d.title, text: r.text, papiers_url: d.papiers_url }],
    }
  }).sort((a, b) => b.weight - a.weight).map((c, i) => ({ ...c, rank: i + 1 }))
  for (const d of docs.values()) {
    d.highlight_count = claims.filter((c) => c.doc_id === d.id && c.provenance[0].kind === 'highlight').length
    d.note_count = claims.filter((c) => c.doc_id === d.id && c.annotation).length
  }
  return { documents: [...docs.values()].filter((d) => claims.some((c) => c.doc_id === d.id)), claims, skipped }
}
