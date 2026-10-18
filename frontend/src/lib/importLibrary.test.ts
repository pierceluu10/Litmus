import docs from '../../../backend/tests/fixtures/papiers/list_documents.json?raw'
import list from '../../../backend/tests/fixtures/papiers/list_highlights.json?raw'
import read from '../../../backend/tests/fixtures/papiers/read_highlights.json?raw'
import { describe, expect, it } from 'vitest'
import { parseLibrary } from './importLibrary'

describe('parseLibrary', () => {
  it('merges a Papiers list and read export, keeping notes and ranking annotated highlights first', () => {
    const lib = parseLibrary([{ name: 'docs', text: docs }, { name: 'list', text: list }, { name: 'read', text: read }])
    expect(lib.claims.length).toBeGreaterThan(0)
    expect(lib.documents.length).toBeGreaterThan(0)
    const annotated = lib.claims.filter((c) => c.annotation)
    expect(annotated.length).toBeGreaterThan(0)
    expect(lib.claims[0].annotation).toBeTruthy()
    expect(lib.claims.map((c) => c.rank)).toEqual(lib.claims.map((_, i) => i + 1))
    expect(new Set(lib.claims.map((c) => c.id)).size).toBe(lib.claims.length)
  })
  it('reads pasted text with paper headings and notes', () => {
    const lib = parseLibrary([{ name: 'paste', text: '# Mixup paper\n> Mixup helps long runs.\nNote: we train for 10 epochs\n\nLabel smoothing is a regulariser.' }])
    expect(lib.claims).toHaveLength(2)
    expect(lib.claims[0]).toMatchObject({ text: 'Mixup helps long runs.', annotation: 'we train for 10 epochs', doc_title: 'Mixup paper', weight: 3 })
    expect(lib.documents[0]).toMatchObject({ highlight_count: 2, note_count: 1 })
  })
  it('reports files it cannot read', () => {
    expect(parseLibrary([{ name: 'a.json', text: '{oops' }]).skipped).toEqual(['a.json: not valid JSON'])
    expect(parseLibrary([{ name: 'b.json', text: '{"x":1}' }]).skipped).toEqual(['b.json: not a Papiers export'])
  })
})
