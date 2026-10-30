import type { EditorState, Text } from '@codemirror/state'
import { markdownDocumentModel } from './markdown-config'
import { markdownOptionsFacet } from './markdown-config'

const MAX_SEMANTIC_PARSE = 200000
const candidates = new WeakMap<Text, { math: boolean; front: boolean }>()

/** Lezer does not recognize the app's YAML and block-math extensions. */
export function canFormatSemanticLines(state: EditorState, from: number, to: number): boolean {
  let candidate = candidates.get(state.doc)
  if (!candidate) {
    const text = state.doc.toString()
    candidate = { math: text.includes('$$'), front: /^---(?:\n|$)/.test(text) }
    candidates.set(state.doc, candidate)
  }
  if (!candidate.math && !candidate.front) return true
  // In large documents, any earlier $$ may start an unclosed formula: reject
  // unless the complete preceding source proves there is no such delimiter.
  if (state.doc.length > MAX_SEMANTIC_PARSE) {
    const first = state.doc.lineAt(from).number
    if (candidate.front) {
      let end = 0
      for (let line = 2; line <= Math.min(state.doc.lines, 2001); line++) {
        if (/^(?:---|\.\.\.)\s*$/.test(state.doc.line(line).text)) { end = line; break }
      }
      if (!end || first <= end) return false
    }
    if (candidate.math) {
      if (state.doc.sliceString(0, Math.min(state.doc.length, to + 1)).includes('$$')) return false
    }
    return true
  }
  try {
    const { tokens } = markdownDocumentModel(state)
    const spans = tokens.flatMap(token => {
      if (!token.map || !['math_block', 'front_matter', 'fence', 'code_block', 'html_block'].includes(token.type)) return []
      const [first, last] = token.map
      if (first >= state.doc.lines || last <= first) return []
      return [{ type: token.type, from: state.doc.line(first + 1).from, to: state.doc.line(Math.min(last, state.doc.lines)).to }]
    })
    if (spans.some(span => (span.type === 'math_block' || span.type === 'front_matter') && span.from <= to && span.to > from)) return false
    if (candidate.math && !state.facet(markdownOptionsFacet).strictMode) {
      const prefix = state.doc.sliceString(0, Math.min(state.doc.length, to + 1))
      spans.sort((left, right) => left.from - right.from)
      let next = 0, coveredTo = -1, markers = 0
      for (let index = prefix.indexOf('$$'); index >= 0; index = prefix.indexOf('$$', index + 2)) {
        if (++markers > 5000) return false
        while (next < spans.length && spans[next].from <= index) coveredTo = Math.max(coveredTo, spans[next++].to)
        if (coveredTo < index + 2) return false
      }
    }
    return true
  } catch { return false }
}
