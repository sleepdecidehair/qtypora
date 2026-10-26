import { describe, expect, it } from 'vitest'
import { createTextSearch, findTextMatches } from './search'

describe('shared directory search', () => {
  it('supports whole Unicode words without treating punctuation as part of a word', () => {
    expect(findTextMatches('cat scatter cat_ cat中文 cat.', 'cat', false, { wholeWord: true })).toEqual([{ from: 0, to: 3 }, { from: 23, to: 26 }])
    expect(findTextMatches('中文 中 中文章', '中文', false, { wholeWord: true })).toEqual([{ from: 0, to: 2 }])
  })
  it('supports alternatives, captures, repetitions, anchors and non-BMP offsets', () => {
    expect(findTextMatches('😊 TASK-12 task-5 other', '(task|TASK)-\\d+', true, { regex: true })).toEqual([{ from: 3, to: 10 }, { from: 11, to: 17 }])
    expect(createTextSearch('^$', { regex: true }).test('')).toBe(true)
    expect(createTextSearch('^task-\\d+$', { regex: true }).test('TASK-14')).toBe(true)
  })
  it('returns a clear error for unsupported regex and completes adversarial repetition', () => {
    expect(() => createTextSearch('(', { regex: true })).toThrow('正则表达式无效')
    expect(() => createTextSearch('(a)\\1', { regex: true })).toThrow('正则表达式无效')
    expect(createTextSearch('(a+)+$', { regex: true }).test('a'.repeat(100_000) + '!')).toBe(false)
  })
  it('retains original Unicode offsets and bounds result allocations', () => {
    expect(findTextMatches('İ xx İ', 'i')).toEqual([{ from: 0, to: 1 }, { from: 5, to: 6 }])
    expect(findTextMatches('xİ xİ', 'x')).toEqual([{ from: 0, to: 1 }, { from: 3, to: 4 }])
    expect(findTextMatches('xİx xİx', 'x')).toEqual([{ from: 0, to: 1 }, { from: 2, to: 3 }, { from: 4, to: 5 }, { from: 6, to: 7 }])
    expect(createTextSearch('i').find('İ'.repeat(100_000), 5000)).toHaveLength(5000)
    expect(findTextMatches('ΟΣ ος οσ', 'ος')).toEqual([{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 8 }])
    expect(createTextSearch('a').find('a'.repeat(100), 2)).toHaveLength(2)
  })
})
