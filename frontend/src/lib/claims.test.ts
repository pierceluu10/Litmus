import { describe, expect, it } from 'vitest'
import { claimNumber, claimOf } from './format'
import type { Claim, Provenance } from '../types'

const claim = (id: string) => ({ id, text: id, doc_id: 'd', doc_title: 'd', weight: 1, rank: 1, provenance: [] }) as Claim
const prov = (id: string, kind: Provenance['kind'] = 'highlight') => ({ kind, id, text: '' }) as Provenance

describe('claim numbers', () => {
  const claims = [claim('hl_a'), claim('hl_b'), claim('hl_c')]
  it('numbers a claim by its place in the library, from 1', () => {
    expect(claimNumber(claims, 'hl_c')).toBe(3)
  })
  it('finds the claim a proposal steers to, through a note on it, skipping provenance that is not a claim', () => {
    expect(claimOf(claims, [prov('dec_1', 'human'), prov('hl_b#annotation', 'note')])).toEqual({ claim: claims[1], n: 2 })
    expect(claimOf(claims, [prov('dec_1', 'human')])).toBeNull()
  })
})
