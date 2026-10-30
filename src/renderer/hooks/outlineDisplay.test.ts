import { describe, expect, it } from 'vitest'
import { currentOutlineLine, outlineAncestors, outlineMatchRange, outlineRows } from './outlineDisplay'

const headings = [{ level: 1, line: 1, text: 'Top' }, { level: 2, line: 3, text: 'First' }, { level: 3, line: 5, text: 'Deep' }, { level: 2, line: 7, text: 'Second' }, { level: 1, line: 9, text: 'Last' }]

describe('outline navigation model', () => {
  it('locates the first case-insensitive match on whole Unicode characters', () => {
    expect(outlineMatchRange('Alpha ALPHA', 'alpha')).toEqual({ from: 0, to: 5 })
    expect(outlineMatchRange('章节😀 章节', '😀')).toEqual({ from: 2, to: 4 })
    expect(outlineMatchRange('İstanbul', 'i')).toEqual({ from: 0, to: 1 })
    expect(outlineMatchRange('ΟΣ', 'ος')).toEqual({ from: 0, to: 2 })
    expect(outlineMatchRange('章节', ' ')).toBeNull()
  })
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
  it('displays all descendants in flat mode and preserves the collapse state', () => {
    const collapsed = new Set([1, 3])
    expect(outlineRows(headings, collapsed, '', true).map(row => row.heading.line)).toEqual([1, 3, 5, 7, 9])
    expect(outlineRows(headings, collapsed, 'deep', true).map(row => row.heading.line)).toEqual([5])
    expect(outlineRows(headings, collapsed).map(row => row.heading.line)).toEqual([1, 9])
  })
  it('identifies only the parent chain of the active heading', () => {
    expect(outlineAncestors(headings, 5)).toEqual([3, 1])
    expect(outlineAncestors(headings, 7)).toEqual([1])
    expect(outlineAncestors(headings, 9)).toEqual([])
    expect(outlineAncestors(headings, null)).toEqual([])
  })
})
