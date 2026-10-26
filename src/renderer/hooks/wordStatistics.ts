import type Token from 'markdown-it/lib/token.mjs'
import { getMarkdownParser } from '../editor/markdown-parser'
import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from '../../shared/markdown-options'

export interface WritingStatistics {
  words: number
  characters: number
  charactersWithoutSpaces: number
  paragraphs: number
  lines: number
  readingMinutes: number
}

function textInHtml(content: string): string {
  return getMarkdownParser().utils.unescapeAll(content.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' '))
}

function visibleTokenText(tokens: Token[]): string {
  let suppressedHtml: string | null = null
  return tokens.map(token => {
    if (suppressedHtml) {
      if (token.type === 'html_inline' && /^<\/(script|style)\s*>/i.exec(token.content)?.[1].toLowerCase() === suppressedHtml) suppressedHtml = null
      return ''
    }
    if (token.type === 'html_inline') {
      const hidden = /^<(script|style)\b/i.exec(token.content)?.[1].toLowerCase()
      if (hidden && !/<\/(?:script|style)\s*>/i.test(token.content)) { suppressedHtml = hidden; return '' }
    }
    if (token.type === 'front_matter' || token.type === 'table_of_contents' || token.type === 'footnote_ref') return ''
    if (token.children) return visibleTokenText(token.children)
    if (['text', 'code_inline', 'fence', 'code_block'].includes(token.type)) return token.content + (token.block ? '\n' : '')
    if (token.type === 'html_inline' || token.type === 'html_block') return textInHtml(token.content)
    if (token.type === 'softbreak' || token.type === 'hardbreak' || (token.block && token.nesting === -1)) return '\n'
    return ''
  }).join('')
}

export function countWords(text: string): number {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const other = text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return han + other
}

export function writingStatistics(content: string, readingSpeed = 300, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): WritingStatistics {
  const tokens = getMarkdownParser(options).parse(content, {})
  const words = countWords(visibleTokenText(tokens))
  const characters = Array.from(content).length
  const charactersWithoutSpaces = Array.from(content.replace(/\s/gu, '')).length
  const speed = Number.isFinite(readingSpeed) && readingSpeed > 0 ? readingSpeed : 300
  return {
    words, characters, charactersWithoutSpaces,
    paragraphs: tokens.filter(token => token.type === 'paragraph_open').length,
    lines: content ? content.split(/\r\n|\r|\n/).length : 0,
    readingMinutes: words ? Math.max(1, Math.ceil(words / speed)) : 0,
  }
}
