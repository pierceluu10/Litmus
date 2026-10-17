import { describe, expect, it } from 'vitest'
import { FIRST_STEP, LAYER_GAP, layoutStars, SLOT_GAP } from './layout'
import type { Star } from '../types'

const star = (id: string, parent_id: string | null, extra: Partial<Star> = {}) => ({ id, parent_id, status: 'done', knob_changes: {}, ...extra }) as Star

describe('layoutStars (neural-network layers)', () => {
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
  it('steps each generation one layer to the right', () => {
    expect(pos.get('S5')!.x).toBe(FIRST_STEP + 2 * LAYER_GAP)
    expect(pos.get('S5')!.y).toBe(0)
  })
  it('does not depend on accuracy or status', () => {
    const again = layoutStars(stars.map((s) => ({ ...s, status: 'running' }) as Star))
    expect(again.get('S3')).toEqual(pos.get('S3'))
  })
})
