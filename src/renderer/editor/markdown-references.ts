import type MarkdownIt from 'markdown-it'
import type { MarkdownOptions } from '../../shared/markdown-options'
import type Token from 'markdown-it/lib/token.mjs'

export interface MarkdownDefinition {
  kind: 'footnote' | 'reference'
  label: string
  line: number
  endLine: number
}
export interface FootnoteEnvironment {
  refs?: Record<string, number>
  list?: { label?: string; count?: number }[]
}

export function markdownDefinitions(environment: Record<string, unknown>): MarkdownDefinition[] {
  return (environment.markdownDefinitions as MarkdownDefinition[] | undefined) ?? []
}

export function installReferenceLocations(parser: MarkdownIt, options: MarkdownOptions): void {
  for (const [name, kind] of [['reference', 'reference'], ['footnote_def', 'footnote']] as const) {
    if (kind === 'footnote' && !options.footnotes) continue
    const rule = parser.block.ruler.getRules('').find(candidate => candidate.name === name)
    if (!rule) continue
    parser.block.ruler.at(name, (state, start, end, silent) => {
      const accepted = rule(state, start, end, silent)
      if (!accepted || silent) return accepted
      const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
      const label = first.match(kind === 'footnote' ? /^\[\^([^\]]+)\]:/ : /^\[([^\]]+)\]:/)?.[1]
      if (label) {
        const definitions = state.env.markdownDefinitions ??= []
        definitions.push({ kind, label, line: start + 1, endLine: state.line })
      }
      return accepted
    }, { alt: kind === 'footnote' ? ['paragraph', 'reference'] : [] })
  }
}

const footnoteHtml = new WeakMap<object, Map<string, string>>()

export function renderedFootnoteDefinition(parser: MarkdownIt, tokens: Token[], environment: Record<string, unknown>, label: string): string {
  let rendered = footnoteHtml.get(environment)
  if (!rendered) {
    rendered = new Map<string, string>()
    for (let start = 0; start < tokens.length; start++) {
      if (tokens[start].type !== 'footnote_open' || typeof tokens[start].meta?.label !== 'string') continue
      let end = start + 1
      while (end < tokens.length && tokens[end].type !== 'footnote_close') end++
      if (end === tokens.length) continue
      const id = Number(tokens[start].meta.id) + 1
      const html = `<section class="md-footnote-definition"><ol start="${id}">${parser.renderer.render(tokens.slice(start, end + 1), parser.options, environment)}</ol></section>`
      rendered.set(tokens[start].meta.label, html)
      start = end
    }
    footnoteHtml.set(environment, rendered)
  }
  return rendered.get(label) ?? ''
}
