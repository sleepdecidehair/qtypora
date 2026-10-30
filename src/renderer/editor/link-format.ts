import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { getMarkdownParser } from './markdown-parser'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'

/** Insert a link only when Markdown preserves the selected content and target. */
export function linkFormatTransaction(state: EditorState, value?: string): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  const { from, to } = state.selection.main
  const selected = state.doc.sliceString(from, to) || '链接文字'
  const url = value || 'https://example.com'
  if (selected.length > 200000 || url.length > 4096 || /[\r\n]/.test(url)) return null
  const protectedRanges: { from: number; to: number }[] = []
  let unsafe = false
  tree.iterate({ from, to: Math.min(state.doc.length, Math.max(to, from + 1)), enter(node) {
    if (node.name === 'HTMLTag') { unsafe = true; return false }
    if (node.name !== 'InlineCode') return
    if (node.to <= from || node.from >= to) return false
    if (node.from < from || node.to > to) { unsafe = true; return false }
    protectedRanges.push({ from: node.from - from, to: node.to - from })
    return false
  } })
  if (unsafe) return null
  const stack: number[] = [], escape = new Set<number>()
  let rangeIndex = 0
  for (let i = 0; i < selected.length; i++) {
    while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex].to <= i) rangeIndex++
    const range = protectedRanges[rangeIndex]
    if (range && i >= range.from) { i = range.to - 1; continue }
    if (selected[i] === '\\') { if (i + 1 < selected.length) i++; else escape.add(i); continue }
    if (selected[i] === '[') stack.push(i)
    else if (selected[i] === ']') { if (stack.length) stack.pop(); else escape.add(i) }
  }
  for (const index of stack) escape.add(index)
  let label = ''
  for (let i = 0; i < selected.length; i++) label += (escape.has(i) ? '\\' : '') + selected[i]
  const insert = `[${label}](${url})`
  try {
    // Reference definitions can change inline parsing; avoid an unbounded document parse.
    if (selected.includes('[') && state.doc.length > 200000) return null
    const model = selected.includes('[') ? markdownDocumentModel(state) : null
    const parser = model?.parser ?? getMarkdownParser(state.facet(markdownOptionsFacet))
    const env = { references: model?.environment.references }
    const original = parser.parseInline(selected, env)[0]?.children
    const result = parser.parseInline(insert, env)[0]?.children
    if (!original || !result || result[0]?.type !== 'link_open' || result.at(-1)?.type !== 'link_close') return null
    if (original.some(token => token.type === 'link_open')) return null
    if (result[0].attrGet('href') !== url) return null
    if (parser.renderer.renderInline(original, parser.options, env) !== parser.renderer.renderInline(result.slice(1, -1), parser.options, env)) return null
  } catch { return null }
  const start = from + label.length + 3
  return { changes: { from, to, insert }, selection: EditorSelection.single(start, start + url.length), annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true }
}
