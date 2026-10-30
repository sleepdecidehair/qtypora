import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { liveBlocks } from './live-blocks'
import { supportsPreview } from './preview-budget'

/** Toggle an exact single-line plain selection without splitting Markdown. */
export function toggleHtmlComment(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || state.selection.main.empty || !supportsPreview(state)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const { from, to } = state.selection.main
  const line = state.doc.lineAt(from)
  if (state.doc.lineAt(to).number !== line.number) return null
  const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), item => line.from + item.index))
  boundaries.add(line.to)
  if (!boundaries.has(from) || !boundaries.has(to)) return null
  const comments = [...line.text.matchAll(/<!--(?:(?!--)[^\n])*-->/g)].map(match => ({ from: line.from + match.index, to: line.from + match.index + match[0].length }))
  const exact = comments.find(range => (from === range.from && to === range.to) || (from === range.from + 4 && to === range.to - 3))
  const start = exact?.from ?? from, end = exact?.to ?? to
  let unsafe = false
  tree.iterate({ from: start, to: end, enter(node) {
    if (node.from >= end || node.to <= start) return
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Image', 'Link', 'Autolink', 'URL', 'Entity', 'Escape', 'Emphasis', 'StrongEmphasis', 'Strikethrough', 'HeaderMark', 'QuoteMark', 'ListMark'].includes(node.name)) unsafe = true
    if ((node.name === 'Comment' || node.name === 'CommentBlock') && (!exact || node.from !== exact.from || node.to !== exact.to)) unsafe = true
  } })
  if (!exact && liveBlocks(state).some(block => start < block.to && end > block.from)) unsafe = true
  for (const expression of [/\$(?!\$)[^$\n]+\$/g, /==[^=\n]+==/g, /(?<!~)~[^~\n]+~(?!~)/g, /\^[^^\n]+\^/g]) {
    for (const match of line.text.matchAll(expression)) {
      const left = line.from + match.index, right = left + match[0].length
      if (start < right && end > left) unsafe = true
    }
  }
  if (unsafe) return null
  if (exact) return { changes: [{ from: exact.from, to: exact.from + 4 }, { from: exact.to - 3, to: exact.to }], selection: EditorSelection.range(exact.from, exact.to - 7), annotations: isolateHistory.of('full'), userEvent: 'input.html-comment', scrollIntoView: true }
  const selected = state.doc.sliceString(from, to)
  if (!selected.trim() || selected.includes('--') || selected.startsWith('>') || selected.startsWith('->') || selected.endsWith('-') || /[<>]/.test(selected)) return null
  return { changes: [{ from, insert: '<!--' }, { from: to, insert: '-->' }], selection: EditorSelection.range(from + 4, to + 4), annotations: isolateHistory.of('full'), userEvent: 'input.html-comment', scrollIntoView: true }
}
