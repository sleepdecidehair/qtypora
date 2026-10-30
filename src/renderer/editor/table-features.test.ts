import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { clearTableRange, copyTableRange, moveTableColumn, moveTableRow, pasteTableCells, resizeTable } from './table-operations'
import { parseTableSource } from './table-model'

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

  it('keeps CRLF outside moved column cells', () => {
    const source = '| A | B\\|C\r\n| --- | ---\r\n| x | y\\|z'
    const changes = moveTableColumn(source, 0, 1, 0)!
    let result = source
    for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
    expect(result).toBe('| B\\|C| A \r\n| ---| --- \r\n| y\\|z| x ')
    const lf = source.replace(/\r\n/g, '\n')
    let state = EditorState.create({ doc: lf, extensions: [history()] })
    state = state.update({ changes: moveTableColumn(lf, 0, 1, 0)!, userEvent: 'input.table' }).state
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(lf)
  })

  it('moves short-row cells through implicit empty columns and restores source on undo', () => {
    const source = '| A | B | C |\n| :--- | ---: | --- |\n| a\\|b |\n| x | y | z |'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    const changes = moveTableColumn(source, 0, 0, 2)!
    state = state.update({ changes, userEvent: 'input.table' }).state
    expect(state.doc.toString()).toBe('| B | C | A |\n| ---: | --- | :--- |\n| | | a\\|b |\n| y | z | x |')
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(source)
    expect(moveTableColumn(source, 0, 1, 2)?.some(change => change.from >= source.indexOf('| a\\|b |') && change.from < source.indexOf('| x |'))).toBe(false)
  })

  it('keeps an empty first cell when moving a bare short row', () => {
    const source = 'A | B\n--- | ---\nonly'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    state = state.update({ changes: moveTableColumn(source, 0, 0, 1)!, userEvent: 'input.table' }).state
    const cells = parseTableSource(state.doc.toString()).cells.filter(cell => cell.row === 1)
    expect(cells.map(cell => cell.content)).toEqual(['', 'only'])
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(source)
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

  it('pastes into missing short-row cells without changing other rows and undoes atomically', () => {
    const source = '| A | B | C |\n| --- | --- | --- |\n| old |\n| untouched | keep | last |'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    const change = pasteTableCells(source, 0, 1, 0, 'x\ty\tz|q')!
    state = state.update({ changes: change, userEvent: 'input.table' }).state
    expect(state.doc.toString()).toBe(source.replace('| old |', '| x | y | z\\|q |'))
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(source)
    const partial = pasteTableCells(source, 0, 1, 2, 'z')!
    expect(EditorState.create({ doc: source }).update({ changes: partial }).state.doc.toString()).toContain('| old | | z |')
  })

  it('grows columns for short rows and preserves untouched short rows', () => {
    const source = '| A | B |\n| --- | --- |\n| old |\n| untouched |'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    const change = pasteTableCells(source, 0, 1, 0, '甲\t乙\t丙')!
    state = state.update({ changes: change, userEvent: 'input.table' }).state
    expect(state.doc.toString()).toContain('| 甲 | 乙 | 丙 |')
    expect(state.doc.toString()).toContain('| untouched |')
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })

  it('fills missing short-row cells without splitting CRLF', () => {
    const source = '| A | B |\r\n| --- | --- |\r\n| old |\r\n| keep | next |'
    const change = pasteTableCells(source, 0, 1, 0, 'x\ty')!
    expect(change.insert).toBe('| A | B |\r\n| --- | --- |\r\n| x | y |\r\n| keep | next |')
    const lf = source.replace(/\r\n/g, '\n')
    let state = EditorState.create({ doc: lf, extensions: [history()] })
    state = state.update({ changes: pasteTableCells(lf, 0, 1, 0, 'x\ty')!, userEvent: 'input.table' }).state
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(lf)
  })

  it('copies and clears only the selected rectangle, leaving untouched delimiters and cells', () => {
    const range = { fromRow: 2, fromColumn: 2, toRow: 1, toColumn: 1 }
    expect(copyTableRange(original, range)).toBe('two\tthree\nfive\tsix')
    const updated = EditorState.create({ doc: original }).update({ changes: clearTableRange(original, 0, range) }).state.doc.toString()
    expect(updated).toBe('| A  | B | C |\n| :--- | ---: | :---: |\n| first  |  |  |\n| second |  |  |')
  })

  it('copies implicit empty cells in their proper columns for CRLF tables', () => {
    const source = '| A | B | C |\r\n| --- | --- | --- |\r\n| one |\r\n| two | three | four |\r\n| old | stale | last |\r\n| old2 | stale2 | last2 |'
    const range = { fromRow: 2, fromColumn: 2, toRow: 1, toColumn: 0 }
    const copied = copyTableRange(source, range)
    expect(copied).toBe('one\t\t\ntwo\tthree\tfour')
    const change = pasteTableCells(source, 0, 3, 0, copied)!
    expect(change.insert).toContain('| one |  |  |\r\n| two | three | four |')
    const normalized = source.replace(/\r\n/g, '\n')
    let state = EditorState.create({ doc: normalized, extensions: [history()] })
    state = state.update({ changes: pasteTableCells(normalized, 0, 3, 0, copied)!, userEvent: 'input.table' }).state
    expect(undo({ state, dispatch: transaction => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe(normalized)
  })
})
