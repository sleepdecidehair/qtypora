import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

/** Wrap only plain text lines inside one top-level paragraph; preserve all original bytes. */
export function underlineMultiline(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || state.selection.main.empty) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const { from, to, anchor } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to > from && state.doc.sliceString(to - 1, to) === '\n' ? to - 1 : to)
  if (first.number === last.number) return null
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const isBoundary = (position: number): boolean => {
    const line = state.doc.lineAt(position)
    return position === line.to || [...graphemes.segment(line.text)].some(segment => line.from + segment.index === position)
  }
  if (!isBoundary(from) || !isBoundary(to)) return null
  const startNode = tree.resolveInner(from, 1)
  let paragraph = startNode
  while (paragraph.parent && paragraph.name !== 'Paragraph') paragraph = paragraph.parent
  if (paragraph.name !== 'Paragraph' || paragraph.parent?.name !== 'Document' || from < paragraph.from || to > paragraph.to) return null
  const selected = state.doc.sliceString(from, to)
  // Do not reinterpret HTML, escaped punctuation, inline math or Markdown delimiters.
  if (/[\\<>&`*_~^$\[\]]/.test(selected)) return null
  let unsafe = false
  tree.iterate({ from, to, enter(node) {
    if (node.to <= from || node.from >= to) return
    if (['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Link', 'Image', 'InlineCode', 'Autolink', 'HTMLTag', 'Escape'].includes(node.name)) unsafe = true
  } })
  if (unsafe) return null
  const parts: { from: number; to: number }[] = []
  for (let number = first.number; number <= last.number; number++) {
    const line = state.doc.line(number)
    const start = Math.max(from, line.from), end = Math.min(to, line.to)
    const text = state.doc.sliceString(start, end)
    const leading = text.match(/^\s*/)?.[0].length ?? 0
    const trailing = text.match(/\s*$/)?.[0].length ?? 0
    if (leading < text.length - trailing) parts.push({ from: start + leading, to: end - trailing })
  }
  if (!parts.length) return null
  const changes = parts.flatMap(part => [{ from: part.from, insert: '<u>' }, { from: part.to, insert: '</u>' }])
  const mappedFrom = from + (parts[0].from === from ? 3 : 0)
  const mappedTo = to + 7 * parts.length - (parts[parts.length - 1].to === to ? 4 : 0)
  return { changes, selection: anchor === from ? EditorSelection.range(mappedFrom, mappedTo) : EditorSelection.range(mappedTo, mappedFrom), annotations: isolateHistory.of('full'), userEvent: 'input.underline', scrollIntoView: true }
}
