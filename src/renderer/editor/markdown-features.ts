import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { parseDocument } from 'yaml'
import type { MarkdownOptions } from '../../shared/markdown-options'

export interface IndexedHeading { level: number; text: string; line: number; slug: string }
export interface MathExpression { source: string; display: boolean; line: number }
export interface FrontMatter { source: string; endLine: number; metadata: Record<string, string>; error?: string }

export function readFrontMatter(source: string): FrontMatter | null {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
  if (end < 1) return null
  const yaml = lines.slice(1, end).join('\n')
  const result: FrontMatter = { source: yaml, endLine: end + 1, metadata: {} }
  if (yaml.length > 65536) return { ...result, error: '前置信息超过 64 KB，请在源码模式编辑。' }
  try {
    const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true })
    if (document.errors.length) return { ...result, error: 'YAML 语法无效，原文已保留。' }
    const data: unknown = document.toJS({ maxAliasCount: 0 })
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const value = data as Record<string, unknown>
      for (const key of ['title', 'author', 'description', 'keywords', 'tags']) {
        const item = value[key]
        if (typeof item === 'string' || typeof item === 'number') result.metadata[key] = String(item).slice(0, 4096)
        else if (Array.isArray(item) && item.every(part => typeof part === 'string')) result.metadata[key] = item.join(', ').slice(0, 4096)
      }
      if (!result.metadata.keywords && result.metadata.tags) result.metadata.keywords = result.metadata.tags
    }
  } catch { result.error = 'YAML 包含不支持的别名或无效数据，原文已保留。' }
  return result
}

export function documentMetadata(source: string): Record<string, string> { return readFrontMatter(source)?.metadata ?? {} }

export function inlinePlainText(tokens: Token[]): string {
  return tokens.map(token => {
    if (['text', 'code_inline', 'math_inline', 'emoji'].includes(token.type)) return token.content
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    if (token.type === 'image') return token.children ? inlinePlainText(token.children) : token.content
    return token.children ? inlinePlainText(token.children) : ''
  }).join('')
}

export function indexHeadingTokens(tokens: Token[]): IndexedHeading[] {
  const used = new Set<string>()
  const nextSuffix = new Map<string, number>()
  const headings: IndexedHeading[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const inline = tokens[index + 1]
    if (token.type !== 'heading_open' || !token.map || inline?.type !== 'inline') continue
    const text = inlinePlainText(inline.children ?? []).trim()
    const base = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-') || 'section'
    let slug = base
    let suffix = nextSuffix.get(base) ?? 1
    while (used.has(slug)) slug = `${base}-${suffix++}`
    nextSuffix.set(base, suffix)
    used.add(slug)
    token.attrSet('id', slug)
    headings.push({ level: Number(token.tag.slice(1)), text, line: token.map[0] + 1, slug })
  }
  return headings
}

const ALERTS: Record<string, string> = { NOTE: '注意', TIP: '提示', IMPORTANT: '重要', WARNING: '警告', CAUTION: '小心' }

export function installDocumentFeatures(parser: MarkdownIt, options: MarkdownOptions): void {
  if (options.frontMatter) {
    parser.block.ruler.before('hr', 'front_matter', (state, start, _end, silent) => {
      if (start !== 0 || state.blkIndent !== 0) return false
      const matter = readFrontMatter(state.src)
      if (!matter) return false
      if (silent) return true
      const token = state.push('front_matter', 'section', 0)
      token.block = true
      token.map = [0, matter.endLine]
      token.content = matter.source
      token.meta = matter
      state.line = matter.endLine
      return true
    })
    parser.renderer.rules.front_matter = (tokens, index) => {
      const matter = tokens[index].meta as FrontMatter
      const escape = parser.utils.escapeHtml
      return `<section class="md-front-matter" aria-label="YAML 前置信息"><div class="md-front-matter-label">YAML 前置信息</div><pre>${escape(matter.source)}</pre>${matter.error ? `<p class="md-front-matter-error">${escape(matter.error)}</p>` : ''}</section>\n`
    }
  }
  if (options.toc) {
    parser.block.ruler.before('paragraph', 'table_of_contents', (state, start, _end, silent) => {
      if (state.blkIndent !== 0 || state.level !== 0) return false
      const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
      if (!/^\[toc\]\s*$/i.test(line)) return false
      if (silent) return true
      const token = state.push('table_of_contents', 'nav', 0)
      token.block = true
      token.map = [start, start + 1]
      state.line = start + 1
      return true
    }, { alt: ['paragraph'] })
    parser.renderer.rules.table_of_contents = (tokens, index) => String(tokens[index].meta?.tocHtml ?? '')
  }

  parser.core.ruler.after('inline', 'document_features', state => {
    const headings = indexHeadingTokens(state.tokens)
    state.env.headings = headings
    let remainingTocEntries = 5000
    const tocCache = new Map<number, string>()
    for (const token of state.tokens) {
      if (token.type !== 'table_of_contents') continue
      const count = Math.min(remainingTocEntries, headings.length)
      let html = tocCache.get(count)
      if (html === undefined) {
        const escape = parser.utils.escapeHtml
        html = `<nav class="md-toc" aria-label="文章目录"><ol>${headings.slice(0, count).map(heading => `<li class="md-toc-level-${heading.level}"><a href="#${escape(heading.slug)}">${escape(heading.text || '无标题')}</a></li>`).join('')}</ol>${count < headings.length ? '<p>目录条目超过当前文档的预览上限，请使用侧栏大纲查看全部标题。</p>' : ''}</nav>\n`
        tocCache.set(count, html)
      }
      remainingTocEntries -= count
      token.meta = { tocHtml: html }
    }
    if (!options.alerts) return
    for (let index = 0; index < state.tokens.length; index++) {
      const quote = state.tokens[index]
      const paragraph = state.tokens[index + 1]
      const inline = state.tokens[index + 2]
      if (quote.type !== 'blockquote_open' || paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n|\s*$)/.exec(inline.content)
      if (!match) continue
      quote.attrJoin('class', `md-alert md-alert-${match[1].toLowerCase()}`)
      quote.attrSet('aria-label', ALERTS[match[1]])
      quote.meta = { alert: match[1] }
      inline.content = inline.content.slice(match[0].length)
      if (inline.map) inline.map = [inline.map[0] + (match[0].match(/\n/g)?.length ?? 0), inline.map[1]]
      const title = new state.Token('html_inline', '', 0)
      title.content = `<strong class="md-alert-title">${ALERTS[match[1]]}</strong><br>`
      const parsed = [...(inline.children ?? [])]
      if (parsed[0]?.type === 'text') parsed.shift()
      if (parsed[0]?.type === 'softbreak' || parsed[0]?.type === 'hardbreak') parsed.shift()
      inline.children = [title, ...parsed]
    }
  })
  parser.core.ruler.after('document_features', 'document_math', state => {
    const expressions: MathExpression[] = []
    for (const token of state.tokens) {
      if (token.type === 'math_block') {
        token.attrSet('data-math-index', String(expressions.length))
        expressions.push({ source: token.content, display: true, line: (token.map?.[0] ?? 0) + 1 })
      }
      if (token.type !== 'inline') continue
      let line = (token.map?.[0] ?? 0) + 1
      for (const child of token.children ?? []) {
        if (child.type === 'softbreak' || child.type === 'hardbreak') line++
        if (child.type !== 'math_inline') continue
        child.attrSet('data-math-index', String(expressions.length))
        expressions.push({ source: child.content, display: false, line })
      }
    }
    state.env.mathExpressions = expressions
  })
}
