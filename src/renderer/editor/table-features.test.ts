import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { clearTableRange, copyTableRange, moveTableColumn, moveTableRow, pasteTableCells, resizeTable } from './table-operations'

const original = '| A  | B | C |\n| :--- | ---: | :---: |\n| first  | two | three |\n| second | five | six |'

describe('table structure and rectangular operations', () => {
  it('rejects oversized clipboard shapes before constructing cell arrays', () => {
    expect(pasteTableCells(original, 0, 0, 0, 'a\n'.repeat(100000))).toBeNull()
    expect(pasteTableCells(original, 0, 0, 0, 'a\t'.repeat(100000))).toBeNull()
    expect(pasteTableCells(original, 0, 0, 0, 'a'.repeat(16 * 1024 * 1024 + 1))).toBeNull()
  })
  it('grows a table while preserving existing cell spelling and restores exact bytes with undo', () => {
    const prefix = '__untouched__\n\n', suffix = '\n\n[ref]: https://example.com'
    let state = EditorState.create({ doc: prefix + original + suffix, extensions: [history()] })
    const change = resizeTable(original, prefix.length, 4, 4)!
    state = state.update({ changes: change }).state
    expect(state.doc.toString()).toContain('| first  | two | three |')
    expect(state.doc.toString()).toContain(prefix)
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(prefix + original + suffix)
    expect(resizeTable(original, 0, 1, 1)).toBeNull()
    expect(resizeTable(original, 0, 501, 3)).toBeNull()
  })

  it('moves body rows without changing the header/alignment row or cell padding', () => {
    const updated = EditorState.create({ doc: original }).update({ changes: moveTableRow(original, 0, 2, 1)! }).state.doc.toString()
    expect(updated).toBe('| A  | B | C |\n| :--- | ---: | :---: |\n| second | five | six |\n| first  | two | three |')
    expect(moveTableRow(original, 0, 1, 0)).toBeNull()
    expect(moveTableRow(original, 0, 2, 2)).toBeNull()
  })

  it('moves columns with their alignment rules, preserving escaped pipes', () => {
    const source = original.replace('first', 'a\\|b')
    const updated = EditorState.create({ doc: source }).update({ changes: moveTableColumn(source, 0, 2, 0)! }).state.doc.toString()
    expect(updated).toBe('| C | A  | B |\n| :---: | :--- | ---: |\n| three | a\\|b  | two |\n| six | second | five |')
  })

  it('pastes TSV into cells and grows rows/columns with escaped literal pipes', () => {
    const change = pasteTableCells(original, 0, 2, 2, 'alpha|beta\tnew\nlast\tvalue')!
    const updated = EditorState.create({ doc: original }).update({ changes: change }).state.doc.toString()
    expect(updated).toContain('alpha\\|beta')
    expect(updated).toContain('new')
    expect(updated).toContain('last')
    expect(updated).toContain('| A  | B | C |')
    expect(updated).toContain('| first  | two | three |')
    expect(pasteTableCells(original, 0, 3, 0, 'x')).toBeNull()
  })

  it('copies and clears only the selected rectangle, leaving untouched delimiters and cells', () => {
    const range = { fromRow: 2, fromColumn: 2, toRow: 1, toColumn: 1 }
    expect(copyTableRange(original, range)).toBe('two\tthree\nfive\tsix')
    const updated = EditorState.create({ doc: original }).update({ changes: clearTableRange(original, 0, range) }).state.doc.toString()
    expect(updated).toBe('| A  | B | C |\n| :--- | ---: | :---: |\n| first  |  |  |\n| second |  |  |')
  })
})
