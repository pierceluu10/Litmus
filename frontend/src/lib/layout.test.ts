import { describe, expect, it } from 'vitest'
import { FIRST_STEP, LAYER_GAP, layoutStars, SLOT_GAP } from './layout'
import type { Star } from '../types'

const star = (id: string, parent_id: string | null, extra: Partial<Star> = {}) => ({ id, parent_id, status: 'done', knob_changes: {}, ...extra }) as Star

describe('layoutStars (layers, tidy tree)', () => {
  const stars = [star('S0', null), star('S1', 'S0'), star('S2', 'S0'), star('S3', 'S0'), star('S4', 'S0'), star('S5', 'S2')]
  const pos = layoutStars(stars)
  it('puts the baseline at the first step, level with the fingertip', () => {
    expect(pos.get('S0')).toEqual({ x: FIRST_STEP, y: 0, z: 0 })
  })
  it('stacks siblings in one column, evenly spaced and centred on the baseline', () => {
    const ys = ['S1', 'S2', 'S3', 'S4'].map((id) => pos.get(id)!.y)
    expect(new Set(['S1', 'S2', 'S3', 'S4'].map((id) => pos.get(id)!.x))).toEqual(new Set([FIRST_STEP + LAYER_GAP]))
    expect(ys).toEqual([1.5 * SLOT_GAP, 0.5 * SLOT_GAP, -0.5 * SLOT_GAP, -1.5 * SLOT_GAP])
  })
  it('steps each generation one layer to the right, level with its parent', () => {
    expect(pos.get('S5')!.x).toBe(FIRST_STEP + 2 * LAYER_GAP)
    expect(pos.get('S5')!.y).toBe(pos.get('S2')!.y)
  })
  it('centres a parent on its children and keeps subtrees from overlapping', () => {
    const p2 = layoutStars([...stars, star('S6', 'S2')])
    expect(p2.get('S2')!.y).toBe((p2.get('S5')!.y + p2.get('S6')!.y) / 2)
    expect(p2.get('S6')!.y).toBeGreaterThan(p2.get('S3')!.y) // S2's children sit between S1 and S3
    expect(p2.get('S0')!.y).toBe(0)
    const column = ['S1', 'S2', 'S3', 'S4'].map((id) => p2.get(id)!.y)
    expect(column).toEqual([...column].sort((a, b) => b - a))
  })
  it('does not depend on accuracy or status', () => {
    const again = layoutStars(stars.map((s) => ({ ...s, status: 'running' }) as Star))
    expect(again.get('S3')).toEqual(pos.get('S3'))
  })
})
