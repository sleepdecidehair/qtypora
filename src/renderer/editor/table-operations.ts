import type { ContextMenuAction } from '../../shared/contracts'
import { escapeCellInput, missingTableCellSource, parseTableSource } from './table-model'

export interface SourcePatch { from: number; to: number; insert: string }

function rowLayout(line: string): { from: number; to: number }[] {
  // CR is part of the CRLF separator, not the final cell's contents.
  if (line.endsWith('\r')) line = line.slice(0, -1)
  const pipes: number[] = []
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== '|') continue
    let backslashes = 0
    for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous--) backslashes++
    if (backslashes % 2 === 0) pipes.push(index)
  }
  const boundaries = [-1, ...pipes, line.length]
  const cells = boundaries.slice(0, -1).map((start, index) => ({ from: start + 1, to: boundaries[index + 1] }))
  if (pipes.length && !line.slice(0, pipes[0]).trim()) cells.shift()
  if (pipes.length && !line.slice(pipes.at(-1)! + 1).trim()) cells.pop()
  return cells
}

export function tableOperation(source: string, offset: number, row: number, column: number, action: ContextMenuAction): SourcePatch[] | null {
  const lines = source.split('\n')
  if (lines.length < 2) return null
  const model = parseTableSource(source)
  if (!model.columns || column < 0 || column >= model.columns || row < 0 || row >= model.rows) return null
  const starts: number[] = []
  let cursor = offset
  for (const line of lines) { starts.push(cursor); cursor += line.length + 1 }
  const sourceRow = row === 0 ? 0 : row + 1
  if (action === 'table-delete') return [{ from: offset, to: offset + source.length, insert: '' }]
  if (action === 'table-row-delete') {
    // A header and at least one body row remain; deleting the entire table is explicit.
    if (row === 0 || model.rows <= 2) return null
    const from = starts[sourceRow] - (lines[sourceRow - 1].endsWith('\r') ? 2 : 1)
    const to = starts[sourceRow] + lines[sourceRow].length - (lines[sourceRow].endsWith('\r') ? 1 : 0)
    return [{ from, to, insert: '' }]
  }
  if (action === 'table-row-before' || action === 'table-row-after') {
    const emptyRow = `| ${Array.from({ length: model.columns }, () => ' ').join(' | ')} |`
    const newline = lines[Math.min(sourceRow, lines.length - 2)]?.endsWith('\r') ? '\r\n' : '\n'
    const header = lines[0].endsWith('\r') ? lines[0].slice(0, -1) : lines[0]
    if (row === 0 && action === 'table-row-before') return [
      { from: offset, to: offset + header.length, insert: emptyRow },
      { from: starts[2] ?? offset + source.length, to: starts[2] ?? offset + source.length, insert: starts[2] === undefined ? `${newline}${header}` : `${header}${newline}` },
    ]
    const index = row === 0 ? 2 : sourceRow + (action === 'table-row-after' ? 1 : 0)
    return index >= lines.length ? [{ from: offset + source.length, to: offset + source.length, insert: `${newline}${emptyRow}` }] : [{ from: starts[index], to: starts[index], insert: `${emptyRow}${newline}` }]
  }
  const patches: SourcePatch[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    const cells = rowLayout(lines[index])
    const cell = cells[column]
    // A short body row has implicit empty trailing cells. Leaving it short
    // preserves its source while adding, deleting or aligning such a column.
    if (!cell) {
      if (index > 1 && (action.startsWith('table-column-') || action.startsWith('table-align-'))) continue
      return null
    }
    if (action.startsWith('table-align-')) {
      if (index !== 1) continue
      const raw = lines[index].slice(cell.from, cell.to)
      const marker = action === 'table-align-center' ? ':---:' : action === 'table-align-right' ? '---:' : ':---'
      patches.push({ from: starts[index] + cell.from, to: starts[index] + cell.to, insert: `${raw.match(/^\s*/)?.[0] || ''}${marker}${raw.match(/\s*$/)?.[0] || ''}` })
    } else if (action === 'table-column-before' || action === 'table-column-after') {
      const after = action === 'table-column-after'
      const at = after ? cell.to - (cell.to === lines[index].length && lines[index].endsWith('\r') ? 1 : 0) : cell.from
      const value = index === 1 ? ' --- ' : '   '
      const outerPipe = !after && column === 0 && cell.from === 0 ? '|' : ''
      const trailingPipe = after && column === cells.length - 1 && !lines[index].slice(at).trim() ? '|' : ''
      patches.push({ from: starts[index] + at, to: starts[index] + at, insert: after ? `|${value}${trailingPipe}` : `${outerPipe}${value}|` })
    } else if (action === 'table-column-delete') {
      if (model.columns === 1) return null
      if (index > 1 && column === 0 && cells.length === 1) {
        const end = lines[index].endsWith('\r') ? lines[index].length - 1 : lines[index].length
        patches.push({ from: starts[index], to: starts[index] + end, insert: '| |' })
        continue
      }
      // Remove one separator with the cell, leaving all other cell bytes untouched.
      const from = column === 0 ? cell.from : cell.from - 1
      const to = column === 0 ? cell.to + 1 : cell.to
      if (index < 2 && model.columns === 2) {
        const remaining = lines[index].slice(0, from) + lines[index].slice(to)
        const row = remaining.endsWith('\r') ? remaining.slice(0, -1) : remaining
        const trimmed = row.trim()
        let slashes = 0
        for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) slashes++
        const leading = trimmed.startsWith('|')
        const trailing = trimmed.endsWith('|') && slashes % 2 === 0
        if (!leading || !trailing) {
          patches.push({ from: starts[index], to: starts[index] + lines[index].length, insert: `${leading ? '' : '|'}${row}${trailing ? '' : '|'}${remaining.endsWith('\r') ? '\r' : ''}` })
          continue
        }
      }
      patches.push({ from: starts[index] + from, to: starts[index] + to, insert: '' })
    } else return null
  }
  return patches
}

export const MAX_TABLE_ROWS = 500
export const MAX_TABLE_COLUMNS = 50

function applyPatches(source: string, changes: SourcePatch[]): string {
  let updated = source
  for (const change of [...changes].sort((a, b) => b.from - a.from)) updated = updated.slice(0, change.from) + change.insert + updated.slice(change.to)
  return updated
}

export function resizeTable(source: string, offset: number, rows: number, columns: number): SourcePatch | null {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 2 || rows > MAX_TABLE_ROWS || columns < 1 || columns > MAX_TABLE_COLUMNS) return null
  let updated = source
  let model = parseTableSource(updated)
  if (model.rows < 2 || model.columns < 1 || model.rows > MAX_TABLE_ROWS || model.columns > MAX_TABLE_COLUMNS) return null
  while (model.rows !== rows || model.columns !== columns) {
    const action = model.rows < rows ? 'table-row-after' : model.rows > rows ? 'table-row-delete' : model.columns < columns ? 'table-column-after' : 'table-column-delete'
    const changes = tableOperation(updated, 0, model.rows - 1, model.columns - 1, action)
    if (!changes) return null
    updated = applyPatches(updated, changes)
    model = parseTableSource(updated)
  }
  return updated === source ? null : { from: offset, to: offset + source.length, insert: updated }
}

export function moveTableRow(source: string, offset: number, fromRow: number, toRow: number): SourcePatch | null {
  const model = parseTableSource(source)
  if (!Number.isInteger(fromRow) || !Number.isInteger(toRow) || fromRow < 1 || toRow < 1 || fromRow >= model.rows || toRow >= model.rows || fromRow === toRow) return null
  const lines = source.split('\n')
  const low = Math.min(fromRow, toRow) + 1, high = Math.max(fromRow, toRow) + 1
  const segment = lines.slice(low, high + 1)
  const [moved] = segment.splice(fromRow + 1 - low, 1)
  segment.splice(toRow + 1 - low, 0, moved)
  const from = offset + lines.slice(0, low).reduce((sum, line) => sum + line.length + 1, 0)
  return { from, to: from + lines.slice(low, high + 1).join('\n').length, insert: segment.join('\n') }
}

export function moveTableColumn(source: string, offset: number, fromColumn: number, toColumn: number): SourcePatch[] | null {
  const model = parseTableSource(source)
  if (!Number.isInteger(fromColumn) || !Number.isInteger(toColumn) || fromColumn < 0 || toColumn < 0 || fromColumn >= model.columns || toColumn >= model.columns || fromColumn === toColumn) return null
  const low = Math.min(fromColumn, toColumn), high = Math.max(fromColumn, toColumn)
  const changes: SourcePatch[] = []
  let start = offset
  for (const line of source.split('\n')) {
    if (line.trim()) {
      const cells = rowLayout(line)
      if (low >= cells.length) { start += line.length + 1; continue }
      const values = Array.from({ length: high - low + 1 }, (_, index) => {
        const cell = cells[low + index]
        return cell ? { raw: line.slice(cell.from, cell.to), implicit: false } : { raw: ' ', implicit: true }
      })
      const [moved] = values.splice(fromColumn - low, 1)
      values.splice(toColumn - low, 0, moved)
      while (values.at(-1)?.implicit) values.pop()
      // An empty first cell needs an outer pipe; otherwise Markdown treats its
      // separator as the optional leading pipe and shifts the row left.
      const outerPipe = low === 0 && cells[0].from === 0 && values.length > 1 && !values[0].raw.trim() ? '|' : ''
      changes.push({ from: start + cells[low].from, to: start + cells[Math.min(high, cells.length - 1)].to, insert: outerPipe + values.map(value => value.raw).join('|') })
    }
    start += line.length + 1
  }
  return changes
}

export interface TableRange { fromRow: number; fromColumn: number; toRow: number; toColumn: number }
export function tableRangeContains(range: TableRange, row: number, column: number): boolean {
  return row >= Math.min(range.fromRow, range.toRow) && row <= Math.max(range.fromRow, range.toRow) && column >= Math.min(range.fromColumn, range.toColumn) && column <= Math.max(range.fromColumn, range.toColumn)
}

export function clearTableRange(source: string, offset: number, range: TableRange): SourcePatch[] {
  return parseTableSource(source, offset).cells.filter(cell => cell.content && tableRangeContains(range, cell.row, cell.column)).map(cell => ({ from: cell.from, to: cell.to, insert: '' }))
}

export function copyTableRange(source: string, range: TableRange): string {
  const model = parseTableSource(source)
  const rows: string[][] = []
  const firstColumn = Math.max(0, Math.min(range.fromColumn, range.toColumn))
  const lastColumn = Math.min(model.columns - 1, Math.max(range.fromColumn, range.toColumn))
  for (let row = Math.min(range.fromRow, range.toRow); row <= Math.min(model.rows - 1, Math.max(range.fromRow, range.toRow)); row++) {
    const cells = model.cells.filter(cell => cell.row === row)
    const values: string[] = []
    for (let column = firstColumn; column <= lastColumn; column++) values.push((cells.find(cell => cell.column === column)?.content ?? '').replace(/\\\|/g, '|').replace(/<br\s*\/?\s*>/gi, ' '))
    rows.push(values)
  }
  return rows.map(row => row.join('\t')).join('\n')
}

export function pasteTableCells(source: string, offset: number, row: number, column: number, text: string): SourcePatch | null {
  if (text.length > 16 * 1024 * 1024) return null
  const model = parseTableSource(source)
  if (row < 0 || column < 0 || row >= model.rows || column >= model.columns) return null
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  let lineCount = row + 1, columnCount = column + 1
  for (const character of normalized) {
    if (character === '\n') { if (++lineCount > MAX_TABLE_ROWS) return null; columnCount = column + 1 }
    else if (character === '\t' && ++columnCount > MAX_TABLE_COLUMNS) return null
  }
  const values = normalized.split('\n').map(line => line.split('\t'))
  const rows = Math.max(model.rows, row + values.length), columns = Math.max(model.columns, column + Math.max(...values.map(line => line.length)))
  if (rows > MAX_TABLE_ROWS || columns > MAX_TABLE_COLUMNS) return null
  const resized = resizeTable(source, 0, rows, columns)
  if (!resized && (rows !== model.rows || columns !== model.columns)) return null
  const expanded = resized?.insert ?? source
  const next = parseTableSource(expanded)
  const changes = next.cells.flatMap(cell => {
    const value = values[cell.row - row]?.[cell.column - column]
    return value === undefined ? [] : [{ from: cell.from, to: cell.to, insert: escapeCellInput(value) }]
  })
  for (let targetRow = row; targetRow < Math.min(next.rows, row + values.length); targetRow++) {
    const actual = next.cells.filter(cell => cell.row === targetRow).length
    const rowValues = values[targetRow - row]
    let last = Math.min(next.columns - 1, column + rowValues.length - 1)
    while (last >= Math.max(actual, column) && !rowValues[last - column]) last--
    if (last < Math.max(actual, column)) continue
    const first = Math.max(actual, column)
    const cell = missingTableCellSource(expanded, next, targetRow, first)
    if (!cell) return null
    const cells = rowValues.slice(first - column, last - column + 1).map(escapeCellInput)
    changes.push({ from: cell.from, to: cell.to, insert: `${cell.missingPrefix}${cells.join(' | ')} |` })
  }
  const updated = applyPatches(expanded, changes)
  return updated === source ? null : { from: offset, to: offset + source.length, insert: updated }
}
