import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { parseTableSource } from './table-model'
import { tableOperation } from './table-operations'
import { supportsPreview } from './preview-budget'

interface Target { from: number; to: number; deleteFrom: number; deleteTo: number }

/** Resolve a source-safe sentence, code line, or table row for an empty caret. */
export function lineSentenceTarget(state: EditorState, mode: 'hybrid' | 'source'): Target | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  if (mode === 'source') {
    const from = line.number === state.doc.lines && line.number > 1 ? line.from - 1 : line.from
    const to = line.number < state.doc.lines ? line.to + 1 : line.to
    return { from: line.from, to: line.to, deleteFrom: from, deleteTo: to }
  }
  if (!supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const live = liveBlocks(state).find(block => position >= block.from && position <= block.to)
  if (live?.kind === 'table') {
    const model = parseTableSource(live.source, live.from, live.firstLine)
    const cell = model.cells.find(candidate => candidate.line === line.number)
    if (!cell) return null
    const patch = tableOperation(live.source, live.from, cell.row, cell.column, 'table-row-delete')?.[0]
    return { from: line.from, to: line.to, deleteFrom: patch?.from ?? line.from, deleteTo: patch?.to ?? line.from }
  }
  if (live && !['math', 'mermaid'].includes(live.kind)) return null
  let node = tree.resolveInner(line.length ? Math.min(position, line.to - 1) : position, 1)
  let fence: typeof node | null = null
  let paragraph: typeof node | null = null
  let structured = false
  for (let current: typeof node | null = node; current; current = current.parent) {
    if (current.name === 'FencedCode' || current.name === 'CodeBlock') fence = current
    if (!paragraph && current.name === 'Paragraph') paragraph = current
    if (current.name === 'Blockquote' || current.name === 'ListItem') structured = true
  }
  if (fence || live?.kind === 'math' || live?.kind === 'mermaid') {
    const first = live?.firstLine ?? state.doc.lineAt(fence!.from).number
    const last = live?.lastLine ?? state.doc.lineAt(fence!.to).number
    if (fence?.name === 'CodeBlock' && !live) {
      const deleteFrom = first === last ? line.from : line.number === last ? line.from - 1 : line.from
      const deleteTo = first === last ? line.to : line.number === last ? line.to : line.to + 1
      return { from: line.from, to: line.to, deleteFrom, deleteTo }
    }
    if (line.number <= first || line.number >= last) return null
    // Keep an empty body line when there is only one, preserving both delimiters.
    const deleteFrom = last - first === 2 ? line.from : line.number === last - 1 ? line.from - 1 : line.from
    const deleteTo = last - first === 2 ? line.to : line.number === last - 1 ? line.to : line.to + 1
    return { from: line.from, to: line.to, deleteFrom, deleteTo }
  }
  if (!line.text.trim()) {
    if (state.doc.lines === 1) return null
    const from = line.number === state.doc.lines ? line.from - 1 : line.from
    return { from: line.from, to: line.to, deleteFrom: from, deleteTo: line.number === state.doc.lines ? line.to : line.to + 1 }
  }
  if (!paragraph) return null
  const text = state.doc.sliceString(paragraph.from, paragraph.to)
  // Prefix markers on continuation lines belong to the enclosing block, not text.
  if (structured && text.includes('\n')) return null
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text.replaceAll('\n', ' '))]
  const offset = position - paragraph.from
  const segment = segments.find(item => offset >= item.index && offset < item.index + item.segment.length) ?? segments.at(-1)
  if (!segment) return null
  const from = paragraph.from + segment.index, to = from + segment.segment.length
  let unsafe = false
  tree.iterate({ from, to, enter(item) {
    if (['Emphasis', 'StrongEmphasis', 'Strikethrough', 'InlineCode', 'Link', 'Image', 'Autolink', 'HTMLTag'].includes(item.name) && (item.from < from || item.to > to)) unsafe = true
  } })
  for (const pattern of [/(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$/g, /(?<!\\)==[^=\n]+==/g, /(?<!\\)~(?!~)[^~\n]+~/g, /(?<!\\)\^[^^\n]+\^/g]) {
    for (const match of text.matchAll(pattern)) {
      const start = paragraph.from + match.index, end = start + match[0].length
      if (start < to && end > from && (start < from || end > to)) unsafe = true
    }
  }
  return unsafe ? null : { from, to, deleteFrom: from, deleteTo: to }
}

export function selectLineSentence(state: EditorState, mode: 'hybrid' | 'source'): TransactionSpec | null {
  const target = lineSentenceTarget(state, mode)
  return target && target.from < target.to ? { selection: EditorSelection.range(target.from, target.to), userEvent: 'select.line-sentence', scrollIntoView: true } : null
}

export function deleteLineSentence(state: EditorState, mode: 'hybrid' | 'source'): TransactionSpec | null {
  if (state.readOnly) return null
  const target = lineSentenceTarget(state, mode)
  if (!target || target.deleteFrom === target.deleteTo) return null
  return { changes: { from: target.deleteFrom, to: target.deleteTo, insert: '' }, selection: { anchor: target.deleteFrom }, annotations: isolateHistory.of('full'), userEvent: 'delete.line-sentence', scrollIntoView: true }
}
