import { allowedEmbedUrl } from '../../shared/embedded-media'
import { isSafeLink, isSafeResource } from './markdown-parser'

export function sanitizeEmbeddedMedia(container: HTMLElement): void {
  for (const media of container.querySelectorAll<HTMLMediaElement>('audio,video')) {
    media.controls = true
    media.preload = 'metadata'
    media.removeAttribute('autoplay')
    media.removeAttribute('loop')
    media.removeAttribute('poster')
    media.classList.add('md-media')
    for (const node of [media, ...Array.from(media.querySelectorAll('source'))]) {
      const source = node.getAttribute('src') || ''
      node.removeAttribute('src')
      node.removeAttribute('data-resource')
      if (isSafeResource(source)) node.setAttribute('data-resource', source)
    }
    for (const dimension of ['width', 'height']) {
      const value = media.getAttribute(dimension)
      if (value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000)) media.removeAttribute(dimension)
    }
  }
  for (const source of container.querySelectorAll('source')) if (!source.closest('audio,video')) source.remove()
  for (const frame of container.querySelectorAll('iframe')) {
    const source = allowedEmbedUrl(frame.getAttribute('src') || '')
    if (!source) { frame.remove(); continue }
    const placeholder = document.createElement('section')
    placeholder.className = 'md-embedded-page'
    placeholder.dataset.embedSource = source
    const label = document.createElement('p')
    label.textContent = frame.title || '嵌入视频'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '加载嵌入内容'
    button.dataset.loadEmbed = 'true'
    const link = document.createElement('a')
    link.href = source
    link.textContent = '在浏览器中打开'
    link.rel = 'noopener noreferrer'
    placeholder.append(label, button, link)
    frame.replaceWith(placeholder)
  }
}

export async function hydrateEmbeddedMedia(container: HTMLElement, options: {
  resolveResource?: (source: string) => Promise<string>
  exportStatic?: boolean
  strict?: boolean
}): Promise<void> {
  for (const placeholder of container.querySelectorAll<HTMLElement>('.md-embedded-page[data-embed-source]')) {
    const button = placeholder.querySelector<HTMLButtonElement>('[data-load-embed]')
    if (options.exportStatic) { button?.remove(); continue }
    button?.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const source = allowedEmbedUrl(placeholder.dataset.embedSource || '')
      if (!source || placeholder.querySelector('iframe')) return
      const frame = document.createElement('iframe')
      frame.title = placeholder.querySelector('p')?.textContent || '嵌入视频'
      frame.sandbox.add('allow-scripts', 'allow-same-origin')
      frame.referrerPolicy = 'no-referrer'
      frame.allow = 'fullscreen'
      frame.src = source
      frame.className = 'md-embedded-frame'
      button.remove()
      placeholder.prepend(frame)
    }, { once: true })
  }
  await Promise.all(Array.from(container.querySelectorAll<HTMLMediaElement>('audio,video')).map(async media => {
    const sources = [media, ...Array.from(media.querySelectorAll('source'))].filter(node => node.hasAttribute('data-resource'))
    if (options.exportStatic) {
      const source = sources[0]?.getAttribute('data-resource') || ''
      const link = document.createElement('a')
      link.textContent = `${media.tagName === 'AUDIO' ? '音频' : '视频'}：${source || '未指定资源'}`
      if (isSafeLink(source)) link.setAttribute('href', source)
      media.replaceWith(link)
      return
    }
    let usable = 0
    for (const node of sources) {
      const source = node.getAttribute('data-resource') || ''
      try {
        const resolved = options.resolveResource ? await options.resolveResource(source) : (/^https?:/i.test(source) ? source : '')
        if (!/^(?:https?:|qtypora-media:)/i.test(resolved)) throw new Error('媒体路径无法解析')
        node.setAttribute('src', resolved)
        node.removeAttribute('data-resource')
        usable++
      } catch { /* Another source may provide a playable alternative. */ }
    }
    if (usable) media.load()
    else {
      const message = '媒体显示失败，请检查音频或视频路径。'
      if (options.strict) throw new Error(message)
      const placeholder = document.createElement('span')
      placeholder.className = 'md-preview-error'
      placeholder.textContent = message
      media.replaceWith(placeholder)
    }
  }))
}
