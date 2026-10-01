import { describe, expect, it } from 'vitest'
import { findTextMatches } from './reading-search'

describe('reading plain text search', () => {
  it('treats regex syntax as literal text and finds non-overlapping matches', () => {
    expect(findTextMatches('x.*y and x.*y', '.*')).toEqual([{ from: 1, to: 3 }, { from: 10, to: 12 }])
    expect(findTextMatches('aaa', 'aa')).toEqual([{ from: 0, to: 2 }])
  })
  it('preserves source offsets when Unicode case folding expands a letter', () => {
    expect(findTextMatches('İ xx İ', 'i')).toEqual([{ from: 0, to: 1 }, { from: 5, to: 6 }])
    expect(findTextMatches('İ xx İ', 'İ')).toEqual([{ from: 0, to: 1 }, { from: 5, to: 6 }])
  })
  it('folds the text and query consistently for uppercase, medial and final Greek Sigma', () => {
    expect(findTextMatches('ΟΣ', 'ΟΣ')).toEqual([{ from: 0, to: 2 }])
    expect(findTextMatches('ΟΣ ος οσ', 'ος')).toEqual([{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 8 }])
    expect(findTextMatches('ΟΣ ος οσ', 'ΟΣ', true)).toEqual([{ from: 0, to: 2 }])
  })
  it('supports Chinese and emoji without splitting their original offsets', () => {
    expect(findTextMatches('中文😊和中文😊', '中文😊')).toEqual([{ from: 0, to: 4 }, { from: 5, to: 9 }])
  })
  it('supports explicit case-sensitive search and an empty query', () => {
    expect(findTextMatches('Word word WORD', 'word', true)).toEqual([{ from: 5, to: 9 }])
    expect(findTextMatches('Word word WORD', 'word')).toHaveLength(3)
    expect(findTextMatches('unchanged', '')).toEqual([])
  })
})
