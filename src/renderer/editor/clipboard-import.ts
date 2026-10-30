import { EditorView } from '@codemirror/view'
import { EditorState, Transaction, type Extension } from '@codemirror/state'
import DOMPurify from 'dompurify'
import { htmlPasteContext } from './html-paste-context'
import { fitsPasteBudget } from './paste-budget'
import emoji from 'markdown-it-emoji/lib/data/full.mjs'
import { isolateHistory } from '@codemirror/commands'
import type { DocumentSnapshot, Result } from '../../shared/contracts'
import type { ImageImportRequest, ImageImportResult, ImageOptions } from '../../shared/image-options'

const MAX_CLIPBOARD = 16 * 1024 * 1024
const imageMime = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/bmp', '.bmp'], ['image/svg+xml', '.svg'], ['image/x-icon', '.ico']])

export async function readClipboardImages(files: File[]): Promise<import('../../shared/image-options').ImportedImage[]> {
  if (!files.length || files.length > 20 || files.some(file => file.size > MAX_CLIPBOARD) || files.reduce((sum, file) => sum + file.size, 0) > MAX_CLIPBOARD * 2) throw new Error('每次最多插入 20 张图片，单张不超过 16 MB，总计不超过 32 MB。')
  const images = []
  for (const file of files) {
    const extension = imageMime.get(file.type)
    if (!extension && !/\.(?:png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(file.name)) throw new Error('拖放和粘贴文件目前只接受图片。')
    const name = /\.[a-z\d]+$/i.test(file.name) ? file.name : `${file.name || 'image'}${extension || '.png'}`
    images.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return images
}

function trimHtmlWhitespace(text: string): string { return text.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '') }
function extensionMarkers(text: string): Set<number> {
  const markers = new Set<number>()
  const patterns: { expression: RegExp; width: number }[] = [
    { expression: /\$(?!\$)(?=\S)(?:[^$]*?[^\s$])?\$/g, width: 1 },
    { expression: /==(?=\S)[^=]+?==/g, width: 2 },
    { expression: /~~(?=\S)[^~]+?~~/g, width: 2 },
    { expression: /~(?:[^~\s]|\n)+~/g, width: 1 },
    { expression: /\^(?:[^\^\s]|\n)+\^/g, width: 1 },
  ]
  for (const { expression, width } of patterns) for (const match of text.matchAll(expression)) {
    for (let index = 0; index < width; index++) {
      markers.add(match.index + index)
      markers.add(match.index + match[0].length - width + index)
    }
  }
  for (const match of text.matchAll(/^ {0,3}\$\$/gm)) {
    const start = match.index + match[0].indexOf('$')
    markers.add(start); markers.add(start + 1)
  }
  for (const match of text.matchAll(/:[\w+-]+:/g)) {
    if (Object.hasOwn(emoji, match[0].slice(1, -1))) {
      markers.add(match.index); markers.add(match.index + match[0].length - 1)
    }
  }
  return markers
}
function escapedText(text: string, extra?: ReadonlySet<number>, formattingMarkers: ReadonlySet<string> = new Set()): string {
  const markers = extensionMarkers(text)
  let escaped = ''
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    escaped += ((markers.has(index) || extra?.has(index) || formattingMarkers.has(character)) || /[\\`*_\[\]<>]/.test(character) ? '\\' : '') + character
  }
  return escaped.replace(/(^|\n)( {0,3})([#~+=-])/g, '$1$2\\$3')
    .replace(/(^|\n)( {0,3}\d{1,9})([.)])(?=[ \t]|$)/g, '$1$2\\$3')
}

/** Pick a delimiter longer than any backtick run without spreading large arrays. */
export function codeFenceWidth(text: string, minimum: number): number {
  let width = minimum
  for (const match of text.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
  return width
}

/** Prefer the shorter safe block delimiter to avoid expanding long code. */
export function codeBlockFence(text: string): string {
  const backticks = codeFenceWidth(text, 3)
  let tildes = 3
  for (const match of text.matchAll(/~+/g)) tildes = Math.max(tildes, match[0].length + 1)
  return backticks <= tildes ? '`'.repeat(backticks) : '~'.repeat(tildes)
}

function safeUrl(source: string): string | null {
  const value = source.trim()
  if (!value || /[\x00-\x20\x7f]/.test(value) || /^(?:javascript|vbscript|data|file|blob):/i.test(value) || /^\/\//.test(value)) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^(?:https?|mailto):/i.test(value)) return null
  return value.replace(/[()]/g, value => encodeURIComponent(value).replace('(', '%28').replace(')', '%29'))
}

/** Convert only external clipboard markup, never the editor's rendered document. */
export function clipboardHtmlToMarkdown(html: string, tableCell = false): string | null {
  if (!html || html.length > MAX_CLIPBOARD) return null
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'section', 'article', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'mark', 'sup', 'sub', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'input'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'start', 'type', 'checked'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  })
  const host = document.createElement('div')
  host.innerHTML = sanitized
  // Adjacent equivalent inline nodes otherwise create ambiguous Markdown
  // delimiter runs, changing both the visible text and formatting.
  const equivalent = (element: Element): string | null => {
    if (element.attributes.length) return null
    const tag = element.tagName.toLowerCase()
    return tag === 'strong' || tag === 'b' ? 'strong' : tag === 'em' || tag === 'i' ? 'em' : tag === 'code' ? 'code' : null
  }
  const pending: Element[] = [host]
  let normalized = 0
  while (pending.length) {
    const parent = pending.pop()!
    if (++normalized > 20000) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
    // Neutral spans must not split plain text before Markdown syntax detection.
    // Keep attributed spans and semantic elements as boundaries.
    let node: ChildNode | null = parent.firstChild
    while (node) {
      if (++normalized > 40000) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
      if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'span' && !node.attributes.length) {
        const next = node.firstChild ?? node.nextSibling
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
        node = next
      } else node = node.nextSibling
    }
    node = parent.firstChild
    while (node) {
      if (node.nodeType !== Node.TEXT_NODE) { node = node.nextSibling; continue }
      const pieces = [node.textContent || '']
      while (node.nextSibling?.nodeType === Node.TEXT_NODE) {
        pieces.push(node.nextSibling.textContent || '')
        parent.removeChild(node.nextSibling)
      }
      if (pieces.length > 1) node.textContent = pieces.join('')
      node = node.nextSibling
    }
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      const kind = equivalent(child)
      while (kind && child.nextSibling instanceof Element && equivalent(child.nextSibling) === kind) {
        const next = child.nextSibling
        while (next.firstChild) child.appendChild(next.firstChild)
        next.remove()
      }
      pending.push(child)
    }
  }
  // Detect literal extension markers across inline semantic boundaries. The
  // originating text node owns the escape; real formatting nodes stay intact.
  const protectedMarkers = new WeakMap<Node, Set<number>>()
  let segments: { node: Node; start: number; text: string; code: boolean; virtual?: boolean }[] = []
  let length = 0, inspected = 0
  const flushText = () => {
    if (!segments.length) return
    let previousSpace = false
    length = 0
    for (const segment of segments) {
      if (!segment.code && !segment.virtual) {
        let normalizedText = segment.text.replace(/[ \t\n\r\f]+/g, ' ')
        if (previousSpace && normalizedText.startsWith(' ')) normalizedText = normalizedText.slice(1)
        if (normalizedText !== segment.text) segment.node.textContent = normalizedText
        segment.text = normalizedText
      }
      segment.start = length
      length += segment.text.length
      if (segment.virtual) previousSpace = false
      else if (segment.text) previousSpace = !segment.code && segment.text.endsWith(' ')
    }
    const text = segments.map(segment => segment.text).join('')
    const markers = [...extensionMarkers(text)].sort((a, b) => a - b)
    let index = 0
    for (const marker of markers) {
      while (index + 1 < segments.length && marker >= segments[index].start + segments[index].text.length) index++
      const segment = segments[index]
      if (marker < segment.start || marker >= segment.start + segment.text.length) continue
      let offsets = protectedMarkers.get(segment.node)
      if (!offsets) { offsets = new Set(); protectedMarkers.set(segment.node, offsets) }
      offsets.add(marker - segment.start)
    }
    segments = []; length = 0
  }
  const blockTags = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th'])
  const collectText = (node: Node, depth: number, insideCode = false) => {
    if (++inspected > 20000 || depth > 64) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      segments.push({ node, start: length, text, code: insideCode }); length += text.length
      return
    }
    if (!(node instanceof HTMLElement)) return
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') {
      segments.push({ node, start: length, text: '\n', code: false, virtual: true }); length++
      return
    }
    if (tag === 'pre' || tag === 'hr' || tag === 'img' || tag === 'input') { flushText(); return }
    const boundary = blockTags.has(tag)
    if (boundary) flushText()
    for (const child of Array.from(node.childNodes)) collectText(child, depth + 1, insideCode || tag === 'code')
    if (boundary) flushText()
  }
  for (const child of Array.from(host.childNodes)) collectText(child, 0)
  flushText()
  // Keep code newlines distinct while surrounding block whitespace is normalized.
  let codeNewlineMarker = '\uE000'
  while (host.innerHTML.includes(codeNewlineMarker) || (host.textContent || '').includes(codeNewlineMarker)) codeNewlineMarker += '\uE000'
  let visited = 0
  const codeParts = (root: Node, depth: number): string[] => {
    const parts = ['']
    const walk = (node: Node, level: number): void => {
      if (++visited > 20000 || level > 64) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
      if (node.nodeType === Node.TEXT_NODE) { parts[parts.length - 1] += node.textContent || ''; return }
      if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'br') { parts.push(''); return }
      for (const child of Array.from(node.childNodes)) walk(child, level + 1)
    }
    for (const child of Array.from(root.childNodes)) walk(child, depth + 1)
    return parts
  }
  const render = (node: Node, depth: number): string => {
    if (++visited > 20000 || depth > 64) throw new Error('剪贴板内容过于复杂，请使用纯文本粘贴。')
    if (node.nodeType === Node.TEXT_NODE) {
      const formattingMarkers = new Set<string>()
      for (let parent = node.parentElement; parent && parent !== host; parent = parent.parentElement) {
        const tag = parent.tagName.toLowerCase()
        if (tag === 's' || tag === 'del' || tag === 'sub') formattingMarkers.add('~')
        if (tag === 'mark') formattingMarkers.add('=')
        if (tag === 'sup') formattingMarkers.add('^')
      }
      return escapedText(node.textContent || '', protectedMarkers.get(node), formattingMarkers)
    }
    if (!(node instanceof HTMLElement)) return ''
    const children = () => Array.from(node.childNodes, child => render(child, depth + 1)).join('')
    const inner = () => trimHtmlWhitespace(children())
    const wrapInline = (prefix: string, suffix = prefix, transform = (text: string) => text): string => {
      const content = children()
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!
      if (!match[2]) return content
      const leading = match[1].replace(/[ \t]+/g, ' ')
      const trailing = match[3].replace(/[ \t]+/g, ' ')
      return leading + prefix + transform(match[2]) + suffix + trailing
    }
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') return tableCell || node.closest('td,th') ? '<br>' : '\\\n' + codeNewlineMarker
    if (tag === 'hr') return '\n\n---\n\n'
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${inner()}\n\n`
    if (['p', 'div', 'section', 'article'].includes(tag)) return `\n\n${inner()}\n\n`
    if (tag === 'strong' || tag === 'b') return wrapInline('**')
    if (tag === 'em' || tag === 'i') return wrapInline('*')
    if (tag === 's' || tag === 'del') return wrapInline('~~')
    if (tag === 'u') return `<u>${children()}</u>`
    if (tag === 'mark') return wrapInline('==')
    if (tag === 'sup') return wrapInline('^', '^', text => text.replaceAll(' ', '\\ '))
    if (tag === 'sub') return wrapInline('~', '~', text => text.replaceAll(' ', '\\ '))
    if (tag === 'pre') {
      const text = codeParts(node, depth).join('\n')
      const fence = codeBlockFence(text)
      const code = text.replace(/\n$/, '').replace(/\n/g, codeNewlineMarker + '\n')
      return `\n\n${fence}\n${code}\n${fence}\n\n`
    }
    if (tag === 'code') {
      const parts = codeParts(node, depth)
      const span = (text: string): string => {
        if (!text) return ''
        const fence = '`'.repeat(codeFenceWidth(text, 1))
        const padding = /^`|`$|^ .* $/.test(text) ? ' ' : ''
        return `${fence}${padding}${text}${padding}${fence}`
      }
      return parts.map(span).join(tableCell || node.closest('td,th') ? '<br>' : '\\\n' + codeNewlineMarker)
    }
    if (tag === 'blockquote') return `\n\n${inner().replace(/\n{3,}/g, '\n\n').split('\n').map(line => `> ${line}`).join('\n')}\n\n`
    if (tag === 'ul' || tag === 'ol') {
      const first = Number(node.getAttribute('start') || 1)
      const start = Number.isSafeInteger(first) && first > 0 ? first : 1
      const items = Array.from(node.children).filter(child => child.tagName === 'LI')
      return '\n\n' + items.map((item, index) => {
        const value = trimHtmlWhitespace(render(item, depth + 1)).replace(/\n{3,}/g, '\n\n')
        const marker = tag === 'ol' ? `${start + index}. ` : '- '
        return marker + value.split('\n').join('\n' + ' '.repeat(marker.length))
      }).join('\n') + '\n\n'
    }
    if (tag === 'a') {
      const url = safeUrl(node.getAttribute('href') || '')
      if (!url) return children()
      const content = children()
      if (!content) return ''
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!
      return match[2] ? `${match[1]}[${match[2]}](${url})${match[3]}` : content
    }
    if (tag === 'img') {
      const url = safeUrl(node.getAttribute('src') || '')
      return url ? `![${escapedText(node.getAttribute('alt') || '')}](${url})` : escapedText(node.getAttribute('alt') || '')
    }
    if (tag === 'input') return node.getAttribute('type') === 'checkbox' ? `[${node.hasAttribute('checked') ? 'x' : ' '}] ` : ''
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).map(row => Array.from(row.children).filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH').map(cell => trimHtmlWhitespace(render(cell, depth + 1)).replace(/\n+/g, '<br>').replace(/(?<!\\)\|/g, '\\|')))
      const columns = Math.max(0, ...rows.map(row => row.length))
      if (!rows.length || !columns || rows.length > 500 || columns > 50) return children()
      const line = (cells: string[]) => '| ' + Array.from({ length: columns }, (_, index) => cells[index] || '').join(' | ') + ' |'
      return `\n\n${line(rows[0])}\n${line(Array(columns).fill('---'))}\n${rows.slice(1).map(line).join('\n')}\n\n`
    }
    return children()
  }
  const markdown = trimHtmlWhitespace(Array.from(host.childNodes, node => render(node, 0)).join('').replace(/\n{3,}/g, '\n\n')).split(codeNewlineMarker).join('')
  return markdown || null
}

export interface ClipboardImportContext {
  closeCoordinator: import('./close-coordinator').CloseCoordinator
  snapshot: DocumentSnapshot
  mode: 'hybrid' | 'source' | 'reading'
  encoding: import('../../shared/contracts').DocumentRecord['encoding']
  lineEnding: import('../../shared/contracts').LineEnding
  readOnly: boolean
  imageOptions: ImageOptions
  importImages: (request: ImageImportRequest) => Promise<Result<ImageImportResult | null>>
  readClipboardText: () => Promise<Result<string>>
  onError: (message: string) => void
}

export function clipboardImportExtension(getContext: () => ClipboardImportContext): Extension {
  let pending = false, nativePastePending = false
  const allowNativePaste = (): false => {
    nativePastePending = true
    queueMicrotask(() => { nativePastePending = false })
    return false
  }
  const nativePasteBudget = EditorState.transactionFilter.of(transaction => {
    if (!nativePastePending || !transaction.docChanged || !transaction.isUserEvent('input.paste')) return transaction
    const context = getContext()
    if (fitsPasteBudget(transaction.startState.doc, transaction.newDoc, context.encoding, context.lineEnding)) return transaction
    queueMicrotask(() => {
      if (getContext().snapshot.id === context.snapshot.id) context.onError('粘贴后的文件将超过 16 MB，未执行粘贴。')
    })
    return []
  })
  const insertFiles = (view: EditorView, files: File[], at?: number): void => {
    const context = getContext()
    if (context.readOnly || view.state.readOnly || pending) return
    const selection = view.state.selection.main
    const originalSelection = view.state.selection
    const range = at === undefined ? { from: selection.from, to: selection.to } : { from: at, to: at }
    const original = view.state.doc
    const owner = view.dom.ownerDocument, originalFocus = owner.activeElement
    const unchanged = () => {
      const current = getContext()
      return view.dom.isConnected && current.snapshot.id === context.snapshot.id && current.snapshot.revision === context.snapshot.revision && view.state.doc.eq(original) && !view.state.readOnly && !current.readOnly && current.mode === context.mode && current.encoding === context.encoding && current.lineEnding === context.lineEnding && current.imageOptions.uploadOnInsert === context.imageOptions.uploadOnInsert && (at !== undefined || view.state.selection.eq(originalSelection))
    }
    const finish = context.closeCoordinator.start()
    if (!finish) { context.onError('文档正在关闭，操作未执行。'); return }
    pending = true
    void (async () => {
      const images = await readClipboardImages(files)
      if (!unchanged()) throw new Error('文档或选区已变化，未插入图片。请重新粘贴或拖放。')
      const pasteBudget = !context.imageOptions.uploadOnInsert ? { ...range, table: false, block: true, encoding: context.encoding, lineEnding: context.lineEnding } : undefined
      const result = await context.importImages({ ...context.snapshot, content: original.toString(), images, ...(pasteBudget ? { pasteBudget } : {}) })
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) return
      if (!unchanged()) throw new Error('图片已保存，文档已改变，未插入引用。请重新插入图片。')
      const before = range.from > 0 && original.sliceString(range.from - 1, range.from) !== '\n' ? '\n\n' : ''
      const after = range.to < original.length && original.sliceString(range.to, range.to + 1) !== '\n' ? '\n\n' : ''
      const insert = before + result.data.markdown + after
      const restoreFocus = owner.hasFocus() && (owner.activeElement === originalFocus || view.hasFocus)
      view.dispatch({ changes: { ...range, insert }, selection: { anchor: range.from + insert.length }, annotations: [Transaction.userEvent.of('input.paste'), isolateHistory.of('full')] })
      if (restoreFocus && owner.hasFocus()) view.focus()
    })().catch(error => context.onError(error instanceof Error ? error.message : '图片插入失败。')).finally(() => { pending = false; finish() })
  }
  return [nativePasteBudget, EditorView.domEventHandlers({
    keydown(event, view) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        const context = getContext(), original = view.state.doc, selection = view.state.selection, range = selection.main
        if (context.readOnly || view.state.readOnly || context.mode === 'reading') return true
        const finish = context.closeCoordinator.start()
        if (!finish) { context.onError('文档正在关闭，操作未执行。'); return true }
        void context.readClipboardText().then(result => {
          if (!result.ok) throw new Error(result.error.message)
          const current = getContext()
          if (!view.dom.isConnected || current.snapshot.id !== context.snapshot.id || current.snapshot.revision !== context.snapshot.revision || current.mode !== context.mode || current.encoding !== context.encoding || current.lineEnding !== context.lineEnding || current.readOnly || view.state.readOnly || !view.state.doc.eq(original) || !view.state.selection.eq(selection)) throw new Error('文档或选区已变化，未粘贴文本。')
          const changes = view.state.changes({ from: range.from, to: range.to, insert: result.data })
          const nextDocument = changes.apply(original)
          if (!fitsPasteBudget(original, nextDocument, current.encoding, current.lineEnding)) throw new Error('粘贴后的文件将超过 16 MB，未执行粘贴。')
          view.dispatch({ changes, selection: { anchor: changes.mapPos(range.from, 1) }, userEvent: 'input.paste', annotations: isolateHistory.of('full') })
        }).catch(error => context.onError(error instanceof Error ? error.message : '粘贴失败。')).finally(finish)
        return true
      }
      return false
    },
    paste(event, view) {
      const context = getContext()
      if (context.readOnly || view.state.readOnly || context.mode === 'reading') return false
      const files = Array.from(event.clipboardData?.files || [])
      if (files.length) { event.preventDefault(); insertFiles(view, files); return true }
      if (context.mode !== 'hybrid' || !context.imageOptions.smartPaste) return allowNativePaste()
      const html = event.clipboardData?.getData('text/html') || ''
      if (!html) return allowNativePaste()
      try {
        const plain = event.clipboardData?.getData('text/plain') || ''
        const target = htmlPasteContext(view.state, plain)
        if (target.kind === 'unsafe') {
          event.preventDefault(); context.onError('无法安全粘贴到该代码位置，请调整选区或内容后重试。'); return true
        }
        const text = target.kind === 'code' ? target.text : clipboardHtmlToMarkdown(html)
        if (target.kind === 'code' && !plain) { event.preventDefault(); context.onError('剪贴板没有可粘贴的纯文本。'); return true }
        if (text === null) return allowNativePaste()
        const replacement = view.state.replaceSelection(text ?? plain)
        const nextDocument = view.state.changes(replacement.changes).apply(view.state.doc)
        if (!fitsPasteBudget(view.state.doc, nextDocument, context.encoding, context.lineEnding)) {
          event.preventDefault(); context.onError('粘贴后的文件将超过 16 MB，未执行粘贴。'); return true
        }
        event.preventDefault()
        const transaction = view.state.update(replacement, { userEvent: 'input.paste', scrollIntoView: true, annotations: isolateHistory.of('full') })
        view.dispatch(transaction)
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
  })]
}
