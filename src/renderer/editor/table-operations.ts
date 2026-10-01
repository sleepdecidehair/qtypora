import type { ContextMenuAction } from '../../shared/contracts'
import { parseTableSource } from './table-model'

export interface SourcePatch { from: number; to: number; insert: string }

function rowLayout(line: string): { from: number; to: number }[] {
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
    const from = starts[sourceRow] - 1
    return [{ from, to: starts[sourceRow] + lines[sourceRow].length, insert: '' }]
  }
  if (action === 'table-row-before' || action === 'table-row-after') {
    const emptyRow = `| ${Array.from({ length: model.columns }, () => ' ').join(' | ')} |`
    if (row === 0 && action === 'table-row-before') return [
      { from: offset, to: offset + lines[0].length, insert: emptyRow },
      { from: starts[2] ?? offset + source.length, to: starts[2] ?? offset + source.length, insert: starts[2] === undefined ? `\n${lines[0]}` : `${lines[0]}\n` },
    ]
    const index = row === 0 ? 2 : sourceRow + (action === 'table-row-after' ? 1 : 0)
    return index >= lines.length ? [{ from: offset + source.length, to: offset + source.length, insert: `\n${emptyRow}` }] : [{ from: starts[index], to: starts[index], insert: `${emptyRow}\n` }]
  }
  const patches: SourcePatch[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    const cells = rowLayout(lines[index])
    const cell = cells[column]
    if (!cell) return null
    if (action.startsWith('table-align-')) {
      if (index !== 1) continue
      const raw = lines[index].slice(cell.from, cell.to)
      const marker = action === 'table-align-center' ? ':---:' : action === 'table-align-right' ? '---:' : ':---'
      patches.push({ from: starts[index] + cell.from, to: starts[index] + cell.to, insert: `${raw.match(/^\s*/)?.[0] || ''}${marker}${raw.match(/\s*$/)?.[0] || ''}` })
    } else if (action === 'table-column-before' || action === 'table-column-after') {
      const after = action === 'table-column-after'
      const at = after ? cell.to : cell.from
      const value = index === 1 ? ' --- ' : '   '
      patches.push({ from: starts[index] + at, to: starts[index] + at, insert: after ? `|${value}` : `${value}|` })
    } else if (action === 'table-column-delete') {
      if (model.columns === 1) return null
      // Remove one separator with the cell, leaving all other cell bytes untouched.
      const from = column === 0 ? cell.from : cell.from - 1
      const to = column === 0 ? cell.to + 1 : cell.to
      patches.push({ from: starts[index] + from, to: starts[index] + to, insert: '' })
    } else return null
  }
  return patches
}
