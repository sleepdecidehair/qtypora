import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import type { Tree } from '@lezer/common'

export interface UnderlineRange { from: number; contentFrom: number; contentTo: number; to: number }

/** Pair exact inline tags recognized by the Markdown syntax tree, never markup inside code. */
export function underlineRanges(state: EditorState, tree: Tree = syntaxTree(state)): UnderlineRange[] {
  const ranges: UnderlineRange[] = []
  const stack: { from: number; to: number; line: number }[] = []
  tree.iterate({ enter(node) {
    if (node.name !== 'HTMLTag') return
    const tag = state.doc.sliceString(node.from, node.to).toLowerCase()
    if (tag === '<u>') stack.push({ from: node.from, to: node.to, line: state.doc.lineAt(node.from).number })
    else if (tag === '</u>') {
      const opening = stack.pop()
      if (opening && opening.line === state.doc.lineAt(node.from).number) ranges.push({ from: opening.from, contentFrom: opening.to, contentTo: node.from, to: node.to })
    }
  } })
  return ranges
}

/** Toggle only a whole safe inline selection; ambiguous partial ranges are left untouched. */
export function toggleUnderline(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const { from, to, empty } = state.selection.main
  const pairs = underlineRanges(state, tree)
  const exact = pairs.find(pair => (from === pair.contentFrom && to === pair.contentTo) || (from === pair.from && to === pair.to) || (empty && from >= pair.contentFrom && from <= pair.contentTo))
  if (exact) return {
    changes: [{ from: exact.from, to: exact.contentFrom }, { from: exact.contentTo, to: exact.to }],
    selection: empty ? EditorSelection.cursor(from - (exact.contentFrom - exact.from)) : EditorSelection.range(exact.from, exact.from + exact.contentTo - exact.contentFrom),
    annotations: isolateHistory.of('full'), userEvent: 'input.underline', scrollIntoView: true,
  }
  if (empty || state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return null
  // Never insert between the halves of a surrogate pair.
  const splitsSurrogate = (position: number): boolean => position > 0 && position < state.doc.length && /[\uD800-\uDBFF]/.test(state.doc.sliceString(position - 1, position)) && /[\uDC00-\uDFFF]/.test(state.doc.sliceString(position, position + 1))
  if (splitsSurrogate(from) || splitsSurrogate(to)) return null
  if (pairs.some(pair => from < pair.to && to > pair.from)) return null
  let unsafe = false
  tree.iterate({ from, to, enter(node) {
    if (node.to <= from || node.from >= to) return
    if (node.name === 'Escape' && (from > node.from || to < node.to)) unsafe = true
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLTag', 'HTMLBlock', 'Image', 'URL', 'Autolink'].includes(node.name)) unsafe = true
    if (['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Link'].includes(node.name) && !(from <= node.from && to >= node.to) && !(from > node.from && to < node.to)) unsafe = true
    if (['EmphasisMark', 'LinkMark', 'CodeMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark', 'ListMark'].includes(node.name) && !(from <= node.from && to >= node.to && node.name !== 'HeaderMark' && node.name !== 'QuoteMark' && node.name !== 'ListMark')) unsafe = true
  } })
  // Extensions are parsed outside Lezer; don't split their delimiters or bodies.
  const line = state.doc.lineAt(from)
  for (const pattern of [/(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$/g, /(?<!\\)==[^=\n]+==/g, /(?<!\\)~(?!~)[^~\n]+~/g, /(?<!\\)\^[^^\n]+\^/g]) {
    for (const match of line.text.matchAll(pattern)) {
      const start = line.from + match.index, end = start + match[0].length
      if (from < end && to > start) unsafe = true
    }
  }
  if (unsafe) return null
  return { changes: [{ from, insert: '<u>' }, { from: to, insert: '</u>' }], selection: EditorSelection.range(from + 3, to + 3), annotations: isolateHistory.of('full'), userEvent: 'input.underline', scrollIntoView: true }
}
