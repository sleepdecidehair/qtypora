import { EditorView, ViewPlugin } from '@codemirror/view'

export interface ResourceSize { width: number; height: number }

export function containResource(size: ResourceSize, available: ResourceSize, allowUpscale = false): ResourceSize {
  if (![size.width, size.height, available.width, available.height].every((value) => Number.isFinite(value) && value > 0)) return { width: 0, height: 0 }
  const scale = Math.min(allowUpscale ? Infinity : 1, available.width / size.width, available.height / size.height)
  return { width: size.width * scale, height: size.height * scale }
}

function availableSize(view: EditorView): ResourceSize {
  const style = getComputedStyle(view.contentDOM)
  return { width: Math.max(32, Math.min(view.contentDOM.clientWidth, view.scrollDOM.clientWidth) - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')), height: Math.max(32, view.scrollDOM.clientHeight - 80) }
}

function applySize(element: HTMLElement | SVGElement, size: ResourceSize): boolean {
  if (!size.width || !size.height) return false
  const width = `${size.width}px`, height = `${size.height}px`
  if (element.style.width === width && element.style.height === height) return false
  element.style.setProperty('width', width, 'important')
  element.style.setProperty('height', height, 'important')
  element.style.setProperty('max-width', '100%', 'important')
  element.style.setProperty('max-height', 'none', 'important')
  element.style.objectFit = 'contain'
  return true
}

export function fitEditorResources(view: EditorView): void {
  const available = availableSize(view)
  let changed = false
  for (const svg of view.contentDOM.querySelectorAll<SVGSVGElement>('.md-mermaid svg')) {
    const box = svg.viewBox.baseVal
    const natural = { width: box.width || Number(svg.getAttribute('width')), height: box.height || Number(svg.getAttribute('height')) }
    changed = applySize(svg, containResource(natural, available, true)) || changed
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  }
  for (const image of view.contentDOM.querySelectorAll<HTMLImageElement>('img')) {
    if (!image.naturalWidth || !image.naturalHeight) continue
    const inline = image.closest<HTMLElement>('.cm-live-media')
    const imageAvailable = inline ? { ...available, width: Math.max(1, available.width - (inline.querySelector('button')?.getBoundingClientRect().width || 0)) } : available
    changed = applySize(image, containResource({ width: image.naturalWidth, height: image.naturalHeight }, imageAvailable, !inline)) || changed
  }
  for (const node of view.contentDOM.querySelectorAll<HTMLElement>('.md-math')) {
    const math = node.querySelector('math')
    if (!math) continue
    let wrapper = node.querySelector<HTMLElement>(':scope > .cm-fit-math')
    let inner = wrapper?.firstElementChild as HTMLElement | undefined
    if (!wrapper || !inner) {
      wrapper = document.createElement('span'); wrapper.className = 'cm-fit-math'
      inner = document.createElement('span'); inner.className = 'cm-fit-math-content'
      inner.append(math); wrapper.append(inner); node.append(wrapper)
    }
    const natural = { width: inner.offsetWidth, height: inner.offsetHeight }
    const fitted = containResource(natural, available)
    const scale = fitted.width / natural.width
    if (!Number.isFinite(scale) || !fitted.width) continue
    const transform = `scale(${scale})`
    if (inner.style.transform !== transform || wrapper.style.width !== `${fitted.width}px` || wrapper.style.height !== `${fitted.height}px`) {
      wrapper.style.width = `${fitted.width}px`; wrapper.style.height = `${fitted.height}px`
      inner.style.transform = transform; changed = true
    }
  }
  if (changed) view.requestMeasure()
}

export const resourceFitExtension = ViewPlugin.fromClass(class {
  private observer: ResizeObserver
  private load = (): void => fitEditorResources(this.view)
  constructor(readonly view: EditorView) {
    this.observer = new ResizeObserver(() => fitEditorResources(view))
    this.observer.observe(view.scrollDOM)
    this.observer.observe(view.contentDOM)
    view.contentDOM.addEventListener('load', this.load, true)
  }
  destroy(): void { this.observer.disconnect(); this.view.contentDOM.removeEventListener('load', this.load, true) }
})
