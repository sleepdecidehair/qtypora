import { describe, expect, it } from 'vitest'
import { containResource } from './resource-fit'

describe('complete resource fit in the visible editor region', () => {
  it('contains a wide diagram without horizontal clipping or changing its ratio', () => {
    const fit = containResource({ width: 2734, height: 643 }, { width: 736, height: 618 })
    expect(fit.width).toBe(736)
    expect(fit.height).toBeLessThan(618)
    expect(fit.width / fit.height).toBeCloseTo(2734 / 643)
  })
  it('contains a tall graph and keeps its entire height visible', () => {
    const fit = containResource({ width: 2012, height: 2110 }, { width: 736, height: 618 })
    expect(fit.height).toBe(618)
    expect(fit.width).toBeLessThan(736)
    expect(fit.width / fit.height).toBeCloseTo(2012 / 2110)
  })
  it('retains small images at their intrinsic size and tolerates resources not loaded yet', () => {
    expect(containResource({ width: 160, height: 80 }, { width: 736, height: 618 })).toEqual({ width: 160, height: 80 })
    expect(containResource({ width: 0, height: 0 }, { width: 736, height: 618 })).toEqual({ width: 0, height: 0 })
  })
  it('enlarges a standalone photo to available width while preserving its full height', () => {
    expect(containResource({ width: 160, height: 80 }, { width: 736, height: 618 }, true)).toEqual({ width: 736, height: 368 })
  })
  it('limits enlargement of a portrait photo by the visible height', () => {
    expect(containResource({ width: 80, height: 160 }, { width: 736, height: 618 }, true)).toEqual({ width: 309, height: 618 })
  })
  it('does not enlarge a large photo past either boundary and rejects invalid dimensions', () => {
    const fit = containResource({ width: 2400, height: 1600 }, { width: 1000, height: 618 }, true)
    expect(fit.height).toBe(618)
    expect(fit.width).toBeLessThan(1000)
    expect(fit.width / fit.height).toBeCloseTo(1.5)
    expect(containResource({ width: NaN, height: 10 }, { width: 1000, height: 618 }, true)).toEqual({ width: 0, height: 0 })
  })
})
