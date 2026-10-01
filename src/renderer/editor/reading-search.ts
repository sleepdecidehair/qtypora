export interface TextMatch { from: number; to: number }
export interface IndexedTextNode { node: Text; from: number; to: number }
export interface ArticleTextIndex { text: string; nodes: IndexedTextNode[] }

function foldCharacter(character: string): string {
  const lower = character.toLocaleLowerCase()
  return lower === '\u03c2' ? '\u03c3' : lower
}

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

export function findTextMatches(text: string, query: string, caseSensitive = false): TextMatch[] {
  if (!query) return []
  if (caseSensitive) {
    const matches: TextMatch[] = []
    for (let cursor = 0; cursor <= text.length - query.length;) {
      const from = text.indexOf(query, cursor)
      if (from === -1) break
      matches.push({ from, to: from + query.length })
      cursor = from + query.length
    }
    return matches
  }
  const foldedPieces: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let originalOffset = 0
  for (const character of text) {
    const folded = foldCharacter(character)
    foldedPieces.push(folded)
    for (let index = 0; index < folded.length; index++) { starts.push(originalOffset); ends.push(originalOffset + character.length) }
    originalOffset += character.length
  }
  const foldedText = foldedPieces.join('')
  const foldedQuery = Array.from(query, foldCharacter).join('')
  const matches: TextMatch[] = []
  for (let cursor = 0; cursor <= foldedText.length - foldedQuery.length;) {
    const from = foldedText.indexOf(foldedQuery, cursor)
    if (from === -1) break
    const match = { from: starts[from], to: ends[from + foldedQuery.length - 1] }
    const previous = matches.at(-1)
    if (!previous || previous.from !== match.from || previous.to !== match.to) matches.push(match)
    cursor = from + foldedQuery.length
  }
  return matches
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
