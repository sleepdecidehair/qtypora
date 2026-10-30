import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'
import { isUnclosedHtmlBlock } from './html-block-boundary'

/** Insert a standalone TOC after the current block or into the current blank line. */
export function insertTableOfContents(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !state.facet(markdownOptionsFacet).toc || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  const live = liveBlocks(state).find(block => position >= block.from && position <= block.to)
  const lookup = line.length ? Math.min(position, line.to - 1) : position
  let node = tree.resolveInner(lookup, 1)
  let inCode = node.name === 'FencedCode' || node.name === 'CodeBlock'
  let inContainer = node.name === 'ListItem' || node.name === 'Blockquote'
  let unclosedFence = node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2
  let unclosedHtml = isUnclosedHtmlBlock(state, node)
  while (node.parent && (node.parent.name !== 'Document' || node.parent.parent)) {
    node = node.parent
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') inCode = true
    if (node.name === 'ListItem' || node.name === 'Blockquote') inContainer = true
    if (node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2) unclosedFence = true
    if (isUnclosedHtmlBlock(state, node)) unclosedHtml = true
  }
  if (unclosedFence || unclosedHtml || (!line.text.trim() && inContainer && !inCode)) return null
  if (!line.text.trim() && !live && !inCode) {
    const prefix = line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : ''
    const suffix = line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim() ? '\n' : ''
    return { changes: { from: line.from, insert: prefix + '[toc]' + suffix }, selection: { anchor: line.from + prefix.length + 5 }, annotations: isolateHistory.of('full'), userEvent: 'input.insert-toc', scrollIntoView: true }
  }
  if (!live && (!node.parent || node.parent.name !== 'Document')) return null
  const end = live?.to ?? state.doc.lineAt(node.to).to
  const last = state.doc.lineAt(end)
  const suffix = last.number < state.doc.lines && state.doc.line(last.number + 1).text.trim() ? '\n' : ''
  return { changes: { from: end, insert: '\n\n[toc]' + suffix }, selection: { anchor: end + 7 }, annotations: isolateHistory.of('full'), userEvent: 'input.insert-toc', scrollIntoView: true }
}
