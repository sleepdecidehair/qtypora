import { describe, expect, it, vi } from 'vitest'
import { SessionSpelling } from './spelling'

describe('current-window spelling suggestions', () => {
  it('suppresses suggestions without falsifying native spelling or changing another window', () => {
    const frame = { isWordMisspelled: vi.fn(() => true), getWordSuggestions: vi.fn(() => ['hello']) }
    const first = new SessionSpelling(), second = new SessionSpelling()
    expect(first.ignore('Helo')).toEqual(['Helo'])
    expect(first.read(frame, 'helo')).toEqual({ word: 'helo', misspelled: true, suggestions: [], ignored: true })
    expect(frame.getWordSuggestions).not.toHaveBeenCalled()
    expect(second.read(frame, 'helo')).toEqual({ word: 'helo', misspelled: true, suggestions: ['hello'] })
    first.restore('HELO')
    expect(first.read(frame, 'helo').suggestions).toEqual(['hello'])
  })

  it('normalizes equivalent Unicode spellings and resets with a new preload instance', () => {
    const session = new SessionSpelling()
    session.ignore('E\u0301cole')
    expect(session.ignore('école')).toEqual(['École'])
    expect(new SessionSpelling().list()).toEqual([])
    const list = session.list()
    list.push('external')
    expect(session.list()).toEqual(['École'])
    expect(session.clear()).toEqual([])
    expect(session.list()).toEqual([])
  })

  it('rejects invalid or unbounded input and preserves existing entries at capacity', () => {
    const session = new SessionSpelling()
    for (const value of ['', 'two words', 'word\0', 1, null, 'a'.repeat(129)]) {
      expect(() => session.ignore(value)).toThrow()
      expect(() => session.restore(value)).toThrow()
    }
    for (let index = 0; index < 500; index++) session.ignore(`word${String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26)}`)
    expect(session.ignore('wordaa')).toHaveLength(500)
    expect(() => session.ignore('overflow')).toThrow('500')
    expect(session.list()).toHaveLength(500)
    session.restore('wordaa')
    expect(session.ignore('overflow')).toHaveLength(500)
  })
})
