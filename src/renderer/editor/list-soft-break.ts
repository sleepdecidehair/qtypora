import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { paragraphBreak } from './paragraph-break'
import { supportsPreview } from './preview-budget'

/** Continue an explicitly marked list item without creating a new sibling. */
export function listSoftBreak(state: EditorState, mode: 'hybrid' | 'source'): TransactionSpec | 'blocked' | null {
  if (mode !== 'hybrid' || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !supportsPreview(state)) return null
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  const prefix = /^ {0,64}(?:[-+*]|\d{1,9}[.)]) {1,4}/.exec(line.text)?.[0]
  const taskMarker = prefix ? /^\[[ xX]\] +/.exec(line.text.slice(prefix.length))?.[0] ?? '' : ''
  if (!prefix || position < line.from + prefix.length + taskMarker.length || (position === line.to && line.number < state.doc.lines)) return null
  if (liveBlocks(state).some(block => position >= block.from && position <= block.to)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const protectedBoundary = paragraphBreak(state, mode) === 'blocked'
  let node = tree.resolveInner(position, -1), inParagraph = false, listDepth = 0, listParentIsDocument = false
  while (node.parent) {
    if (['Blockquote', 'FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag'].includes(node.name)) return null
    if (!protectedBoundary && !inParagraph && node.name !== 'Paragraph' && node.name !== 'Task' && position > node.from && position < node.to) return null
    if (node.name === 'Paragraph' || node.name === 'Task') inParagraph = true
    if (node.name === 'ListItem') { listDepth++; if (node.parent?.parent?.name === 'Document') listParentIsDocument = true }
    node = node.parent
  }
  if (!inParagraph || !listDepth || !listParentIsDocument) return null
  if (protectedBoundary) return 'blocked'
  const indentation = ' '.repeat(prefix.length)
  return { changes: { from: position, insert: '\n' + indentation }, selection: { anchor: position + 1 + indentation.length }, annotations: isolateHistory.of('full'), userEvent: 'input.break', scrollIntoView: true }
}
