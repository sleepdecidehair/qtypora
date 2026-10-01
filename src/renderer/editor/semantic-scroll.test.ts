import { describe, expect, it } from 'vitest'
import { anchorProgress, progressAnchor } from './semantic-scroll'

describe('semantic source and reading scroll anchors', () => {
  it('maps a source line inside a multi-line diagram to the corresponding rendered proportion', () => {
    const range = { start: 20, end: 24 }
    expect(anchorProgress({ line: 22, fraction: 0.5 }, range)).toBe(0.5)
    expect(progressAnchor(range, 0.5)).toEqual({ line: 22, fraction: 0.5 })
  })
  it('preserves the partial visible height of a wrapped single-line paragraph', () => {
    const range = { start: 8, end: 8 }
    expect(anchorProgress({ line: 8, fraction: 0.75 }, range)).toBe(0.75)
    expect(progressAnchor(range, 0.75)).toEqual({ line: 8, fraction: 0.75 })
  })
  it('clamps gaps and document boundaries without inventing a line outside the block', () => {
    const range = { start: 3, end: 6 }
    expect(anchorProgress({ line: 1, fraction: 0 }, range)).toBe(0)
    expect(anchorProgress({ line: 99, fraction: 0 }, range)).toBe(1)
    expect(progressAnchor(range, 1)).toEqual({ line: 6, fraction: 1 })
    expect(progressAnchor(range, -1)).toEqual({ line: 3, fraction: 0 })
  })
})
