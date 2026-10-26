import { describe, expect, it, vi } from 'vitest'
import { forgetSpelling, learnSpelling, listSpellingWords, spellingWord } from './spelling'
import { readSpelling } from '../shared/spelling'

describe('native spelling service', () => {
  it('only asks the active spellchecker for bounded distinct suggestions', () => {
    const contents = { isWordMisspelled: vi.fn(() => true), getWordSuggestions: vi.fn(() => ['hello', 'hello', 'help', 'he\nlo', 'a'.repeat(129), 'halo', 'hell', 'held', 'heel']) }
    expect(readSpelling(contents, 'helo')).toEqual({ word: 'helo', misspelled: true, suggestions: ['hello', 'help', 'halo', 'hell', 'held'] })
    contents.isWordMisspelled.mockReturnValue(false)
    contents.getWordSuggestions.mockClear()
    expect(readSpelling(contents, 'helo')).toEqual({ word: 'helo', misspelled: false, suggestions: [] })
    expect(contents.getWordSuggestions).not.toHaveBeenCalled()
  })
  it('rejects document fragments and control characters while allowing accented compounds', () => {
    for (const word of ['', 'two words', 'word\0', '<word>', 'a'.repeat(129)]) expect(() => spellingWord(word)).toThrow()
    expect(spellingWord('d’accord')).toBe('d’accord')
    expect(spellingWord('well-known')).toBe('well-known')
    expect(spellingWord('e\u0301cole')).toBe('e\u0301cole')
  })
  it('reports persistence failures and lists custom words without changing the dictionary', async () => {
    const session = { addWordToSpellCheckerDictionary: vi.fn(() => true), removeWordFromSpellCheckerDictionary: vi.fn(() => true), listWordsInSpellCheckerDictionary: vi.fn(async () => ['Typora', 'Codex', 'Typora']) }
    learnSpelling(session, 'Typora'); forgetSpelling(session, 'Typora')
    expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('Typora')
    expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith('Typora')
    expect(await listSpellingWords(session)).toEqual(['Codex', 'Typora'])
    session.addWordToSpellCheckerDictionary.mockReturnValue(false)
    expect(() => learnSpelling(session, 'Typora')).toThrow('无法将单词保存')
    session.removeWordFromSpellCheckerDictionary.mockReturnValue(false)
    expect(() => forgetSpelling(session, 'Typora')).toThrow('无法从自定义词典移除')
  })
})
