import { isolateHistory } from '@codemirror/commands'
import type { EditorState, TransactionSpec } from '@codemirror/state'

/** Delete only the word at the empty caret, leaving neighboring source untouched. */
export function deleteCurrentWord(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null
  const word = state.wordAt(state.selection.main.head)
  if (!word || word.from === word.to) return null
  return { changes: { from: word.from, to: word.to, insert: '' }, selection: { anchor: word.from }, annotations: isolateHistory.of('full'), userEvent: 'delete.word', scrollIntoView: true }
}
