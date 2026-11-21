import type { Text } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { isSafeLink, markdownParser } from './markdown-parser'

interface InlineHtmlAnchor {
  from: number
  to: number
  labelFrom: number
  labelTo: number
  href: string | undefined
}

export function inlineHtmlAnchor(doc: Text, node: SyntaxNode): InlineHtmlAnchor | null {
  const opening = doc.sliceString(node.from, node.to)
  if (!/^<a(?=[ \t>])/i.test(opening) || /[\r\n]/.test(opening) || opening.endsWith('/>')) return null
  const lineEnd = doc.lineAt(node.to).to
  for (let next = node.nextSibling; next && next.to <= lineEnd; next = next.nextSibling) {
    if (next.name === 'Link' || next.name === 'Autolink') return null
    if (next.name !== 'HTMLTag') continue
    if (!/^<\/a[ \t]*>$/i.test(doc.sliceString(next.from, next.to))) return null
    const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let href: string | undefined
    let named = false
    for (const match of opening.slice(2, -1).matchAll(attribute)) {
      const name = match[1].toLowerCase()
      const value = match[2] ?? match[3] ?? match[4] ?? ''
      if (name === 'id' || name === 'name') named ||= Boolean(value)
      if (name === 'href' && href === undefined) href = value.replace(/&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, entity => markdownParser.utils.unescapeAll(entity)).trim()
    }
    if (href && !isSafeLink(href)) return null
    if (!href && (!named || node.to !== next.from)) return null
    return { from: node.from, to: next.to, labelFrom: node.to, labelTo: next.from, href }
  }
  return null
}

export function inlineHtmlAnchorAt(doc: Text, tree: Tree, position: number): InlineHtmlAnchor | null {
  const line = doc.lineAt(position)
  if (!line.text.includes('<')) return null
  let anchor: InlineHtmlAnchor | null = null
  tree.iterate({ from: line.from, to: Math.min(line.to, position + 1), enter(node) {
    if (anchor || node.from > position) return false
    if (node.name !== 'HTMLTag') return
    const candidate = inlineHtmlAnchor(doc, node.node)
    if (candidate && candidate.from <= position && candidate.to > position) anchor = candidate
  } })
  return anchor
}
