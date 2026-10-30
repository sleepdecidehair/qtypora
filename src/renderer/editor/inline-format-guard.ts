import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { canFormatSemanticLines } from './semantic-format-guard'

/** Inline wrappers must not consume block delimiters or cross table cells. */
export function canFormatInlineSelection(state: EditorState): boolean {
  if (state.readOnly || state.selection.ranges.length !== 1) return false
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return false
  const { from, to } = state.selection.main
  const last = to > from && state.doc.sliceString(to - 1, to) === '\n' ? to - 1 : to
  if (!canFormatSemanticLines(state, state.doc.lineAt(from).from, state.doc.lineAt(last).to)) return false
  let unsafe = false, table = false, cell = false
  tree.iterate({ from, to: Math.min(state.doc.length, Math.max(to, from + 1)), enter(node) {
    const overlaps = from === to ? node.from <= from && node.to >= from : node.from < to && node.to > from
    if (!overlaps) return false
    if (['FencedCode', 'CodeBlock', 'HTMLBlock', 'LinkReference'].includes(node.name)) { unsafe = true; return false }
    if (node.name === 'Table') table = true
    if (node.name === 'TableCell' && node.from <= from && node.to >= to) cell = true
  } })
  return !unsafe && (!table || cell)
}
