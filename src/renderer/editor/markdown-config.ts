import { Facet, type EditorState, type Text } from '@codemirror/state'
import { DEFAULT_MARKDOWN_OPTIONS, effectiveMarkdownOptions, type MarkdownOptions } from '../../shared/markdown-options'

export const markdownOptionsFacet = Facet.define<MarkdownOptions, MarkdownOptions>({
  combine: values => effectiveMarkdownOptions(values[0] ?? DEFAULT_MARKDOWN_OPTIONS),
})

import { getMarkdownParser } from './markdown-parser'
import { editorLocale } from './editor-i18n'
import type { MathExpression } from './markdown-features'

interface ParsedDocument {
  parser: ReturnType<typeof getMarkdownParser>
  tokens: ReturnType<ReturnType<typeof getMarkdownParser>['parse']>
  environment: Record<string, unknown>
  mathExpressions: MathExpression[]
  mathKey: string
}
const documentCache = new WeakMap<Text, Map<string, ParsedDocument>>()

export function markdownDocumentModel(state: EditorState): ParsedDocument {
  const options = state.facet(markdownOptionsFacet)
  const locale = state.facet(editorLocale)
  const key = JSON.stringify([options, locale])
  let configurations = documentCache.get(state.doc)
  const previous = configurations?.get(key)
  if (previous) return previous
  if (!configurations) { configurations = new Map(); documentCache.set(state.doc, configurations) }
  const parser = getMarkdownParser(options)
  const environment: Record<string, unknown> = { locale }
  const tokens = parser.parse(state.doc.toString(), environment)
  const mathExpressions = environment.mathExpressions as MathExpression[]
  const mathKey = JSON.stringify([options.mathNumbering, mathExpressions.map(({ source, display }) => [source, display])])
  const result = { parser, tokens, environment, mathExpressions, mathKey }
  if (configurations.size >= 4) configurations.delete(configurations.keys().next().value!)
  configurations.set(key, result)
  return result
}
