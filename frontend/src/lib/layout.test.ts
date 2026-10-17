import { describe, expect, it } from 'vitest'
import { COLUMN, FIRST_STEP, layoutStars, STEP, UNITS_PER_POINT } from './layout'
import type { Grade, Star } from '../types'

const g = (mean_child: number): Grade => ({ metric: 'tta_val_acc', mean_parent: 0.94, mean_child, delta: 0, sd_parent: 0, sd_child: 0, n: 5, ci_low: 0, ci_high: 0, p_value: 1, verdict: 'confirmed', practical: true, grader_version: '1' })
const star = (id: string, parent_id: string | null, extra: Partial<Star> = {}) => ({ id, parent_id, status: 'done', knob_changes: {}, ...extra }) as Star

describe('layoutStars', () => {
  const stars = [star('S0', null, { grade: g(0.94) }), star('S1', 'S0', { grade: g(0.93) }), star('S2', 'S0', { status: 'running' }), star('S3', 'S2')]
  const pos = layoutStars(stars)
  it('height is accuracy relative to the baseline', () => {
    expect(pos.get('S0')).toEqual({ x: FIRST_STEP, y: 0, z: 0 })
    expect(pos.get('S1')!.y).toBeCloseTo(-UNITS_PER_POINT, 6)
  })
  it('ungraded stars ride at their parent height', () => {
    expect(pos.get('S2')!.y).toBe(0)
    expect(pos.get('S3')!.y).toBe(pos.get('S2')!.y)
  })
  it('generations step right and siblings take their own columns', () => {
    expect(pos.get('S1')!.x).toBe(FIRST_STEP + STEP)
    expect(pos.get('S2')!.x).toBe(FIRST_STEP + STEP + COLUMN)
    expect(pos.get('S3')!.x).toBe(pos.get('S2')!.x + STEP)
    expect(pos.get('S1')!.z).toBe(-pos.get('S2')!.z)
  })
})
