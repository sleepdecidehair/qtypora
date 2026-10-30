import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** Widen focus only for a complete parsed paragraph or task, not its container. */
export function focusedParagraphLines(state: EditorState): { first: number; last: number } {
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  const fallback = { first: line.number, last: line.number }
  const tree = syntaxTree(state)
  if (tree.length < state.doc.length || !line.text.trim()) return fallback
  for (const side of [1, -1] as const) {
    let node = tree.resolveInner(position, side)
    while (node.parent && node.name !== 'Paragraph' && node.name !== 'Task') node = node.parent
    const valid = node.name === 'Paragraph'
      ? ['Document', 'Blockquote', 'ListItem'].includes(node.parent?.name ?? '')
      : node.name === 'Task' && node.parent?.name === 'ListItem'
    if (valid && position >= node.from && position <= node.to) return { first: state.doc.lineAt(node.from).number, last: state.doc.lineAt(node.to).number }
  }
  return fallback
}
