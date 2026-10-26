import { RE2JS } from 're2js'

export interface TextMatch { from: number; to: number }
export interface TextSearchOptions { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }
export interface TextSearch { find: (text: string, limit?: number) => TextMatch[]; test: (text: string) => boolean }

function foldCharacter(character: string): string {
  const lower = character.toLocaleLowerCase()
  return lower === '\u03c2' ? '\u03c3' : lower
}

function wordBoundary(text: string, from: number, to: number): boolean {
  const before = Array.from(text.slice(Math.max(0, from - 2), from)).at(-1) ?? ''
  const after = String.fromCodePoint(text.codePointAt(to) ?? 32)
  return !/[\p{L}\p{N}\p{M}_]/u.test(before) && !/[\p{L}\p{N}\p{M}_]/u.test(after)
}

export function createTextSearch(query: string, options: TextSearchOptions = {}): TextSearch {
  if (query.length > 256) throw new Error('搜索关键字最长 256 字符。')
  let expression: RE2JS | undefined
  if (query && options.regex) {
    try { expression = RE2JS.compile(query, options.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE) }
    catch (error) { throw new Error(`正则表达式无效：${error instanceof Error ? error.message : '语法错误'}。正则搜索不支持反向引用或前瞻。`) }
  }
  const find = (text: string, limit = 5000): TextMatch[] => {
    if (!query || limit <= 0) return []
    const matches: TextMatch[] = []
    const accept = (from: number, to: number) => {
      if (!options.wholeWord || wordBoundary(text, from, to)) matches.push({ from, to })
    }
    if (expression) {
      const matcher = expression.matcher(text)
      while (matches.length < limit && matcher.find()) accept(matcher.start(), matcher.end())
      return matches
    }
    if (options.caseSensitive) {
      for (let cursor = 0; cursor <= text.length - query.length && matches.length < limit;) {
        const from = text.indexOf(query, cursor)
        if (from === -1) break
        accept(from, from + query.length)
        cursor = from + query.length
      }
      return matches
    }
    const foldedText = text.toLocaleLowerCase().replaceAll('\u03c2', '\u03c3')
    const foldedQuery = Array.from(query, foldCharacter).join('')
    const expansions: { start: number; end: number; original: number; length: number }[] = []
    if (foldedText.length !== text.length) {
      let foldedOffset = 0
      let original = 0
      for (const character of text) {
        const folded = foldCharacter(character)
        if (folded.length !== character.length) expansions.push({ start: foldedOffset, end: foldedOffset + folded.length, original, length: character.length })
        foldedOffset += folded.length; original += character.length
      }
    }
    const originalOffset = (position: number, end: boolean) => {
      let low = 0, high = expansions.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (expansions[middle].start <= position) low = middle + 1
        else high = middle
      }
      const expansion = expansions[low - 1]
      if (!expansion) return position
      if (position === expansion.start) return expansion.original
      if (position < expansion.end) return expansion.original + (end ? expansion.length : 0)
      return position - (expansion.end - expansion.original - expansion.length)
    }
    for (let cursor = 0; cursor <= foldedText.length - foldedQuery.length && matches.length < limit;) {
      const from = foldedText.indexOf(foldedQuery, cursor)
      if (from === -1) break
      const start = originalOffset(from, false)
      const end = originalOffset(from + foldedQuery.length, true)
      const previous = matches.at(-1)
      if (!previous || previous.from !== start || previous.to !== end) accept(start, end)
      cursor = from + foldedQuery.length
    }
    return matches
  }
  return { find, test: text => find(text, 1).length > 0 }
}

export function findTextMatches(text: string, query: string, caseSensitive = false, options: Omit<TextSearchOptions, 'caseSensitive'> = {}): TextMatch[] {
  return createTextSearch(query, { ...options, caseSensitive }).find(text)
}
