import { describe, expect, it } from 'vitest'
import { currentOutlineLine, outlineRows } from './outlineDisplay'

const headings = [{ level: 1, line: 1, text: 'Top' }, { level: 2, line: 3, text: 'First' }, { level: 3, line: 5, text: 'Deep' }, { level: 2, line: 7, text: 'Second' }, { level: 1, line: 9, text: 'Last' }]

describe('outline navigation model', () => {
  it('collapses descendants until the next sibling and preserves chapter numbering', () => {
    const rows = outlineRows(headings, new Set([3]))
    expect(rows.map(row => row.heading.line)).toEqual([1, 3, 7, 9])
    expect(rows.map(row => row.number)).toEqual(['1', '1.1', '1.2', '2'])
  })
  it('finds a filtered descendant of a collapsed branch and the active predecessor', () => {
    expect(outlineRows(headings, new Set([1]), 'deep').map(row => row.heading.line)).toEqual([5])
    expect(currentOutlineLine(headings, 6)).toBe(5)
    expect(currentOutlineLine(headings, 0)).toBeNull()
  })
})
