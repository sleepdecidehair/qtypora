import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from '../../shared/markdown-options'
import { getMarkdownParser } from '../editor/markdown-parser'
import { indexHeadingTokens, type IndexedHeading } from '../editor/markdown-features'
import { markdownDefinitions, type FootnoteEnvironment } from '../editor/markdown-references'

export interface OutlineHeading { level: number; text: string; line: number }

export function headingIndex(content: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): IndexedHeading[] {
  return indexHeadingTokens(getMarkdownParser(options).parse(content, {}))
}

export function extractHeadings(content: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): OutlineHeading[] {
  return headingIndex(content, options).map(({ level, text, line }) => ({ level, text, line }))
}

export function resolveHeading(content: string, fragment: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): IndexedHeading | null {
  let slug: string
  try { slug = decodeURIComponent(fragment.replace(/^#/, '')) } catch { return null }
  return headingIndex(content, options).find(heading => heading.slug === slug) ?? null
}


export function resolveMathLabel(content: string, fragment: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): number | null {
  let label: string
  try { label = decodeURIComponent(fragment.replace(/^#/, '')) } catch { return null }
  if (!label.startsWith('mjx-eqn:')) return null
  label = label.slice('mjx-eqn:'.length)
  const environment: Record<string, unknown> = {}
  getMarkdownParser(options).parse(content, environment)
  const expressions = environment.mathExpressions as import('../editor/markdown-features').MathExpression[]
  for (const expression of expressions) {
    for (const match of expression.source.matchAll(/(?<!\\)\\label\s*\{([^{}]+)\}/g)) {
      if (match[1].replace(/\s/g, '_') === label) return expression.line
    }
  }
  return null
}


export function resolveFootnote(content: string, fragment: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): number | null {
  let value: string
  try { value = decodeURIComponent(fragment.replace(/^#/, '')) } catch { return null }
  const match = /^fn(ref)?(\d+)(?::(\d+))?$/.exec(value)
  if (!match || !options.footnotes) return null
  const environment: Record<string, unknown> = {}
  const tokens = getMarkdownParser(options).parse(content, environment)
  const id = Number(match[2]) - 1
  if (!match[1]) {
    const label = (environment.footnotes as FootnoteEnvironment | undefined)?.list?.[id]?.label
    return markdownDefinitions(environment).find(definition => definition.kind === 'footnote' && definition.label === label)?.line ?? null
  }
  for (const token of tokens) {
    if (token.type === 'footnote_block_open') break
    if (!token.map) continue
    let line = token.map[0] + 1
    for (const child of token.children ?? []) {
      if (child.type === 'softbreak' || child.type === 'hardbreak') line++
      if (child.type === 'footnote_ref' && child.meta?.id === id && Number(child.meta.subId ?? 0) === Number(match[3] ?? 0)) return line
    }
  }
  return null
}

/** Resolve HTML anchors only inside parsed HTML tokens; code examples and comments remain inert. */
export function resolveExplicitAnchor(content: string, fragment: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): number | null {
  let target: string
  try { target = decodeURIComponent(fragment.replace(/^#/, '')) } catch { return null }
  if (!target) return null
  const parser = getMarkdownParser(options)
  const tokens = parser.parse(content, {})
  const matches: number[] = []
  const inspect = (html: string, firstLine: number): void => {
    const tags = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
    for (const tag of html.matchAll(tags)) {
      if (!/^<a\b/i.test(tag[0])) continue
      for (const attribute of tag[0].slice(2, -1).matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        if (!['id', 'name'].includes(attribute[1].toLowerCase())) continue
        const value = attribute[2] ?? attribute[3] ?? attribute[4]
        if (value !== undefined && parser.utils.unescapeAll(value) === target) matches.push(firstLine + (html.slice(0, tag.index).match(/\n/g)?.length ?? 0))
      }
    }
  }
  for (const token of tokens) {
    if (!token.map) continue
    if (token.type === 'html_block') inspect(token.content, token.map[0] + 1)
    if (token.type !== 'inline') continue
    let line = token.map[0] + 1
    for (const child of token.children ?? []) {
      if (child.type === 'html_inline') inspect(child.content, line)
      if (child.type === 'softbreak' || child.type === 'hardbreak') line++
      else line += child.content.match(/\n/g)?.length ?? 0
    }
  }
  return matches.length ? Math.min(...matches) : null
}
