import { EditorView } from '@codemirror/view'
import { Transaction, type Extension } from '@codemirror/state'
import DOMPurify from 'dompurify'
import { isolateHistory } from '@codemirror/commands'
import type { DocumentSnapshot, Result } from '../../shared/contracts'
import type { ImageImportRequest, ImageImportResult, ImageOptions } from '../../shared/image-options'

const MAX_CLIPBOARD = 16 * 1024 * 1024
const imageMime = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/bmp', '.bmp'], ['image/svg+xml', '.svg'], ['image/x-icon', '.ico']])

function escapedText(text: string): string { return text.replace(/\\/g, '\\\\').replace(/([`*_\[\]<>])/g, '\\$1') }
function safeUrl(source: string): string | null {
  const value = source.trim()
  if (!value || /[\x00-\x20\x7f]/.test(value) || /^(?:javascript|vbscript|data|file|blob):/i.test(value) || /^\/\//.test(value)) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^(?:https?|mailto):/i.test(value)) return null
  return value.replace(/[()]/g, value => encodeURIComponent(value).replace('(', '%28').replace(')', '%29'))
}

/** Convert only external clipboard markup, never the editor's rendered document. */
export function clipboardHtmlToMarkdown(html: string): string | null {
  if (!html || html.length > MAX_CLIPBOARD) return null
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'section', 'article', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'mark', 'sup', 'sub', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'input'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'start', 'type', 'checked'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  })
  const host = document.createElement('div')
  host.innerHTML = sanitized
  let visited = 0
  const render = (node: Node, depth: number): string => {
    if (++visited > 20000 || depth > 64) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
    if (node.nodeType === Node.TEXT_NODE) return escapedText(node.textContent || '')
    if (!(node instanceof HTMLElement)) return ''
    const children = () => Array.from(node.childNodes, child => render(child, depth + 1)).join('')
    const inner = () => children().trim()
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') return '\n'
    if (tag === 'hr') return '\n\n---\n\n'
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${inner()}\n\n`
    if (['p', 'div', 'section', 'article'].includes(tag)) return `\n\n${inner()}\n\n`
    if (tag === 'strong' || tag === 'b') return `**${inner()}**`
    if (tag === 'em' || tag === 'i') return `*${inner()}*`
    if (tag === 's' || tag === 'del') return `~~${inner()}~~`
    if (tag === 'u') return `<u>${children()}</u>`
    if (tag === 'mark') return `==${inner()}==`
    if (tag === 'sup') return `^${inner().replaceAll(' ', '\\ ')}^`
    if (tag === 'sub') return `~${inner().replaceAll(' ', '\\ ')}~`
    if (tag === 'pre') {
      const text = node.textContent || ''
      const width = Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1))
      const fence = '`'.repeat(width)
      return `\n\n${fence}\n${text.replace(/\n$/, '')}\n${fence}\n\n`
    }
    if (tag === 'code') {
      const text = node.textContent || ''
      const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
      const padding = /^`|`$|^ .* $/.test(text) ? ' ' : ''
      return `${fence}${padding}${text}${padding}${fence}`
    }
    if (tag === 'blockquote') return `\n\n${inner().replace(/\n{3,}/g, '\n\n').split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    if (tag === 'ul' || tag === 'ol') {
      const first = Number(node.getAttribute('start') || 1)
      const start = Number.isSafeInteger(first) && first > 0 ? first : 1
      const items = Array.from(node.children).filter(child => child.tagName === 'LI')
      return '\n\n' + items.map((item, index) => {
        const value = render(item, depth + 1).trim().replace(/\n{3,}/g, '\n\n')
        const marker = tag === 'ol' ? `${start + index}. ` : '- '
        return marker + value.split('\n').join('\n' + ' '.repeat(marker.length))
      }).join('\n') + '\n\n'
    }
    if (tag === 'a') {
      const url = safeUrl(node.getAttribute('href') || '')
      return url ? `[${inner() || escapedText(url)}](${url})` : children()
    }
    if (tag === 'img') {
      const url = safeUrl(node.getAttribute('src') || '')
      return url ? `![${escapedText(node.getAttribute('alt') || '')}](${url})` : escapedText(node.getAttribute('alt') || '')
    }
    if (tag === 'input') return node.getAttribute('type') === 'checkbox' ? `[${node.hasAttribute('checked') ? 'x' : ' '}] ` : ''
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).map(row => Array.from(row.children).filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH').map(cell => render(cell, depth + 1).trim().replace(/\n+/g, '<br>').replace(/(?<!\\)\|/g, '\\|')))
      const columns = Math.max(0, ...rows.map(row => row.length))
      if (!rows.length || !columns || rows.length > 500 || columns > 50) return children()
      const line = (cells: string[]) => '| ' + Array.from({ length: columns }, (_, index) => cells[index] || '').join(' | ') + ' |'
      return `\n\n${line(rows[0])}\n${line(Array(columns).fill('---'))}\n${rows.slice(1).map(line).join('\n')}\n\n`
    }
    return children()
  }
  const markdown = Array.from(host.childNodes, node => render(node, 0)).join('').replace(/\n{3,}/g, '\n\n').trim()
  return markdown || null
}

export interface ClipboardImportContext {
  snapshot: DocumentSnapshot
  mode: 'hybrid' | 'source' | 'reading'
  readOnly: boolean
  imageOptions: ImageOptions
  importImages: (request: ImageImportRequest) => Promise<Result<ImageImportResult | null>>
  readClipboardText: () => Promise<Result<string>>
  onError: (message: string) => void
}

export function clipboardImportExtension(getContext: () => ClipboardImportContext): Extension {
  let pending = false
  const insertFiles = (view: EditorView, files: File[], at?: number): void => {
    const context = getContext()
    if (context.readOnly || view.state.readOnly || pending) return
    const selection = view.state.selection.main
    const range = at === undefined ? { from: selection.from, to: selection.to } : { from: at, to: at }
    const original = view.state.doc
    const unchanged = () => view.dom.isConnected && getContext().snapshot.id === context.snapshot.id && getContext().snapshot.revision === context.snapshot.revision && view.state.doc.eq(original) && !view.state.readOnly && !getContext().readOnly
    pending = true
    void (async () => {
      if (!files.length || files.length > 20 || files.some(file => file.size > MAX_CLIPBOARD) || files.reduce((sum, file) => sum + file.size, 0) > MAX_CLIPBOARD * 2) throw new Error('每次最多插入 20 张图片，单张不超过 16 MB，总计不超过 32 MB。')
      const images = []
      for (const file of files) {
        const extension = imageMime.get(file.type)
        if (!extension && !/\.(?:png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(file.name)) throw new Error('拖放和粘贴文件目前只接受图片。')
        const name = /\.[a-z\d]+$/i.test(file.name) ? file.name : `${file.name || 'image'}${extension || '.png'}`
        images.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) })
      }
      if (!unchanged()) throw new Error('文档已改变，未插入图片。请重新粘贴或拖放。')
      const result = await context.importImages({ ...context.snapshot, content: original.toString(), images })
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) return
      if (!unchanged()) throw new Error('图片已保存，文档已改变，未插入引用。请重新插入图片。')
      const before = range.from > 0 && original.sliceString(range.from - 1, range.from) !== '\n' ? '\n\n' : ''
      const after = range.to < original.length && original.sliceString(range.to, range.to + 1) !== '\n' ? '\n\n' : ''
      const insert = before + result.data.markdown + after
      view.dispatch({ changes: { ...range, insert }, selection: { anchor: range.from + insert.length }, annotations: [Transaction.userEvent.of('input.paste'), isolateHistory.of('full')] })
      view.focus()
    })().catch(error => context.onError(error instanceof Error ? error.message : '图片插入失败。')).finally(() => { pending = false })
  }
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        const context = getContext(), original = view.state.doc, range = view.state.selection.main
        if (context.readOnly || view.state.readOnly || context.mode === 'reading') return true
        void context.readClipboardText().then(result => {
          if (!result.ok) throw new Error(result.error.message)
          const current = getContext()
          if (!view.dom.isConnected || current.snapshot.id !== context.snapshot.id || current.snapshot.revision !== context.snapshot.revision || current.readOnly || view.state.readOnly || !view.state.doc.eq(original)) throw new Error('文档已变化，未粘贴文本。')
          view.dispatch({ changes: { from: range.from, to: range.to, insert: result.data }, selection: { anchor: range.from + result.data.length }, userEvent: 'input.paste', annotations: isolateHistory.of('full') })
        }).catch(error => context.onError(error instanceof Error ? error.message : '粘贴失败。'))
        return true
      }
      return false
    },
    paste(event, view) {
      const context = getContext()
      if (context.readOnly || view.state.readOnly || context.mode === 'reading') return false
      const files = Array.from(event.clipboardData?.files || [])
      if (files.length) { event.preventDefault(); insertFiles(view, files); return true }
      if (context.mode !== 'hybrid' || !context.imageOptions.smartPaste) return false
      const html = event.clipboardData?.getData('text/html') || ''
      if (!html) return false
      try {
        const text = clipboardHtmlToMarkdown(html)
        if (text === null) return false
        event.preventDefault()
        view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true, annotations: isolateHistory.of('full') })
        return true
      } catch (error) {
        event.preventDefault(); context.onError(error instanceof Error ? error.message : '富文本粘贴失败。')
        return true
      }
    },
    drop(event, view) {
      const context = getContext()
      const files = Array.from(event.dataTransfer?.files || [])
      if (!files.length) return false
      event.preventDefault()
      if (context.readOnly || view.state.readOnly || context.mode === 'reading') return true
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (position !== null) insertFiles(view, files, position)
      return true
    },
    dragover(event) {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return false
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = getContext().readOnly ? 'none' : 'copy'
      return true
    },
  })
}
