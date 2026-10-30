import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

/** Toggle a complete inline code span using CommonMark-safe delimiters. */
export function inlineCodeTransaction(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  const selection = state.selection.main
  const { from, to } = selection
  let existing: { from: number; to: number; innerFrom: number; innerTo: number } | null = null
  let partial = false
  tree.iterate({ from, to: Math.min(state.doc.length, Math.max(to, from + 1)), enter(node) {
    if (node.name !== 'InlineCode') return
    if (from === to ? !(node.from < from && node.to > from) : !(node.from < to && node.to > from)) return false
    const first = node.node.firstChild, last = node.node.lastChild
    if (!first || !last || first.name !== 'CodeMark' || last.name !== 'CodeMark' || first.to > last.from) { partial = true; return false }
    const inner = state.doc.sliceString(first.to, last.from)
    const pad = inner.startsWith(' ') && inner.endsWith(' ') && /[^ ]/.test(inner) ? 1 : 0
    const innerFrom = first.to + pad, innerTo = last.from - pad
    if ((from === node.from && to === node.to) || (from === first.to && to === last.from) || (from === innerFrom && to === innerTo)) existing = { from: node.from, to: node.to, innerFrom, innerTo }
    else partial = true
    return false
  } })
  if (partial) return null
  const reverse = selection.anchor > selection.head
  if (existing) {
    const span = existing as { from: number; to: number; innerFrom: number; innerTo: number }
    const insert = state.doc.sliceString(span.innerFrom, span.innerTo)
    if (insert.includes('\n')) return null
    const left = span.from, right = left + insert.length
    return { changes: { from: span.from, to: span.to, insert }, selection: EditorSelection.single(reverse ? right : left, reverse ? left : right), annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true }
  }
  const content = state.doc.sliceString(from, to) || 'code'
  if (content.includes('\n')) return null
  if (!content.trim() && content !== ' ') return null
  let longest = 0
  for (const run of content.matchAll(/`+/g)) { longest = Math.max(longest, run[0].length); if (longest > 10000) return null }
  const marker = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') || (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) ? ' ' : ''
  const insert = marker + pad + content + pad + marker
  const left = from + marker.length + pad.length, right = left + content.length
  return { changes: { from, to, insert }, selection: EditorSelection.single(reverse ? right : left, reverse ? left : right), annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true }
}
