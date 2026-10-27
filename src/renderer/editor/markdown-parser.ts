import MarkdownIt from 'markdown-it'
import { isSafeDataImage } from '../../shared/data-image'
import footnote from 'markdown-it-footnote'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import taskLists from 'markdown-it-task-lists'
import { full as emoji } from 'markdown-it-emoji'
import { DEFAULT_MARKDOWN_OPTIONS, effectiveMarkdownOptions, normalizeMarkdownOptions, type MarkdownOptions } from '../../shared/markdown-options'
import { installDocumentFeatures } from './markdown-features'
import { installReferenceLocations } from './markdown-references'
import { MAX_PREVIEW_TOKENS } from './preview-budget'
import { editorText } from './editor-i18n'

export function isSafeResource(source: string): boolean {
  const trimmed = source.trim()
  if (/^data:/i.test(trimmed)) return isSafeDataImage(trimmed)
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true
  return !/^[a-z][a-z\d+.-]*:/i.test(trimmed) || /^(?:https?|file):/i.test(trimmed)
}

export function isSafeLink(target: string): boolean {
  const trimmed = target.trim()
  return !/[\u0000-\u001f\u007f]/.test(trimmed) && !/^(?:javascript|data|file|vbscript|blob):/i.test(trimmed)
    && (!/^[a-z][a-z\d+.-]*:/i.test(trimmed) || /^(?:https?|mailto):/i.test(trimmed))
}


export function createMarkdownParser(settings: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): MarkdownIt {
  settings = effectiveMarkdownOptions(settings)
  const markdownParser = new MarkdownIt(settings.strictMode ? 'commonmark' : 'default', { html: true, linkify: !settings.strictMode, breaks: settings.softBreaks, typographer: settings.smartPunctuation })
  if (!settings.strictMode) markdownParser.use(taskLists, { enabled: false })
  if (settings.footnotes) markdownParser.use(footnote)
  if (settings.highlight) markdownParser.use(mark)
  if (settings.subscript) markdownParser.use(sub)
  if (settings.superscript) markdownParser.use(sup)
  if (settings.emoji) markdownParser.use(emoji)

  markdownParser.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos
    if (!settings.inlineMath || state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || '')) return false
    let end = start + 1
    while (end < state.posMax) {
      end = state.src.indexOf('$', end)
      if (end === -1 || end - start > 8192) return false
      if (state.src[end - 1] !== '\\' && !/\s/.test(state.src[end - 1])) break
      end++
    }
    if (end >= state.posMax || /\d/.test(state.src[end + 1] || '')) return false
    if (!silent) {
      const token = state.push('math_inline', 'span', 0)
      token.content = state.src.slice(start + 1, end)
    }
    state.pos = end + 1
    return true
  })

  markdownParser.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    if (settings.strictMode) return false
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
    if (!first.startsWith('$$')) return false
    if (silent) return true
    let content = first.slice(2)
    let next = start + 1
    if (content.trimEnd().endsWith('$$')) content = content.trimEnd().slice(0, -2)
    else {
      let closed = false
      for (; next < end && next - start < 200; next++) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next])
        if (line.trimEnd().endsWith('$$')) {
          content += '\n' + line.trimEnd().slice(0, -2)
          next++
          closed = true
          break
        }
        content += '\n' + line
      }
      if (!closed) return false
    }
    const token = state.push('math_block', 'div', 0)
    token.block = true
    token.content = content.trim()
    token.map = [start, next]
    state.line = next
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  markdownParser.renderer.rules.math_inline = (tokens, index, _options, _env, self) => `<span class="md-math" data-math="inline"${self.renderAttrs(tokens[index])}>${markdownParser.utils.escapeHtml(tokens[index].content)}</span>`
  markdownParser.renderer.rules.math_block = (tokens, index, _options, _env, self) => `<div class="md-math" data-math="block"${self.renderAttrs(tokens[index])}>${markdownParser.utils.escapeHtml(tokens[index].content)}</div>\n`
  const fenceRenderer = markdownParser.renderer.rules.fence!
  markdownParser.renderer.rules.fence = (tokens, index, options, env, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0]
    if (settings.diagrams && ['mermaid', 'sequence', 'flow'].includes(language)) return `<div class="md-mermaid" data-mermaid="true" data-diagram-type="${language}"${self.renderAttrs(tokens[index])}><pre>${markdownParser.utils.escapeHtml(tokens[index].content)}</pre></div>\n`
    return fenceRenderer(tokens, index, options, env, self)
  }

  markdownParser.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const source = markdownParser.utils.escapeHtml(token.attrGet('src') || '')
    const alt = markdownParser.utils.escapeHtml(self.renderInlineAsText(token.children || [], options, env))
    const title = markdownParser.utils.escapeHtml(token.attrGet('title') || '')
    return `<img data-resource="${source}" alt="${alt}"${title ? ` title="${title}"` : ''}>`
  }

  markdownParser.renderer.rules.paragraph_open = (tokens, index, options, _env, self) => {
    const children = tokens[index + 1]?.children
    if (children?.some(child => child.type === 'image') && children.every(child => child.type === 'image' || (child.type === 'text' && !child.content.trim()))) {
      if (!(tokens[index].attrGet('class') ?? '').split(/\s+/).includes('md-image-paragraph')) tokens[index].attrJoin('class', 'md-image-paragraph')
    }
    return self.renderToken(tokens, index, options)
  }

  // Local image paths still pass through the privileged resolver; links receive a stricter filter below.
  markdownParser.validateLink = (target) => isSafeResource(target) || (/^mailto:/i.test(target) && isSafeLink(target))


  markdownParser.core.ruler.after('block', 'preview_token_budget', state => {
    if (state.tokens.length <= MAX_PREVIEW_TOKENS) return
    const token = new state.Token('html_block', '', 0)
    token.block = true
    token.map = [0, state.src.split('\n').length]
    const locale = state.env.locale === 'en-US' ? 'en-US' : 'zh-CN'
    const message = editorText(locale, '文档结构超过预览上限，以下保留完整源码。请拆分文档或使用源码模式。')
    token.content = `<section class="md-preview-limit"><p>${markdownParser.utils.escapeHtml(message)}</p><pre>${markdownParser.utils.escapeHtml(state.src)}</pre></section>`
    state.tokens = [token]
  })
  installReferenceLocations(markdownParser, settings)
  installDocumentFeatures(markdownParser, settings)
  return markdownParser
}

const parserCache = new Map<string, MarkdownIt>()

export function getMarkdownParser(options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): MarkdownIt {
  const settings = effectiveMarkdownOptions(normalizeMarkdownOptions(options))
  const key = JSON.stringify(settings)
  let parser = parserCache.get(key)
  if (!parser) {
    parser = createMarkdownParser(settings)
    if (parserCache.size >= 16) parserCache.delete(parserCache.keys().next().value!)
    parserCache.set(key, parser)
  }
  return parser
}

export const markdownParser = getMarkdownParser()
