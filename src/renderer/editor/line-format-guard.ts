import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { canFormatSemanticLines } from './semantic-format-guard'

/** Line-based block formatting must not rewrite structured blocks as plain lines. */
export function canFormatSelectedLines(state: EditorState): boolean {
  if (state.readOnly || state.selection.ranges.length !== 1) return false
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return false
  const { from, to } = state.selection.main
  const start = state.doc.lineAt(from).from
  const last = to > from && state.doc.sliceString(to - 1, to) === '\n' ? to - 1 : to
  const end = state.doc.lineAt(last).to
  if (!canFormatSemanticLines(state, start, end)) return false
  let unsafe = false
  tree.iterate({ from: start, to: Math.min(state.doc.length, end + 1), enter(node) {
    if (['FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'LinkReference'].includes(node.name) && node.from <= end && node.to > start) { unsafe = true; return false }
  } })
  return !unsafe
}
