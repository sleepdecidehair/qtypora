import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import footnote from 'markdown-it-footnote'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import taskLists from 'markdown-it-task-lists'
import { full as emoji } from 'markdown-it-emoji'
import { filterDiagramStyle, validateDiagramStyles } from './diagram-style'

const HTML_TAGS = ['p', 'br', 'hr', 'strong', 'em', 's', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'section', 'sup', 'sub', 'mark', 'input', 'kbd', 'details', 'summary']

export const markdownParser = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false })
  .use(footnote).use(mark).use(sub).use(sup).use(taskLists, { enabled: false }).use(emoji)

markdownParser.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const start = state.pos
  if (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || '')) return false
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
  if (tokens[index].info.trim().split(/\s+/)[0] === 'mermaid') return `<div class="md-mermaid" data-mermaid="true"${self.renderAttrs(tokens[index])}><pre>${markdownParser.utils.escapeHtml(tokens[index].content)}</pre></div>\n`
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
    tokens[index].attrJoin('class', 'md-image-paragraph')
  }
  return self.renderToken(tokens, index, options)
}

export function isSafeResource(source: string): boolean {
  const trimmed = source.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true
  return !/^[a-z][a-z\d+.-]*:/i.test(trimmed) || /^(?:https?|file):/i.test(trimmed)
}

// Local image paths still pass through the privileged resolver; links receive a stricter filter below.
markdownParser.validateLink = (target) => isSafeResource(target) || (/^mailto:/i.test(target) && isSafeLink(target))

export function isSafeLink(target: string): boolean {
  const trimmed = target.trim()
  return !/[\u0000-\u001f\u007f]/.test(trimmed) && !/^(?:javascript|data|file|vbscript|blob):/i.test(trimmed)
    && (!/^[a-z][a-z\d+.-]*:/i.test(trimmed) || /^(?:https?|mailto):/i.test(trimmed))
}

export function renderMarkdown(content: string): string {
  return sanitizeMarkdownHtml(markdownParser.render(content))
}

export function renderReadingMarkdown(content: string): string {
  const environment: Record<string, unknown> = {}
  const tokens = markdownParser.parse(content, environment)
  for (const token of tokens) {
    if (token.map && token.tag && token.nesting !== -1) {
      token.attrSet('data-source-line', String(token.map[0] + 1))
      token.attrSet('data-source-end', String(token.map[1]))
    }
  }
  return sanitizeMarkdownHtml(markdownParser.renderer.render(tokens, markdownParser.options, environment))
}

export function sanitizeMarkdownHtml(markup: string): string {
  const clean = DOMPurify.sanitize(markup, {
    ALLOWED_TAGS: HTML_TAGS,
    ALLOWED_ATTR: ['class', 'id', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled', 'open', 'data-math', 'data-mermaid', 'data-resource', 'data-source-line', 'data-source-end'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  })
  const container = document.createElement('div')
  container.innerHTML = clean
  for (const anchor of container.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') || ''
    if (!isSafeLink(href)) anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.setAttribute('rel', 'noreferrer noopener')
  }
  for (const image of container.querySelectorAll('img')) {
    const source = image.dataset.resource || image.getAttribute('src') || ''
    image.removeAttribute('src')
    if (isSafeResource(source)) image.dataset.resource = source
    else image.removeAttribute('data-resource')
    image.loading = 'lazy'
  }
  for (const input of container.querySelectorAll('input')) {
    if (input.type !== 'checkbox') input.remove()
    else input.disabled = true
  }
  return container.innerHTML
}

let diagramCounter = 0
let diagramQueue: Promise<void> = Promise.resolve()

function safeDiagramCss(css: string, svgId: string): string {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const scope = `#${CSS.escape(svgId)}`
  const output: string[] = []
  for (const rule of sheet.cssRules) {
    // Engine animations are unnecessary; all at-rules, imports and font definitions are discarded.
    if (!(rule instanceof CSSStyleRule)) continue
    const selectors = rule.selectorText.split(',').map((selector) => selector.trim())
    if (!selectors.every((selector) => selector === scope || (selector.startsWith(scope + ' ') && !/^[+~]/.test(selector.slice(scope.length).trim())) || selector.startsWith(scope + '.') || selector.startsWith(scope + ':'))) continue
    const declarations = filterDiagramStyle(rule.style)
    if (declarations) output.push(`${rule.selectorText}{${declarations}}`)
  }
  return output.join('\n')
}

function safeDiagramSvg(markup: string, svgId: string): string {
  const svgDocument = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = svgDocument.documentElement
  if (svg.tagName !== 'svg' || svgDocument.querySelector('parsererror')) throw new Error('图表输出不是有效 SVG')
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    svg.setAttribute('width', String(Math.min(5000, viewBox[2])))
    svg.setAttribute('height', String(Math.min(5000, viewBox[3])))
  }
  for (const foreign of svg.querySelectorAll('foreignObject')) {
    const text = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'text')
    const paragraphs = Array.from(foreign.querySelectorAll('p'))
    const lines = (paragraphs.length ? paragraphs.map((paragraph) => paragraph.textContent || '') : [foreign.textContent || '']).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const coordinate = (name: string): number => {
      const number = Number(foreign.getAttribute(name) || 0)
      return Number.isFinite(number) ? Math.max(-5000, Math.min(5000, number)) : 0
    }
    const x = coordinate('x') + coordinate('width') / 2
    const y = coordinate('y') + coordinate('height') / 2
    text.setAttribute('x', String(x))
    text.setAttribute('y', String(y))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('class', 'nodeLabel')
    for (let index = 0; index < lines.length; index++) {
      const span = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan')
      span.setAttribute('x', String(x))
      span.setAttribute('dy', String(index === 0 ? -(lines.length - 1) * 10 : 20))
      span.textContent = lines[index]
      text.append(span)
    }
    foreign.replaceWith(text)
  }
  for (const style of svg.querySelectorAll('style')) style.textContent = safeDiagramCss(style.textContent || '', svgId)
  for (const element of [svg, ...Array.from(svg.querySelectorAll('[style]'))]) {
    const declaration = document.createElement('span').style
    declaration.cssText = element.getAttribute('style') || ''
    const safe = filterDiagramStyle(declaration)
    if (safe) element.setAttribute('style', safe)
    else element.removeAttribute('style')
  }
  return DOMPurify.sanitize(new XMLSerializer().serializeToString(svg), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'image', 'a', 'iframe', 'object'],
    FORBID_ATTR: ['href', 'xlink:href'],
  })
}

async function renderDiagram(source: string, theme: 'light' | 'dark'): Promise<string> {
  if (source.length > 20000 || source.split('\n').length > 300) throw new Error('图表过大，保留源码')
  // Mermaid uses global configuration; serialize rendering to prevent theme races.
  let result = ''
  const job = diagramQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    if (/%%\{|(?:^|\n)---\s*\n|(?:^|[\n;])\s*click\s/i.test(source)) throw new Error('本版图表禁用自定义配置和点击操作')
    validateDiagramStyles(source)
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, theme: theme === 'dark' ? 'dark' : 'default', suppressErrorRendering: true, maxTextSize: 20000, maxEdges: 200, secure: ['securityLevel', 'htmlLabels', 'startOnLoad', 'maxTextSize', 'maxEdges', 'theme', 'themeCSS', 'themeVariables'], flowchart: { htmlLabels: false } })
    const svgId = `qtypora-diagram-${++diagramCounter}`
    const renderHost = document.createElement('div')
    Object.assign(renderHost.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: '800px', left: '0', top: '0' })
    document.body.append(renderHost)
    try {
      const rendered = await mermaid.render(svgId, source, renderHost)
      result = safeDiagramSvg(rendered.svg, svgId)
    } finally { renderHost.remove() }
  })
  diagramQueue = job.catch(() => undefined)
  await job
  return result
}

export interface PreviewOptions {
  theme?: 'light' | 'dark'
  resolveResource?: (source: string) => Promise<string>
  embedImages?: boolean
  strict?: boolean
  sourceText?: (element: HTMLElement) => string
  errorMode?: 'source' | 'placeholder'
}

async function imageDataUrl(url: string): Promise<string> {
  if (!/^qtypora-media:/i.test(url)) throw new Error('本版暂不支持远程图片导出，请先保存图片到本地并使用本地路径')
  const response = await fetch(url)
  if (!response.ok) throw new Error('图片读取失败')
  const data = await response.blob()
  if (data.size > 10 * 1024 * 1024) throw new Error('图片超过 10 MB，无法内嵌')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片编码失败'))
    reader.onerror = () => reject(new Error('图片编码失败'))
    reader.readAsDataURL(data)
  })
}

export async function hydratePreview(container: HTMLElement, options: PreviewOptions): Promise<void> {
  const mathNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-math]'))
  const diagramNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-mermaid]'))
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-resource]'))
  await Promise.all([
    ...mathNodes.map(async (node) => {
      try {
        const { renderMathML } = await import('./mathjax-runtime')
        const markup = renderMathML(options.sourceText?.(node) ?? node.textContent ?? '', node.dataset.math === 'block')
        if (options.errorMode === 'placeholder' && /<merror\b/.test(markup)) throw new Error('公式解析失败')
        node.innerHTML = DOMPurify.sanitize(markup, { USE_PROFILES: { mathMl: true }, FORBID_ATTR: ['href', 'style'] })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        if (options.strict) throw new Error(`公式导出失败：${message}`)
        node.classList.add('md-preview-error')
        if (options.errorMode === 'placeholder') {
          node.title = '公式显示失败'
          node.textContent = '公式显示失败，请编辑并检查公式。'
        } else node.title = message
      }
    }),
    ...diagramNodes.map(async (node) => {
      try { node.innerHTML = await renderDiagram(options.sourceText?.(node) ?? node.textContent ?? '', options.theme || 'light') }
      catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        if (options.strict) throw new Error(`图表导出失败：${message}`)
        node.classList.add('md-preview-error')
        if (options.errorMode === 'placeholder') {
          node.title = '图表显示失败'
          node.textContent = '图表显示失败，请编辑并检查图表语法。'
        } else node.title = message
      }
    }),
    ...images.map(async (image) => {
      try {
        const source = image.dataset.resource || ''
        image.dataset.originalResource = source
        const resolved = options.resolveResource ? await options.resolveResource(source) : (/^https?:/i.test(source) ? source : '')
        if (!/^(?:https?:|qtypora-media:)/i.test(resolved)) throw new Error('图片路径无法解析')
        image.src = options.embedImages ? await imageDataUrl(resolved) : resolved
        image.removeAttribute('data-resource')
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        if (options.strict) throw new Error(`图片导出失败（${image.dataset.resource || image.alt}）：${message}`)
        if (options.errorMode === 'placeholder') {
          const placeholder = document.createElement('span')
          placeholder.className = 'md-preview-error'
          placeholder.textContent = '图片显示失败，请检查图片路径。'
          image.replaceWith(placeholder)
        } else image.title = message
      }
    }),
  ])
}

const EXPORT_STYLE = 'body{max-width:800px;margin:40px auto;padding:0 32px;color:#262b32;background:#fff;font:16px/1.8 "Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:break-word}h1,h2,h3,h4,h5,h6{line-height:1.35}h1{font-size:2.1em}h2{font-size:1.6em;padding-bottom:.25em}a{color:#366fa0}pre,code{font-family:Consolas,monospace;background:#f3f4f6}pre{padding:16px;overflow:auto}code{padding:2px 4px}pre code{padding:0}table{border-collapse:collapse;margin:16px auto}th,td{border:1px solid #d9dde2;padding:8px 12px}blockquote{border-left:4px solid #d9dde2;padding-left:16px;color:#626a75;margin-left:0}img,svg{max-width:100%}.md-image-paragraph{text-align:center}.md-image-paragraph>img:only-child{display:block;margin-inline:auto}.md-math[data-math=block]{text-align:center;margin:24px 0}.md-mermaid{text-align:center;margin:24px 0}.md-mermaid svg{display:block;margin-inline:auto}math{font-family:"Cambria Math",serif}input[type=checkbox]{margin-right:8px}@media print{body{margin:0;max-width:none}pre,table,blockquote{break-inside:avoid}a{color:inherit}h1,h2,h3{break-after:avoid}}'

function wrapDocument(body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markdown 文档</title><style>${EXPORT_STYLE}</style></head><body>${body}</body></html>`
}

export function renderMarkdownDocument(content: string): string { return wrapDocument(renderMarkdown(content)) }

export async function renderExportDocument(content: string, options: PreviewOptions = {}): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(content)
  await hydratePreview(container, { ...options, embedImages: true, strict: true })
  return wrapDocument(container.innerHTML)
}
