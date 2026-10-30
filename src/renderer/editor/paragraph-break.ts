import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'

function mathRanges(text: string): Array<{ index: number; length: number }> {
  const ranges: Array<{ index: number; length: number }> = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '$' || text[start + 1] === '$' || !text[start + 1] || /\s/.test(text[start + 1])) continue
    let slashes = 0
    for (let index = start - 1; index >= 0 && text[index] === '\\'; index--) slashes++
    if (slashes % 2) continue
    let end = start + 1
    for (;;) {
      end = text.indexOf('$', end)
      if (end < 0 || end - start > 8192) break
      if (text[end - 1] !== '\\' && !/\s/.test(text[end - 1])) break
      end++
    }
    if (end < 0 || end - start > 8192 || /\d/.test(text[end + 1] || '')) continue
    ranges.push({ index: start, length: end + 1 - start })
    start = end
  }
  return ranges
}

/** Split a simple top-level paragraph without crossing Markdown syntax or containers. */
export function paragraphBreak(state: EditorState, mode: 'source' | 'hybrid'): TransactionSpec | 'blocked' | null {
  if (mode !== 'hybrid' || state.readOnly || state.selection.ranges.length !== 1) return null
  const selection = state.selection.main
  if (!selection.empty) {
    const { from, to } = selection
    const line = state.doc.lineAt(from)
    if (state.doc.lineAt(to).number !== line.number || from <= line.from || to >= line.to) return null
    if (/[\\`*_~^$<>\[\]!&#]/.test(state.doc.sliceString(from, to))) return null
    // Probe each endpoint with the same syntax and grapheme checks as a caret.
    for (const position of [from, to]) {
      const endpoint = state.update({ selection: EditorSelection.cursor(position) }).state
      const result = paragraphBreak(endpoint, mode)
      if (!result || result === 'blocked') return null
    }
    return { changes: { from, to, insert: '\n\n' }, selection: { anchor: from + 2 }, annotations: isolateHistory.of('full'), userEvent: 'input.break', scrollIntoView: true }
  }
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  const offset = position - line.from
  if (offset !== line.length) {
    let boundary = false
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text)) {
      if (segment.index >= offset) { boundary = segment.index === offset; break }
    }
    if (!boundary) return 'blocked'
  }
  let insideEntity = false
  for (const match of line.text.matchAll(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi)) {
    let slashes = 0
    for (let index = match.index - 1; index >= 0 && line.text[index] === '\\'; index--) slashes++
    if (slashes % 2 === 0 && offset > match.index && offset < match.index + match[0].length) insideEntity = true
  }
  const preview = supportsPreview(state)
  if (!preview && !insideEntity) return null
  const tree = ensureSyntaxTree(state, preview ? state.doc.length : position, 50)
  if (!tree) return insideEntity ? 'blocked' : null
  if (insideEntity) {
    let context = tree.resolveInner(position, 1)
    while (context.parent) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag'].includes(context.name)) return null
      context = context.parent
    }
    return 'blocked'
  }
  if (!preview) return null
  if (!line.text.trim() || liveBlocks(state).some(block => position >= block.from && position <= block.to)) return null
  const options = state.facet(markdownOptionsFacet)
  let paragraph = tree.resolveInner(position, 1)
  while (paragraph.parent && paragraph.name !== 'Paragraph') paragraph = paragraph.parent
  const mathStart = paragraph.name === 'Paragraph' ? paragraph.from : line.from
  const mathText = paragraph.name === 'Paragraph' ? state.doc.sliceString(paragraph.from, paragraph.to) : line.text
  const mathOffset = position - mathStart
  if (options.inlineMath && mathRanges(mathText).some(range => mathOffset > range.index && mathOffset < range.index + range.length)) {
    let context = tree.resolveInner(position, 1)
    let literal = false
    while (context.parent) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'Image'].includes(context.name)) { literal = true; break }
      context = context.parent
    }
    if (!literal) return 'blocked'
  }
  const patterns = [
    { enabled: options.highlight, expression: /==(?=\S)([^=\n]+?)==/g },
    { enabled: options.subscript, expression: /(?<!~)~([^~\s]+)~(?!~)/g },
    { enabled: options.superscript, expression: /\^([^\^\s]+)\^/g },
  ]
  for (const pattern of patterns) {
    if (!pattern.enabled) continue
    for (const match of line.text.matchAll(pattern.expression)) {
      if (offset <= match.index || offset >= match.index + match[0].length) continue
      let slashes = 0
      for (let index = match.index - 1; index >= 0 && line.text[index] === '\\'; index--) slashes++
      if (slashes % 2) continue
      let context = tree.resolveInner(line.from + match.index, 1)
      let literal = false
      while (context.parent) {
        if (['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'Image'].includes(context.name)) { literal = true; break }
        context = context.parent
      }
      if (!literal) return 'blocked'
    }
  }
  let node = tree.resolveInner(position, 1)
  while (node.parent && node.name !== 'Paragraph') {
    if (position > node.from && position < node.to && node.name !== 'Document') return null
    node = node.parent
  }
  if (node.name !== 'Paragraph' || node.parent?.name !== 'Document') return null
  const adjacent = position < node.to && state.doc.sliceString(position, position + 1) === '\n' ? position
    : position > node.from && state.doc.sliceString(position - 1, position) === '\n' ? position - 1 : null
  if (adjacent !== null) return { changes: { from: adjacent, to: adjacent + 1, insert: '\n\n' }, selection: { anchor: adjacent + 2 }, annotations: isolateHistory.of('full'), userEvent: 'input.break', scrollIntoView: true }
  return { changes: { from: position, insert: '\n\n' }, selection: { anchor: position + 2 }, annotations: isolateHistory.of('full'), userEvent: 'input.break', scrollIntoView: true }
}
