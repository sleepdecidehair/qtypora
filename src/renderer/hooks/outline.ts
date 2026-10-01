import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

export interface OutlineHeading { level: number; text: string; line: number }

const parser = new MarkdownIt({ html: true, linkify: false, typographer: false })

function inlineText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'text' || token.type === 'code_inline') return token.content
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    if (token.type === 'image') return token.children ? inlineText(token.children) : token.content
    return token.children ? inlineText(token.children) : ''
  }).join('')
}

export function extractHeadings(content: string): OutlineHeading[] {
  const tokens = parser.parse(content, {})
  const headings: OutlineHeading[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const inline = tokens[index + 1]
    if (token.type !== 'heading_open' || !token.map || inline?.type !== 'inline') continue
    headings.push({ level: Number(token.tag.slice(1)), text: inlineText(inline.children ?? []).trim(), line: token.map[0] + 1 })
  }
  return headings
}
