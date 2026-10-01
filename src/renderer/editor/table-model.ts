export interface TableCellSource { from: number; to: number; content: string; row: number; column: number; line: number }
export interface TableSource { cells: TableCellSource[]; rows: number; columns: number }

function splitRow(line: string, offset: number, row: number, sourceLine: number): TableCellSource[] {
  const pipes: number[] = []
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== '|') continue
    let backslashes = 0
    for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous--) backslashes++
    if (backslashes % 2 === 0) pipes.push(index)
  }
  const boundaries = [-1, ...pipes, line.length]
  const segments = boundaries.slice(0, -1).map((start, index) => ({ start: start + 1, end: boundaries[index + 1] }))
  if (pipes.length && !line.slice(0, pipes[0]).trim()) segments.shift()
  if (pipes.length && !line.slice(pipes.at(-1)! + 1).trim()) segments.pop()
  return segments.map(({ start, end }, column) => {
    const raw = line.slice(start, end)
    const left = raw.match(/^\s*/)?.[0].length || 0
    const right = raw.match(/\s*$/)?.[0].length || 0
    const from = start + (raw.trim() ? left : Math.min(1, left))
    const to = raw.trim() ? end - right : from
    return { from: offset + from, to: offset + to, content: line.slice(from, to), row, column, line: sourceLine }
  })
}

export function parseTableSource(source: string, offset = 0, firstLine = 1): TableSource {
  const lines = source.split('\n')
  const cells: TableCellSource[] = []
  let currentOffset = offset
  let row = 0
  for (let index = 0; index < lines.length; index++) {
    if (index !== 1 && lines[index].trim()) { cells.push(...splitRow(lines[index], currentOffset, row, firstLine + index)); row++ }
    currentOffset += lines[index].length + 1
  }
  return { cells, rows: row, columns: cells.filter((cell) => cell.row === 0).length }
}

export function escapeCellInput(content: string): string {
  return content.replace(/\r?\n/g, '<br>').replace(/(\\*)\|/g, (match: string, slashes: string) => slashes.length % 2 ? match : `${slashes}\\|`)
}

export function tableCellEdit(cell: TableCellSource, content: string): { from: number; to: number; insert: string } | null {
  const insert = escapeCellInput(content)
  return insert === cell.content ? null : { from: cell.from, to: cell.to, insert }
}
