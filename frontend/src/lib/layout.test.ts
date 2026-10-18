import { describe, expect, it } from 'vitest'
import { FIRST_STEP, LAYER_GAP, layoutStars, MIN_GAP, UNITS_PER_POINT } from './layout'
import type { Star } from '../types'

const star = (id: string, parent_id: string | null, acc?: number) =>
  ({ id, parent_id, status: acc === undefined ? 'running' : 'done', knob_changes: {}, grade: acc === undefined ? undefined : { mean_child: acc } }) as unknown as Star

describe('layoutStars (layers, height = accuracy)', () => {
  const stars = [star('S0', null, 0.94), star('S1', 'S0', 0.9255), star('S2', 'S0', 0.9502), star('S3', 'S0', 0.94 - 0.0068)]
  const pos = layoutStars(stars)
  it('puts the baseline at the first step, level with the fingertip', () => {
    expect(pos.get('S0')).toEqual({ x: FIRST_STEP, y: 0, z: 0 })
  })
  it('puts every star of a generation in one column', () => {
    expect(new Set(['S1', 'S2', 'S3'].map((id) => pos.get(id)!.x))).toEqual(new Set([FIRST_STEP + LAYER_GAP]))
  })
  it('orders a column by accuracy, higher accuracy higher', () => {
    expect(pos.get('S2')!.y).toBeGreaterThan(pos.get('S3')!.y)
    expect(pos.get('S3')!.y).toBeGreaterThan(pos.get('S1')!.y)
  })
  it('scales height with the accuracy difference when stars are far enough apart', () => {
    const two = layoutStars([star('S0', null, 0.94), star('S1', 'S0', 0.95)])
    expect(two.get('S1')!.y).toBeCloseTo(UNITS_PER_POINT * 1)
  })
  it('keeps close stars a minimum gap apart without changing their order', () => {
    const close = layoutStars([star('S0', null, 0.94), star('S1', 'S0', 0.9401), star('S2', 'S0', 0.9402), star('S3', 'S0', 0.9399)])
    const ys = ['S2', 'S1', 'S3'].map((id) => close.get(id)!.y)
    expect(ys[0] - ys[1]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9)
    expect(ys[1] - ys[2]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9)
  })
  it('keeps a training star level with its parent until it is graded', () => {
    const p = layoutStars([star('S0', null, 0.94), star('S1', 'S0', 0.95), star('S2', 'S1')])
    expect(p.get('S2')!.y).toBe(p.get('S1')!.y)
    expect(p.get('S2')!.x).toBe(FIRST_STEP + 2 * LAYER_GAP)
  })
})
