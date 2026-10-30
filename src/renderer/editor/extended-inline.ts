import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'
import { liveBlocks } from './live-blocks'

export type ExtendedInlineKind = 'highlight' | 'superscript' | 'subscript'
const DELIMITER: Record<ExtendedInlineKind, string> = { highlight: '==', superscript: '^', subscript: '~' }
const patterns: Record<ExtendedInlineKind, RegExp> = {
  highlight: /(?<![\\=])==(?=\S)([^=\n]*?\S)==(?![=])/g,
  superscript: /(?<![\\^])\^([^\s^\\]+)\^(?![\^])/g,
  subscript: /(?<![\\~])~([^\s~\\]+)~(?![~])/g,
}

/** Toggle a complete plain inline span, never modifying ambiguous Markdown syntax. */
export function toggleExtendedInline(state: EditorState, kind: ExtendedInlineKind): TransactionSpec | null {
  const options = state.facet(markdownOptionsFacet)
  if (state.readOnly || state.selection.ranges.length !== 1 || options.strictMode || !options[kind] || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const { from, to, empty } = state.selection.main
  const line = state.doc.lineAt(from)
  if (state.doc.lineAt(to).number !== line.number) return null
  const delimiter = DELIMITER[kind]
  const matches = [...line.text.matchAll(patterns[kind])].map(match => ({ from: line.from + match.index, to: line.from + match.index + match[0].length }))
  const exact = matches.find(range => (empty && from >= range.from + delimiter.length && from <= range.to - delimiter.length)
    || (from === range.from && to === range.to) || (from === range.from + delimiter.length && to === range.to - delimiter.length))
  const start = exact?.from ?? from, end = exact?.to ?? to
  if (empty && !exact) return null
  if (start === end) return null
  if (liveBlocks(state).some(block => start < block.to && end > block.from)) return null
  const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), segment => line.from + segment.index))
  boundaries.add(line.to)
  if (!boundaries.has(from) || !boundaries.has(to)) return null
  let unsafe = false
  tree.iterate({ from: start, to: end, enter(node) {
    if (node.to <= start || node.from >= end) return
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Image', 'Link', 'Autolink', 'URL', 'Escape', 'Entity', 'Emphasis', 'StrongEmphasis', 'Strikethrough', 'HeaderMark', 'QuoteMark', 'ListMark'].includes(node.name)) unsafe = true
  } })
  // Extended syntax and math are not all represented in the Lezer tree.
  for (const expression of [/\$(?!\$)[^$\n]+\$/g, /==[^=\n]+==/g, /(?<!~)~[^~\n]+~(?!~)/g, /\^[^^\n]+\^/g]) {
    for (const match of line.text.matchAll(expression)) {
      const left = line.from + match.index, right = left + match[0].length
      if (start < right && end > left && !(exact && left === exact.from && right === exact.to)) unsafe = true
    }
  }
  if (unsafe) return null
  if (exact) {
    const contentFrom = exact.from + delimiter.length, contentTo = exact.to - delimiter.length
    return { changes: [{ from: exact.from, to: contentFrom }, { from: contentTo, to: exact.to }],
      selection: empty ? EditorSelection.cursor(from - delimiter.length) : EditorSelection.range(exact.from, exact.from + contentTo - contentFrom),
      annotations: isolateHistory.of('full'), userEvent: 'input.extended-inline', scrollIntoView: true }
  }
  const selected = state.doc.sliceString(from, to)
  if (!selected.trim() || /^\s|\s$/.test(selected) || /[\\`\[\]<>$=~^]/.test(selected) || (kind !== 'highlight' && /\s/.test(selected))) return null
  if (state.doc.sliceString(Math.max(line.from, from - 1), from) === delimiter[0] || state.doc.sliceString(to, Math.min(line.to, to + 1)) === delimiter[0]) return null
  return { changes: [{ from, insert: delimiter }, { from: to, insert: delimiter }], selection: EditorSelection.range(from + delimiter.length, to + delimiter.length), annotations: isolateHistory.of('full'), userEvent: 'input.extended-inline', scrollIntoView: true }
}
