import { describe, expect, it } from 'vitest'
import { codeLanguageForInfo, codeLanguageInputValue, codeLanguageOptions, codeLanguageSuggestions } from './code-languages'

describe('code language catalogue and Typora compatibility', () => {
  it('uses the installed parser catalogue and resolves every offered language', () => {
    expect(codeLanguageOptions.length).toBeGreaterThan(100)
    expect(new Set(codeLanguageOptions.map(option => option.value)).size).toBe(codeLanguageOptions.length)
    for (const option of codeLanguageOptions) expect(codeLanguageForInfo(option.value)?.name).toBe(option.name)
  })
  it.each([
    ['pYtHoN', 'Python'], ['py', 'Python'], ['JSON', 'JSON'], ['htmlmixed', 'HTML'],
    ['md', 'Markdown'], ['gfm', 'Markdown'], ['js', 'JavaScript'], ['text/javascript', 'JavaScript'],
    ['cpp', 'C++'], ['csharp', 'C#'], ['bash', 'Shell'], ['golang', 'Go'],
    ['mssql', 'MS SQL'], ['mariadb', 'MariaDB SQL'], ['commonlisp', 'Common Lisp'],
    ['matlab', 'Octave'], ['react', 'JSX'], ['vue.js', 'Vue'], ['ini', 'Properties files'],
  ])('resolves %s to %s', (input, name) => expect(codeLanguageForInfo(input)?.name).toBe(name))
  it('filters case-insensitive prefixes and matches aliases without substring false positives', () => {
    expect(codeLanguageSuggestions('Py').map(option => option.name)).toEqual(['Python'])
    expect(codeLanguageSuggestions('js').map(option => option.name)).toEqual(['JavaScript', 'JSON', 'JSON-LD', 'JSX'])
    expect(codeLanguageForInfo('not-python')).toBeNull()
    expect(codeLanguageSuggestions('qtypora_unknown_language')).toEqual([])
    expect(codeLanguageForInfo('')).toBeNull()
  })
  it('converts known multiword display names to single Markdown language tokens', () => {
    expect(codeLanguageInputValue(' Common Lisp ')).toBe('commonlisp')
    expect(codeLanguageInputValue('MS SQL')).toBe('mssql')
    expect(codeLanguageInputValue('Python')).toBe('Python')
    expect(codeLanguageInputValue('custom-language')).toBe('custom-language')
    expect(codeLanguageInputValue('`py\nthon')).toBe('python')
  })
})
