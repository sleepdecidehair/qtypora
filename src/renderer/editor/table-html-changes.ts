import type { ChangeSet, EditorState } from '@codemirror/state'
import type { DocumentRecord, LineEnding } from '../../shared/contracts'
import { escapeTableCellInput } from '../../shared/table-cell-input'
import { fitsPasteBudget } from './paste-budget'

/** Compute the actual cell edit before committing it or its virtual-cell syntax. */
export function tableHtmlChanges(state: EditorState, range: { from: number; to: number }, markdown: string, prefix: string | undefined, encoding: DocumentRecord['encoding'], lineEnding: LineEnding): ChangeSet | null {
  const insert = (prefix ?? '') + escapeTableCellInput(markdown) + (prefix === undefined ? '' : ' |')
  const changes = state.changes({ ...range, insert })
  return fitsPasteBudget(state.doc, changes.apply(state.doc), encoding, lineEnding) ? changes : null
}
