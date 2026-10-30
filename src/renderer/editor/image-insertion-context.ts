import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { parseTableSource } from '../../shared/table-source'
import { splitsMarkdownEscape, unsafeMarkdownCharacterBoundary } from '../../shared/markdown-escape'

/** Null means the insertion could cross a table boundary or parsing is incomplete. */
export function imageInsertionContext(state: EditorState, range: { from: number; to: number }): 'table' | 'text' | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  let table = false, cell = false
  const { from, to } = range
  tree.iterate({ from, to: Math.min(state.doc.length, Math.max(to, from + 1)), enter(node) {
    const overlaps = from === to ? node.from <= from && node.to >= from : node.from < to && node.to > from
    if (!overlaps) return false
    if (node.name === 'Table') table = true
    if (node.name === 'TableCell' && node.from <= from && node.to >= to) cell = true
  } })
  if (table) {
    const source = state.doc.toString()
    if (splitsMarkdownEscape(source, from) || splitsMarkdownEscape(source, to) || unsafeMarkdownCharacterBoundary(source, from) || unsafeMarkdownCharacterBoundary(source, to)) return null
  }
  return table ? cell ? 'table' : null : 'text'
}

export function hasCompleteTable(state: EditorState, from: number, to: number): boolean {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return false
  let found = false
  tree.iterate({ from, to, enter(node) { if (node.name === 'Table' && node.from === from && node.to === to) { found = true; return false } } })
  return found
}

/** Empty cells have no Lezer TableCell node; resolve only a unique source position. */
export function emptyTableCellIdentity(state: EditorState, range: { from: number; to: number }): { tableFrom: number; tableTo: number; row: number; column: number } | null {
  if (range.from !== range.to) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  let found: { tableFrom: number; tableTo: number; row: number; column: number } | null = null
  tree.iterate({ from: range.from, to: Math.min(state.doc.length, range.from + 1), enter(node) {
    if (node.name !== 'Table' || node.from > range.from || node.to < range.to) return
    const source = state.doc.sliceString(node.from, node.to)
    const model = parseTableSource(source, node.from, state.doc.lineAt(node.from).number)
    const cells = model.cells.filter(cell => cell.column < model.columns && cell.content === '' && cell.from === range.from && cell.to === range.to)
    if (cells.length === 1) found = { tableFrom: node.from, tableTo: node.to, row: cells[0].row, column: cells[0].column }
    return false
  } })
  return found
}
