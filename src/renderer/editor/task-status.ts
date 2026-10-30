import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { markdownOptionsFacet } from './markdown-config'

export type TaskStatusAction = 'checked' | 'unchecked' | 'toggle'

/** Change task marker characters only, preserving source, selection and history. */
export function taskStatusEdit(state: EditorState, action: TaskStatusAction): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || state.facet(markdownOptionsFacet).strictMode) return null
  const selection = state.selection.main
  const last = state.doc.lineAt(selection.to > selection.from && state.doc.sliceString(selection.to - 1, selection.to) === '\n' ? selection.to - 1 : selection.to)
  const tree = ensureSyntaxTree(state, last.to, 50)
  if (!tree) return null
  const markers: { from: number; to: number; checked: boolean }[] = []
  const add = (from: number, to: number) => {
    const value = state.doc.sliceString(from, to)
    if (/^\[[ xX]\]$/.test(value)) markers.push({ from: from + 1, to: from + 2, checked: value[1] !== ' ' })
  }
  if (selection.empty) {
    const line = state.doc.lineAt(selection.head)
    const position = line.length ? Math.min(selection.head, line.to - 1) : selection.head
    let node = tree.resolveInner(position, 1)
    while (node.parent && node.name !== 'ListItem') node = node.parent
    if (node.name !== 'ListItem') return null
    const marker = node.getChild('Task')?.getChild('TaskMarker')
    if (marker) add(marker.from, marker.to)
  } else {
    const first = state.doc.lineAt(selection.from).number
    tree.iterate({ from: state.doc.line(first).from, to: last.to, enter(node) {
      if (node.name === 'TaskMarker') add(node.from, node.to)
    } })
  }
  const changes = markers.flatMap(marker => {
    const checked = action === 'toggle' ? !marker.checked : action === 'checked'
    return checked === marker.checked ? [] : [{ from: marker.from, to: marker.to, insert: checked ? 'x' : ' ' }]
  })
  return changes.length ? { changes, annotations: isolateHistory.of('full'), userEvent: 'input.task-status' } : null
}
