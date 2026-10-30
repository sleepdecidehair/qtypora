import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { paragraphBreak } from './paragraph-break'
import { supportsPreview } from './preview-budget'

/** Continue explicitly marked quote paragraphs on a soft line break. */
export function quoteSoftBreak(state: EditorState, mode: 'hybrid' | 'source'): TransactionSpec | 'blocked' | null {
  if (mode !== 'hybrid' || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !supportsPreview(state)) return null
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  const prefix = /^( {0,3}(?:>[ \t]?)+)/.exec(line.text)?.[1]
  if (!prefix || position < line.from + prefix.length || (position === line.to && line.number < state.doc.lines)) return null
  if (liveBlocks(state).some(block => position >= block.from && position <= block.to)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const protectedBoundary = paragraphBreak(state, mode) === 'blocked'
  let node = tree.resolveInner(position, -1)
  let inParagraph = false, quoteDepth = 0
  while (node.parent) {
    if (['ListItem', 'FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag'].includes(node.name)) return null
    if (!protectedBoundary && !inParagraph && node.name !== 'Paragraph' && node.name !== 'Blockquote' && position > node.from && position < node.to) return null
    if (node.name === 'Paragraph') inParagraph = true
    else if (node.name === 'Blockquote') quoteDepth++
    else if (inParagraph && node.name !== 'Document') return null
    node = node.parent
  }
  if (!inParagraph || quoteDepth !== [...prefix].filter(char => char === '>').length) return null
  if (protectedBoundary) return 'blocked'
  return { changes: { from: position, insert: '\n' + prefix }, selection: { anchor: position + 1 + prefix.length }, annotations: isolateHistory.of('full'), userEvent: 'input.break', scrollIntoView: true }
}
