import type { TextMatch } from '../../shared/search'
export { findTextMatches } from '../../shared/search'
export type { TextMatch } from '../../shared/search'
export interface IndexedTextNode { node: Text; from: number; to: number }
export interface ArticleTextIndex { text: string; nodes: IndexedTextNode[] }

export function indexArticleText(article: HTMLElement, excludedSelector?: string): ArticleTextIndex {
  const nodes: IndexedTextNode[] = []
  const pieces: string[] = []
  let offset = 0
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || !node.textContent || parent.closest('style,script,noscript,defs,clipPath,mask,annotation,annotation-xml,title,desc,[hidden],[aria-hidden="true"]') || (excludedSelector && parent.closest(excludedSelector))) return NodeFilter.FILTER_REJECT
      const style = getComputedStyle(parent)
      return style.display === 'none' || style.visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const text = node.data
    nodes.push({ node, from: offset, to: offset + text.length })
    pieces.push(text)
    offset += text.length
  }
  return { text: pieces.join(''), nodes }
}

export function matchRange(index: ArticleTextIndex, match: TextMatch): Range | null {
  const first = index.nodes.find((entry) => entry.to > match.from)
  const last = index.nodes.find((entry) => entry.to >= match.to && entry.from < match.to)
  if (!first || !last || !first.node.isConnected || !last.node.isConnected) return null
  const range = document.createRange()
  range.setStart(first.node, match.from - first.from)
  range.setEnd(last.node, match.to - last.from)
  return range
}
