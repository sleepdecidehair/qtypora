import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { markdownOptionsFacet } from './markdown-config'
import { styleScope } from './live-inline'

const styles = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link'])
const markers = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark'])

function contentRange(node: SyntaxNode): { from: number; to: number } | null {
  const first = node.firstChild, last = node.lastChild
  if (!first || !markers.has(first.name)) return null
  const end = node.name === 'Link' ? node.getChildren('LinkMark')[1] : last
  if (!end || !markers.has(end.name) || first.to > end.from) return null
  return { from: first.to, to: end.from }
}

/** Remove only a real inline style node, including its Markdown delimiters. */
export function deleteCurrentStyle(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const selection = state.selection.main
  const scope = styleScope(state)
  if (!scope) return null
  let chosen: SyntaxNode | null = null
  for (const side of [-1, 1] as const) {
    let node = syntaxTree(state).resolveInner(selection.head, side)
    while (node.parent) {
      if (styles.has(node.name) && !(node.name === 'Strikethrough' && state.facet(markdownOptionsFacet).strictMode)) {
        const content = contentRange(node)
        if (content && content.from <= selection.from && content.to >= selection.to &&
          ((scope.from === content.from && scope.to === content.to) || (selection.from === content.from && selection.to === content.to))) {
          chosen = node
          break
        }
      }
      node = node.parent
    }
    if (chosen) break
  }
  if (!chosen) return null
  // Removing the only child of a formatted ancestor would leave orphan markers.
  for (let parent = chosen.parent; parent; parent = parent.parent) {
    if (!styles.has(parent.name)) continue
    const content = contentRange(parent)
    if (!content) return null
    const remaining = state.doc.sliceString(content.from, chosen.from) + state.doc.sliceString(chosen.to, content.to)
    if (!remaining.trim()) return null
  }
  return { changes: { from: chosen.from, to: chosen.to, insert: '' }, selection: { anchor: chosen.from }, annotations: isolateHistory.of('full'), userEvent: 'delete.style', scrollIntoView: true }
}
