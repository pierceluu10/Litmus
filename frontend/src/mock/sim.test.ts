import { describe, expect, it } from 'vitest'
import { BASELINE_ACC, BASELINE_KNOBS, expectedAccuracy, grade, simulateRun, verdict } from './sim'

const at = (changes: object) => expectedAccuracy({ ...BASELINE_KNOBS, ...changes })
const runs = (changes: object, seeds = [0, 1, 2, 3, 4]) => seeds.map((s) => simulateRun({ ...BASELINE_KNOBS, ...changes }, s).tta_val_acc!)

describe('simulated airbench', () => {
  it('reproduces the effects measured on Modal (within 0.1 pts)', () => {
    const measured: [object, object, number][] = [
      [{ mixup_alpha: 1 }, {}, -0.0144], [{ mixup_alpha: 0.2 }, {}, -0.0026], [{ tta_level: 0 }, {}, -0.0075],
      [{ whiten: false }, {}, -0.0148], [{ dirac_init: false }, {}, -0.0054],
      [{ mixup_alpha: 0.2, epochs: 30 }, { epochs: 30 }, 0.0022], [{ mixup_alpha: 0.2, epochs: 20 }, { epochs: 20 }, 0.0015],
    ]
    for (const [child, parent, delta] of measured) expect(at(child) - at(parent)).toBeCloseTo(delta, 3)
    expect(at({})).toBe(BASELINE_ACC)
  })
  it('seeds vary like real runs (baseline sd 0.03–0.2 pts)', () => {
    const xs = runs({}, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), m = xs.reduce((a, b) => a + b) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
    console.log('baseline seeds', xs, 'sd', sd)
    expect(sd).toBeGreaterThan(0.0003)
    expect(sd).toBeLessThan(0.002)
  })
  it('is deterministic per config and seed', () => {
    expect(simulateRun(BASELINE_KNOBS, 3)).toEqual(simulateRun(BASELINE_KNOBS, 3))
  })
})

describe('grader port', () => {
  it('t-interval matches the backend on a known case', () => {
    // diffs −0.01, −0.012, −0.011, −0.013, −0.009: mean −0.011, sd 0.00158, t(4) = 2.776 → half-width 0.00196
    const g = grade([0.94, 0.94, 0.94, 0.94, 0.94], [0.93, 0.928, 0.929, 0.927, 0.931], 'improves')
    expect(g.delta).toBeCloseTo(-0.011, 6)
    expect(g.ci_high - g.delta).toBeCloseTo(0.00196, 5)
    expect(g.verdict).toBe('refuted')
    expect(g.p_value).toBeLessThan(0.001)
  })
  it('pairing detects the real mixup refutation at 5 seeds', () => {
    const g = grade(runs({}), runs({ mixup_alpha: 1 }), 'improves')
    console.log('mixup α=1', g.delta, g.ci_low, g.ci_high)
    expect(g.verdict).toBe('refuted')
    expect(g.ci_high - g.ci_low).toBeGreaterThan(0.001) // real: [−1.71, −1.17]
  })
  it('verdicts are relative to the prediction', () => {
    expect(verdict('hurts', -0.007, -0.009, -0.005)).toBe('confirmed')
    expect(verdict('no_effect', 0.0001, -0.001, 0.0012)).toBe('confirmed')
    expect(verdict('improves', 0.001, -0.0002, 0.0022)).toBe('inconclusive')
  })
})
