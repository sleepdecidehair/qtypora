import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'

/** Toggle a complete selected expression; ambiguous syntax is left untouched. */
export function toggleInlineMath(state: EditorState): TransactionSpec | null {
  const options = state.facet(markdownOptionsFacet)
  if (state.readOnly || state.selection.ranges.length !== 1 || state.selection.main.empty || options.strictMode || !options.inlineMath || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const { from, to } = state.selection.main
  const line = state.doc.lineAt(from)
  if (state.doc.lineAt(to).number !== line.number) return null
  const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), segment => line.from + segment.index))
  boundaries.add(line.to)
  if (!boundaries.has(from) || !boundaries.has(to)) return null
  const maths = [...line.text.matchAll(/(?<!\\)\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?![\d$])/g)]
    .map(match => ({ from: line.from + match.index, to: line.from + match.index + match[0].length }))
  const exact = maths.find(range => (from === range.from && to === range.to) || (from === range.from + 1 && to === range.to - 1))
  const start = exact?.from ?? from, end = exact?.to ?? to
  if (liveBlocks(state).some(block => start < block.to && end > block.from)) return null
  let unsafe = false
  tree.iterate({ from: start, to: end, enter(node) {
    if (node.to <= start || node.from >= end) return
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Image', 'Link', 'Autolink', 'URL', 'Entity', 'Emphasis', 'StrongEmphasis', 'Strikethrough', 'HeaderMark', 'QuoteMark', 'ListMark'].includes(node.name)) unsafe = true
    if (node.name === 'Escape' && (start > node.from || end < node.to)) unsafe = true
  } })
  for (const expression of [/\$(?!\$)[^$\n]+\$/g, /==[^=\n]+==/g, /(?<!~)~[^~\n]+~(?!~)/g, /\^[^^\n]+\^/g]) {
    for (const match of line.text.matchAll(expression)) {
      const left = line.from + match.index, right = left + match[0].length
      if (start < right && end > left && !(exact && left === exact.from && right === exact.to)) unsafe = true
    }
  }
  if (unsafe) return null
  if (exact) return {
    changes: [{ from: exact.from, to: exact.from + 1 }, { from: exact.to - 1, to: exact.to }],
    selection: EditorSelection.range(exact.from, exact.to - 2), annotations: isolateHistory.of('full'), userEvent: 'input.inline-math', scrollIntoView: true,
  }
  const selected = state.doc.sliceString(from, to)
  const prefix = line.text.slice(0, from - line.from)
  if (!selected || selected.length > 8190 || /^\s|\s$/.test(selected) || /[$`\[\]<>]/.test(selected) || selected.endsWith('\\')
    || (prefix.match(/\\+$/)?.[0].length ?? 0) % 2 || prefix.endsWith('$') || /[\d$]/.test(state.doc.sliceString(to, Math.min(line.to, to + 1)))) return null
  return { changes: [{ from, insert: '$' }, { from: to, insert: '$' }], selection: EditorSelection.range(from + 1, to + 1), annotations: isolateHistory.of('full'), userEvent: 'input.inline-math', scrollIntoView: true }
}
