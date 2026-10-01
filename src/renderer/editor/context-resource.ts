import { renderMarkdown, hydratePreview } from './markdown'
import { containResource } from './resource-fit'
import type { ContextTarget } from './context-target'

export type ViewedResource = { kind: 'image'; source: string } | { kind: 'diagram'; source: string } | { kind: 'math'; source: string }

export async function mathMarkup(target: ContextTarget): Promise<string> {
  const { renderMathML } = await import('./mathjax-runtime')
  return renderMathML(target.body ? target.body.text.trim() : target.source, target.source.startsWith('$$'))
}

export async function diagramSvg(target: ContextTarget, theme: 'light' | 'dark'): Promise<string> {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:800px'
  container.setAttribute('aria-hidden', 'true')
  container.innerHTML = renderMarkdown(target.source)
  const sources = new Map<HTMLElement, string>()
  for (const node of container.querySelectorAll<HTMLElement>('[data-mermaid],[data-math]')) { sources.set(node, node.textContent || ''); node.replaceChildren() }
  document.body.append(container)
  try {
    await hydratePreview(container, { theme, strict: true, sourceText: (node) => sources.get(node) || '' })
    const svg = container.querySelector<SVGSVGElement>('svg')
    if (!svg) throw new Error('无法生成图表，请先检查图表源码。')
    const box = svg.viewBox.baseVal
    if (!box.width || !box.height) throw new Error('图表缺少有效尺寸。')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', String(box.width)); svg.setAttribute('height', String(box.height))
    svg.style.removeProperty('width'); svg.style.removeProperty('height'); svg.style.removeProperty('max-width'); svg.style.removeProperty('max-height')
    return new XMLSerializer().serializeToString(svg)
  } finally { container.remove() }
}

export async function rasterizeDiagram(svg: string, format: 'png' | 'jpeg'): Promise<string> {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const box = parsed.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if (!box || box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) throw new Error('图表尺寸无效。')
  const fitted = containResource({ width: box[2], height: box[3] }, { width: 4096, height: 4096 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(fitted.width)); canvas.height = Math.max(1, Math.ceil(fitted.height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布。')
  const image = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    image.src = url
    await image.decode()
    if (format === 'jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL(`image/${format}`, 0.95)
  } finally { URL.revokeObjectURL(url) }
}
