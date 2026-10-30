import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { supportsPreview } from './preview-budget'
import { isUnclosedHtmlBlock } from './html-block-boundary'

/** Insert a writable paragraph outside the nearest list item or top-level block. */
export function insertAdjacentParagraph(state: EditorState, side: 'before' | 'after'): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const position = state.selection.main.head
  const current = state.doc.lineAt(position)
  let first = current.number, last = current.number
  const live = liveBlocks(state).find(block => position >= block.from && position <= block.to)
  const lookup = current.length ? Math.min(position, current.to - 1) : position
  let node = tree.resolveInner(lookup, 1)
  let listItem = node.name === 'ListItem' ? node : null
  let inCode = node.name === 'FencedCode' || node.name === 'CodeBlock'
  let listDepth = node.name === 'ListItem' ? 1 : 0
  let inQuote = node.name === 'Blockquote'
  let unclosedFence = node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2
  let unclosedHtml = isUnclosedHtmlBlock(state, node)
  while (node.parent && (node.parent.name !== 'Document' || node.parent.parent)) {
    node = node.parent
    if (node.name === 'ListItem') { listDepth++; if (!listItem) listItem = node }
    if (node.name === 'Blockquote') inQuote = true
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') inCode = true
    if (node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2) unclosedFence = true
    if (isUnclosedHtmlBlock(state, node)) unclosedHtml = true
  }
  if (unclosedFence || unclosedHtml || listDepth > 1 || (listDepth > 0 && inQuote) || (listDepth > 0 && !current.text.trim() && !inCode)) return null
  if (listItem) node = listItem
  if (live && !(live.kind === 'alert' && listItem)) {
    first = live.firstLine
    last = live.lastLine
  } else if (node.parent && (current.text.trim() || inCode)) {
    first = state.doc.lineAt(node.from).number
    last = state.doc.lineAt(node.to).number
  }
  if (side === 'before') {
    const start = state.doc.line(first).from
    const prefix = first > 1 && state.doc.line(first - 1).text.trim() ? '\n' : ''
    return { changes: { from: start, insert: prefix + '\n\n' }, selection: { anchor: start + prefix.length }, annotations: isolateHistory.of('full'), userEvent: 'input.insert-paragraph', scrollIntoView: true }
  }
  const end = state.doc.line(last).to
  const suffix = last < state.doc.lines && state.doc.line(last + 1).text.trim() ? '\n' : ''
  return { changes: { from: end, insert: '\n\n' + suffix }, selection: { anchor: end + 2 }, annotations: isolateHistory.of('full'), userEvent: 'input.insert-paragraph', scrollIntoView: true }
}
