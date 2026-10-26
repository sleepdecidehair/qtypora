import DOMPurify from 'dompurify'
import { isSafeDataImage } from '../../shared/data-image'
import { base64DataUrlLength, ExportBudget, prepareExportImages } from '../../shared/export-budget'
import { sanitizeEmbeddedMedia, hydrateEmbeddedMedia } from './embedded-media'
import markdownFeatureStyle from './markdown-features.css?inline'
import { filterDiagramStyle, validateDiagramStyles } from './diagram-style'
import { getMarkdownParser, isSafeResource, isSafeLink } from './markdown-parser'
import { DEFAULT_MARKDOWN_OPTIONS, effectiveMarkdownOptions, type MarkdownOptions } from '../../shared/markdown-options'
import { documentMetadata, type MathExpression } from './markdown-features'
export { getMarkdownParser, markdownParser, isSafeResource, isSafeLink } from './markdown-parser'

const HTML_TAGS = ['p', 'u', 'nav', 'br', 'hr', 'strong', 'em', 's', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'section', 'sup', 'sub', 'mark', 'input', 'kbd', 'details', 'summary', 'audio', 'video', 'source', 'iframe']

export function renderMarkdown(content: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): string {
  return sanitizeMarkdownHtml(getMarkdownParser(options).render(content))
}

export function renderReadingMarkdown(content: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): string {
  const markdownParser = getMarkdownParser(options)
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
    ALLOWED_ATTR: ['class', 'id', 'name', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled', 'open', 'width', 'height', 'data-math', 'data-math-index', 'data-mermaid', 'data-diagram-type', 'data-resource', 'data-source-line', 'data-source-end', 'aria-label', 'role', 'controls', 'preload', 'align'],
    ALLOW_DATA_ATTR: false,
    // This inert attribute is checked below before it can become an image URL.
    ADD_URI_SAFE_ATTR: ['data-resource'],
    FORBID_TAGS: ['style', 'script', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  })
  const container = document.createElement('div')
  container.innerHTML = clean
  for (const element of container.querySelectorAll('[name]')) { if (element.tagName !== 'A') element.removeAttribute('name') }
  for (const anchor of container.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') || ''
    if (!isSafeLink(href)) anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.setAttribute('rel', 'noreferrer noopener')
  }
  for (const element of container.querySelectorAll('[align]')) {
    if (element.tagName !== 'IMG' || !['left', 'center', 'right'].includes(element.getAttribute('align') || '')) element.removeAttribute('align')
  }
  for (const image of container.querySelectorAll('img')) {
    const source = image.dataset.resource || image.getAttribute('src') || ''
    image.removeAttribute('src')
    for (const name of ['width', 'height']) {
      const value = image.getAttribute(name)
      if (value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000)) image.removeAttribute(name)
    }
    if (isSafeResource(source)) image.dataset.resource = source
    else image.removeAttribute('data-resource')
    image.loading = 'lazy'
  }
  sanitizeEmbeddedMedia(container)
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

async function renderDiagram(source: string, theme: 'light' | 'dark', kind = 'mermaid'): Promise<string> {
  if (source.length > 20000 || source.split('\n').length > 300) throw new Error('图表过大，保留源码')
  // Mermaid uses global configuration; serialize rendering to prevent theme races.
  let result = ''
  const job = diagramQueue.then(async () => {
    if (kind === 'mermaid' && /%%\{|(?:^|\n)---\s*\n|(?:^|[\n;])\s*click\s/i.test(source)) throw new Error('本版图表禁用自定义配置和点击操作')
    if (kind === 'mermaid') validateDiagramStyles(source)
    const mermaid = kind === 'mermaid' ? (await import('mermaid')).default : null
    mermaid?.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, theme: theme === 'dark' ? 'dark' : 'default', suppressErrorRendering: true, maxTextSize: 20000, maxEdges: 200, secure: ['securityLevel', 'htmlLabels', 'startOnLoad', 'maxTextSize', 'maxEdges', 'theme', 'themeCSS', 'themeVariables'], flowchart: { htmlLabels: false } })
    const svgId = `qtypora-diagram-${++diagramCounter}`
    const renderHost = document.createElement('div')
    Object.assign(renderHost.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: '800px', left: '0', top: '0' })
    document.body.append(renderHost)
    try {
      const markup = kind === 'flow' || kind === 'sequence'
        ? await (await import('./legacy-diagram')).drawLegacyDiagram(source, kind, renderHost, theme)
        : (await mermaid!.render(svgId, source, renderHost)).svg
      result = safeDiagramSvg(markup, svgId)
    } finally { renderHost.remove() }
  })
  diagramQueue = job.catch(() => undefined)
  await job
  return result
}

export interface PreviewOptions {
  exportBudget?: ExportBudget
  exportCss?: string
  markdownOptions?: MarkdownOptions
  mathExpressions?: MathExpression[]
  theme?: 'light' | 'dark'
  resolveResource?: (source: string) => Promise<string>
  embedImages?: boolean
  strict?: boolean
  sourceText?: (element: HTMLElement) => string
  errorMode?: 'source' | 'placeholder'
}

async function imageDataUrl(url: string, reserve: (length: number) => void = () => undefined): Promise<string> {
  if (/^data:image\//i.test(url)) { reserve(url.length); return url }
  if (!/^qtypora-media:/i.test(url)) throw new Error('本版暂不支持远程图片导出，请先保存图片到本地并使用本地路径')
  const response = await fetch(url)
  if (!response.ok) throw new Error('图片读取失败')
  const declared = Number(response.headers.get('content-length'))
  if (declared > 10 * 1024 * 1024) throw new Error('图片超过 10 MB，无法内嵌')
  const data = await response.blob()
  if (data.size > 10 * 1024 * 1024) throw new Error('图片超过 10 MB，无法内嵌')
  reserve(base64DataUrlLength(data.size, data.type || 'application/octet-stream'))
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
  const imageSources = new Map(images.map(image => [image, image.dataset.resource || '']))
  const budget = options.embedImages ? options.exportBudget ?? new ExportBudget() : undefined
  if (budget) {
    for (const image of images) {
      image.removeAttribute('data-resource')
      image.removeAttribute('data-original-resource')
    }
    budget.replace(0, container.innerHTML.length + images.length * 7)
  }
  const resolveImage = async (source: string): Promise<string> => {
    const resolved = isSafeDataImage(source) ? source : options.resolveResource ? await options.resolveResource(source) : (/^https?:/i.test(source) ? source : '')
    const verifiedRemoteSvg = options.embedImages && /^https?:/i.test(source) && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/.test(resolved)
    if (!verifiedRemoteSvg && !isSafeDataImage(resolved) && !/^(?:https?:|qtypora-media:)/i.test(resolved)) throw new Error('图片路径无法解析')
    return resolved
  }
  // Serial encoding and resource deduplication keep peak memory bounded by one image.
  const embedded = budget ? await prepareExportImages([...imageSources.values()], resolveImage, imageDataUrl, budget).catch(error => {
    throw new Error(`图片导出失败：${error instanceof Error ? error.message : '资源无法读取'}`)
  }) : undefined
  let mathOutputs: string[] | undefined
  let mathFailure: unknown
  if (mathNodes.length && options.mathExpressions?.length) {
    const { renderMathSequence } = await import('./mathjax-runtime')
    try { mathOutputs = renderMathSequence(options.mathExpressions, options.markdownOptions?.mathNumbering ?? false) }
    catch (error) { mathFailure = error }
  }
  await Promise.all([
    hydrateEmbeddedMedia(container, { resolveResource: options.resolveResource, exportStatic: options.embedImages, strict: options.strict }),
    ...mathNodes.map(async (node) => {
      try {
        if (mathFailure) throw mathFailure
        const { renderMathML } = await import('./mathjax-runtime')
        const index = node.hasAttribute('data-math-index') ? Number(node.dataset.mathIndex) : -1
        const markup = mathOutputs?.[index] ?? renderMathML(options.sourceText?.(node) ?? node.textContent ?? '', node.dataset.math === 'block')
        if (options.errorMode === 'placeholder' && /<merror\b/.test(markup)) throw new Error('公式解析失败')
        const clean = DOMPurify.sanitize(markup, { USE_PROFILES: { mathMl: true }, FORBID_ATTR: ['style'] })
        budget?.replace(node.innerHTML.length, clean.length)
        node.innerHTML = clean
        for (const link of node.querySelectorAll('[href]')) {
          if (!/^#mjx-eqn(?::|%3a)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href')
        }
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
      try {
        const markup = await renderDiagram(options.sourceText?.(node) ?? node.textContent ?? '', options.theme || 'light', node.dataset.diagramType)
        budget?.replace(node.innerHTML.length, markup.length)
        node.innerHTML = markup
      }
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
        const source = imageSources.get(image) || ''
        if (!options.embedImages) image.dataset.originalResource = source
        image.src = embedded?.get(source) ?? await resolveImage(source)
        for (const dimension of ['width', 'height'] as const) {
          const value = image.getAttribute(dimension)
          if (value && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000) image.style[dimension] = `${value}px`
        }
        const alignment = image.getAttribute('align')
        if (alignment && ['left', 'center', 'right'].includes(alignment)) {
          image.style.display = 'block'
          image.style.float = 'none'
          image.style.marginLeft = alignment === 'left' ? '0' : 'auto'
          image.style.marginRight = alignment === 'right' ? '0' : 'auto'
        }
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

function wrapDocument(body: string, metadata: Record<string, string> = {}, css = ''): string {
  const escape = getMarkdownParser().utils.escapeHtml
  const title = escape(metadata.title || 'Markdown 文档')
  const meta = ['author', 'description', 'keywords'].filter(name => metadata[name]).map(name => `<meta name="${name}" content="${escape(metadata[name])}">`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${meta}<style>${EXPORT_STYLE}\n${markdownFeatureStyle}\n${css.replace(/<\/style/gi, '')}</style></head><body>${body}</body></html>`
}

export function renderMarkdownDocument(content: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): string { return wrapDocument(renderMarkdown(content, options), effectiveMarkdownOptions(options).frontMatter ? documentMetadata(content) : {}) }

export async function renderExportDocument(content: string, options: PreviewOptions = {}): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(content, options.markdownOptions)
  container.querySelectorAll('.md-front-matter').forEach(node => node.remove())
  const environment: Record<string, unknown> = {}
  getMarkdownParser(options.markdownOptions).parse(content, environment)
  const metadata = effectiveMarkdownOptions(options.markdownOptions ?? DEFAULT_MARKDOWN_OPTIONS).frontMatter ? documentMetadata(content) : {}
  const wrapper = wrapDocument('', metadata, options.exportCss)
  await hydratePreview(container, { ...options, exportBudget: new ExportBudget(wrapper.length), mathExpressions: environment.mathExpressions as MathExpression[], embedImages: true, strict: true })
  const body = container.innerHTML
  new ExportBudget(wrapper.length + body.length)
  return wrapDocument(body, metadata, options.exportCss)
}
