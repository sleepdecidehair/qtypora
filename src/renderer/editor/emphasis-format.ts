import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'
import { getMarkdownParser } from './markdown-parser'

/** Use parsed styles and verify that inserting delimiters preserves rendered content. */
export function emphasisTransaction(state: EditorState, kind: 'bold' | 'italic' | 'strike'): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  const { from, to, anchor, head } = state.selection.main
  let contextFrom = 0, contextTo = state.doc.length
  if (state.doc.length > 200000) {
    const line = state.doc.lineAt(from)
    if (to > line.to || /[\[\]]/.test(line.text)) return null
    let node = tree.resolveInner(from, 1)
    while (node.parent && node.name !== 'Paragraph') node = node.parent
    if (node.name !== 'Paragraph' || node.parent?.name !== 'Document' || node.from !== line.from || node.to !== line.to) return null
    contextFrom = line.from; contextTo = line.to
  }
  let parser: ReturnType<typeof getMarkdownParser>, references: unknown
  try {
    if (state.doc.length > 200000) { parser = getMarkdownParser(state.facet(markdownOptionsFacet)); references = undefined }
    else { const model = markdownDocumentModel(state); parser = model.parser; references = model.environment.references }
  } catch { return null }
  const original = state.doc.sliceString(contextFrom, contextTo)
  const relativeFrom = from - contextFrom, relativeTo = to - contextFrom
  const removeOne = (before: string, target: string, replacement: string, expected: string): boolean => {
    let index = before.indexOf(target)
    let attempts = 0
    while (index >= 0) {
      if (++attempts > 128) return false
      if (before.slice(0, index) + replacement + before.slice(index + target.length) === expected) return true
      index = before.indexOf(target, index + 1)
    }
    return false
  }
  let current: { from: number; to: number; innerFrom: number; innerTo: number } | null = null
  tree.iterate({ from, to: Math.min(state.doc.length, Math.max(to, from + 1)), enter(node) {
    if (node.name !== (kind === 'bold' ? 'StrongEmphasis' : kind === 'italic' ? 'Emphasis' : 'Strikethrough')) return
    const first = node.node.firstChild, last = node.node.lastChild
    const mark = kind === 'strike' ? 'StrikethroughMark' : 'EmphasisMark'
    if (!first || !last || first.name !== mark || last.name !== mark || first.to > last.from) return
    if ((from === node.from && to === node.to) || (from === first.to && to === last.from)) current = { from: node.from, to: node.to, innerFrom: first.to, innerTo: last.from }
  } })
  const reverse = anchor > head
  if (current) {
    const span = current as { from: number; to: number; innerFrom: number; innerTo: number }
    const insert = state.doc.sliceString(span.innerFrom, span.innerTo)
    try {
      const inner = parser.renderInline(insert, { references })
      const tag = kind === 'bold' ? 'strong' : kind === 'italic' ? 'em' : 's'
      const before = parser.render(original, { references })
      const after = parser.render(original.slice(0, span.from - contextFrom) + insert + original.slice(span.to - contextFrom), { references })
      if (!removeOne(before, `<${tag}>${inner}</${tag}>`, inner, after)) return null
    } catch { return null }
    const left = span.from, right = left + insert.length
    return { changes: { from: span.from, to: span.to, insert }, selection: EditorSelection.single(reverse ? right : left, reverse ? left : right), annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true }
  }
  const selected = state.doc.sliceString(from, to) || (kind === 'bold' ? '加粗文字' : kind === 'italic' ? '强调文字' : '删除文字')
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(selected)
  if (!match || !match[2] || /\n\s*\n/.test(selected)) return null
  const [, leading, core, trailing] = match
  try {
    const baseline = original.slice(0, relativeFrom) + selected + original.slice(relativeTo)
    const renderedBefore = parser.render(baseline, { references })
    const inner = parser.renderInline(core, { references })
    const tag = kind === 'bold' ? 'strong' : kind === 'italic' ? 'em' : 's'
    const target = `<${tag}>${inner}</${tag}>`
    for (const delimiter of kind === 'bold' ? ['**', '__'] : kind === 'italic' ? ['*', '_'] : ['~~']) {
      const insert = leading + delimiter + core + delimiter + trailing
      const after = parser.render(original.slice(0, relativeFrom) + insert + original.slice(relativeTo), { references })
      if (!removeOne(after, target, inner, renderedBefore)) continue
      const left = from + leading.length + delimiter.length, right = left + core.length
      return { changes: { from, to, insert }, selection: EditorSelection.single(reverse ? right : left, reverse ? left : right), annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true }
    }
  } catch { return null }
  return null
}
