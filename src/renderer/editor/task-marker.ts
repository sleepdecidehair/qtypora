import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { markdownOptionsFacet } from './markdown-config'

/** Only render a checkbox for a parsed task marker, never a code sample. */
export function isTaskMarker(state: EditorState, from: number): boolean {
  if (state.facet(markdownOptionsFacet).strictMode || from < 0 || from + 3 > state.doc.length || !/^\[[ xX]\]$/.test(state.doc.sliceString(from, from + 3))) return false
  const tree = syntaxTree(state)
  if (tree.length < from + 3) return false
  const node = tree.resolveInner(from, 1)
  return node.name === 'TaskMarker' && node.from === from && node.to === from + 3 && node.parent?.name === 'Task'
}
