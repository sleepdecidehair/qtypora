import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { supportsPreview } from './preview-budget'

export interface BlockRange { from: number; to: number }

/** Resolve the nearest list item or top-level block without consuming separators. */
export function currentBlockRange(state: EditorState): BlockRange | null {
  if (state.selection.ranges.length !== 1 || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const positionInDocument = state.selection.main.head
  const live = liveBlocks(state).find(block => positionInDocument >= block.from && positionInDocument <= block.to)
  const line = state.doc.lineAt(positionInDocument)
  const position = line.length ? Math.min(state.selection.main.head, line.to - 1) : line.from
  let node = tree.resolveInner(position, 1)
  let listItem = node.name === 'ListItem' ? node : null
  let inCode = node.name === 'FencedCode' || node.name === 'CodeBlock'
  while (node.parent && node.parent.name !== 'Document') {
    node = node.parent
    if (!listItem && node.name === 'ListItem') listItem = node
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') inCode = true
  }
  if (live && !(live.kind === 'alert' && listItem)) return { from: live.from, to: live.to }
  if (!line.text.trim() && !inCode) return null
  if (listItem) node = listItem
  else if (!node.parent || node.parent.name !== 'Document') return { from: line.from, to: line.to }
  return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to }
}

export function selectCurrentBlock(state: EditorState): TransactionSpec | null {
  const range = currentBlockRange(state)
  return range ? { selection: EditorSelection.range(range.from, range.to), userEvent: 'select.block', scrollIntoView: true } : null
}

export function deleteCurrentBlock(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const range = currentBlockRange(state)
  if (!range || range.from === range.to) return null
  const line = state.doc.lineAt(state.selection.main.head)
  const position = line.length ? Math.min(state.selection.main.head, line.to - 1) : line.from
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  let node = tree.resolveInner(position, 1)
  while (node.parent && node.name !== 'ListItem') node = node.parent
  let from = range.from, to = range.to
  if (node.name === 'ListItem' && node.parent) {
    const siblings = node.parent.getChildren('ListItem')
    const index = siblings.findIndex(item => item.from === node.from && item.to === node.to)
    if (index >= 0 && index < siblings.length - 1 && to < state.doc.length && state.doc.sliceString(to, to + 1) === '\n') to++
    else if (index > 0 && from > 0 && state.doc.sliceString(from - 1, from) === '\n') from--
  }
  // Non-list blocks retain separators so neighboring paragraphs never merge.
  return { changes: { from, to, insert: '' }, selection: { anchor: from }, annotations: isolateHistory.of('full'), userEvent: 'delete.block', scrollIntoView: true }
}
