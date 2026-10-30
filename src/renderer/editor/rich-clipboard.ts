import type { ClipboardContent } from '../../shared/contracts'
import type { MarkdownOptions } from '../../shared/markdown-options'
import { renderMarkdown } from './markdown'
import { queueClipboardWrite } from './clipboard-write'
import { ensureSyntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'

// Keep parsing and RTF generation bounded even for the 16 MB source-only mode.
export const MAX_RICH_COPY_CHARACTERS = 200000

export function assertFormattedCopySize(length: number, locale?: import('../../shared/i18n').AppLocale): void {
  if (length <= MAX_RICH_COPY_CHARACTERS) return
  throw new Error(locale === 'en-US' ? 'The selection is too large to copy as formatted content. Select less text or copy as Markdown.' : '选区过大，无法复制为格式化内容。请缩小选区或复制为 Markdown。')
}

/** RTF uses signed UTF-16 code units. Escaping every input character prevents
 * user text from injecting RTF control words or embedded objects. */
export function escapeRtfText(text: string): string {
  let result = ''
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit === 13) { if (text.charCodeAt(index + 1) === 10) index++; result += '\\line '; continue }
    if (unit === 10) { result += '\\line '; continue }
    if (unit === 9) { result += '\\tab '; continue }
    if (unit < 32 || unit === 127) continue
    if (unit === 92 || unit === 123 || unit === 125) result += '\\' + text[index]
    else if (unit < 127) result += text[index]
    else result += `\\u${unit > 32767 ? unit - 65536 : unit}?`
  }
  return result
}

const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'HR', 'DETAILS', 'SUMMARY'])

interface RtfTheme { fontFamily: string; color: [number, number, number] | null }

/** Convert a sanitized, detached fragment into clipboard output, not document source. */
export function richFragmentToRtf(root: Node, fontSize = 24, theme?: RtfTheme, preserveCodeEnd = false): { rtf: string; plain: string } {
  const family = theme?.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '').replace(/[;\x00-\x1f]/g, '').slice(0, 100) || 'Arial'
  const color = theme?.color
  const colorTable = color ? `{\\colortbl;\\red${color[0]}\\green${color[1]}\\blue${color[2]};}\\cf1` : ''
  const output: string[] = [`{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0\\fnil ${escapeRtfText(family)};}{\\f1\\fmodern Consolas;}}${colorTable}\\fs${Math.max(12, Math.min(144, Math.round(fontSize)))} `]
  const plain: string[] = []
  let previousBreak = true
  const text = (value: string) => {
    if (!value) return
    output.push(escapeRtfText(value)); plain.push(value); previousBreak = /\n$/.test(value)
  }
  const lineBreak = (paragraph: boolean) => {
    if (previousBreak) return
    output.push(paragraph ? '\\par\n' : '\\line '); plain.push('\n'); previousBreak = true
  }
  type ListCounter = { ordered: boolean; next: number }
  const listNumber = (value: string | null, fallback: number): number => {
    if (!value || !/^-?\d{1,9}$/.test(value.trim())) return fallback
    return Number(value)
  }
  const walk = (node: Node, depth: number, parentList?: ListCounter) => {
    if (depth > 64) throw new Error('复制内容嵌套过深，请缩小选区。')
    if (node.nodeType === 3) {
      let value = node.nodeValue || ''
      const parent = node.parentNode?.nodeName.toUpperCase()
      if (/^\s*$/.test(value) && value.includes('\n') && node.previousSibling?.nodeType === 1 && node.nextSibling?.nodeType === 1) {
        const before = node.previousSibling.nodeName.toUpperCase(), after = node.nextSibling.nodeName.toUpperCase()
        if ((blockTags.has(before) || before === 'OL' || before === 'UL') && (blockTags.has(after) || after === 'OL' || after === 'UL')) return
      }
      // Markdown renderer inserts newlines between list tags for readability;
      // these are not additional content in the copied list.
      if (parent === 'OL' || parent === 'UL' || parent === 'LI') {
        if (/^\s*$/.test(value)) return
        if (parent === 'LI' && node.nextSibling?.nodeType === 1 && /^(?:OL|UL)$/.test(node.nextSibling.nodeName.toUpperCase())) value = value.replace(/\n[\t ]*$/, '')
      }
      text(value); return
    }
    if (node.nodeType !== 1) return
    const element = node as Element, tag = element.tagName.toUpperCase()
    if (tag === 'BR') { lineBreak(false); return }
    if (tag === 'IMG') { text(element.getAttribute('alt') || ''); return }
    if (tag === 'INPUT') { if (element.getAttribute('type') === 'checkbox') text(element.hasAttribute('checked') ? '☑ ' : '☐ '); return }
    const block = blockTags.has(tag)
    if (block) lineBreak(true)
    if (tag === 'LI') {
      if (parentList?.ordered) {
        const number = listNumber(element.getAttribute('value'), parentList.next)
        text(`${number}. `)
        parentList.next = number + 1
      } else text('• ')
    }
    if (tag === 'TH' || tag === 'TD') { if (!previousBreak) { output.push('\\tab '); plain.push('\t') } }
    const heading = /^H([1-6])$/.exec(tag)
    const controls = [tag === 'STRONG' || tag === 'B' || tag === 'TH' || heading ? '\\b ' : '', tag === 'EM' || tag === 'I' ? '\\i ' : '', tag === 'U' || tag === 'A' ? '\\ul ' : '', tag === 'S' || tag === 'DEL' ? '\\strike ' : '', tag === 'CODE' || tag === 'PRE' ? '\\f1 ' : '', heading ? `\\fs${Math.round(fontSize * (1.6 - Number(heading[1]) * 0.1))} ` : ''].join('')
    if (controls) output.push('{', controls)
    const childList = tag === 'OL' ? { ordered: true, next: listNumber(element.getAttribute('start'), 1) } : tag === 'UL' ? { ordered: false, next: 1 } : undefined
    for (const child of Array.from(node.childNodes)) walk(child, depth + 1, childList)
    if (controls) output.push('}')
    if (block && !(preserveCodeEnd && tag === 'PRE')) lineBreak(true)
  }
  for (const child of Array.from(root.childNodes)) walk(child, 0)
  output.push('}')
  return { rtf: output.join(''), plain: preserveCodeEnd ? plain.join('') : plain.join('').replace(/\n+$/, '') }
}

// A partial fence is not a standalone Markdown fragment. Complete the selected
// code body using its original delimiters before rendering the clipboard content.
export function richSelectionMarkdown(state: EditorState, from: number, to: number): string {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) throw new Error('文档解析尚未完成，无法安全复制格式内容，请稍后重试或复制为 Markdown。')
  const fragments: string[] = []
  let cursor = from
  tree.iterate({ from, to, enter(node) {
    if (node.name !== 'FencedCode') return
    const marks = node.node.getChildren('CodeMark')
    if (!marks.length) return false
    const first = state.doc.lineAt(marks[0].from)
    const last = marks.length > 1 ? state.doc.lineAt(marks[1].from) : null
    const start = first.from, end = last?.to ?? node.to
    const bodyFrom = Math.min(first.to + 1, end), bodyTo = last ? Math.max(bodyFrom, last.from - 1) : end
    if (from <= start && to >= end) return false
    const selectedFrom = Math.max(from, start), selectedTo = Math.min(to, end)
    if (selectedFrom >= selectedTo) return false
    const bodyStart = Math.max(selectedFrom, bodyFrom), bodyEnd = Math.min(selectedTo, bodyTo)
    fragments.push(state.doc.sliceString(cursor, selectedFrom))
    if (bodyStart < bodyEnd) {
      const body = literalCodeSelection(state, bodyStart, bodyEnd, selectedFrom <= bodyFrom)
      if (body === null) throw new Error('无法安全复制该代码选区，请复制为 Markdown。')
      const marker = state.doc.sliceString(marks[0].from, marks[0].to)
      const character = marker[0]
      let longest = marker.length
      for (const match of body.matchAll(character === '`' ? /`+/g : /~+/g)) longest = Math.max(longest, match[0].length + 1)
      const safeMarker = character.repeat(longest)
      const opening = safeMarker + first.text.slice(marks[0].to - first.from)
      const closing = safeMarker
      fragments.push(opening + '\n' + body + (body.endsWith('\n') ? '' : '\n') + closing)
    }
    cursor = selectedTo
    return false
  } })
  fragments.push(state.doc.sliceString(cursor, to))
  return fragments.join('')
}

/** Exact source when a single selection lies entirely in a fenced code body. */
export function literalCodeSelection(state: EditorState, from: number, to: number, allowLeadingPrefix = false): string | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) throw new Error('文档解析尚未完成，无法安全复制格式内容，请稍后重试或复制为 Markdown。')
  let result: string | null = null
  tree.iterate({ from, to, enter(node) {
    if (node.name !== 'FencedCode') return
    const marks = node.node.getChildren('CodeMark')
    if (!marks.length) return false
    const opening = state.doc.lineAt(marks[0].from)
    const start = Math.min(opening.to + 1, node.to)
    const end = marks.length > 1 ? state.doc.lineAt(marks[1].from).from : node.to
    if (from >= start && to <= end) {
      const token = markdownDocumentModel(state).tokens.find(token => token.type === 'fence' && token.map?.[0] === opening.number - 1)
      if (!token) throw new Error('无法安全复制该代码选区，请复制为 Markdown。')
      const lines = token.content.split('\n')
      let position = from, text = ''
      while (position < to) {
        const line = state.doc.lineAt(position)
        const logical = lines[line.number - opening.number - 1]
        if (logical === undefined || !line.text.endsWith(logical)) throw new Error('无法安全复制该代码选区，请复制为 Markdown。')
        const contentFrom = line.to - logical.length
        if (position === from && position < contentFrom && !(allowLeadingPrefix && position === line.from)) throw new Error('无法安全复制该代码选区，请复制为 Markdown。')
        const partEnd = Math.min(to, line.to)
        if (partEnd > contentFrom) text += state.doc.sliceString(Math.max(position, contentFrom), partEnd)
        if (to > line.to && line.to < state.doc.length) text += '\n'
        position = Math.min(to, line.to + 1)
      }
      result = text
    }
    return false
  } })
  return result
}

/** Build a literal code fragment without adding a synthetic terminal newline. */
export function literalCodeHtml(text: string): string {
  const wrapper = document.createElement('div')
  const pre = document.createElement('pre'), code = document.createElement('code')
  code.textContent = text
  pre.appendChild(code)
  wrapper.appendChild(pre)
  return wrapper.innerHTML
}

export function richClipboardContent(markdown: string, options: MarkdownOptions, source: HTMLElement, withTheme: boolean, locale?: import('../../shared/i18n').AppLocale, literalCode?: string | null): ClipboardContent {
  if (markdown.length > MAX_RICH_COPY_CHARACTERS) return { text: markdown }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = literalCode != null ? literalCodeHtml(literalCode) : renderMarkdown(markdown, options, locale)
  const computed = getComputedStyle(source)
  if (withTheme) {
    // Values are read from Chromium's computed style and assigned through CSSOM;
    // no document-supplied style string or resource URL is copied.
    wrapper.style.color = computed.color
    wrapper.style.backgroundColor = computed.backgroundColor
    wrapper.style.fontFamily = computed.fontFamily
    wrapper.style.fontSize = computed.fontSize
    wrapper.style.lineHeight = computed.lineHeight
  }
  const pixels = Number.parseFloat(computed.fontSize)
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(computed.color)
  const color: [number, number, number] | null = rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map(value => Math.max(0, Math.min(255, value))) as [number, number, number] : null
  const { rtf, plain } = richFragmentToRtf(wrapper, withTheme && Number.isFinite(pixels) ? pixels * 1.5 : 24, withTheme ? { fontFamily: computed.fontFamily, color } : undefined, literalCode != null)
  return { text: options.copyPlainMarkdown ? markdown : plain, html: wrapper.outerHTML, rtf }
}

import { EditorView } from '@codemirror/view'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'
import { editorLocale } from './live-code'
import type { DesktopApi } from '../../shared/contracts'

interface RichCopyContext {
  mode: 'hybrid' | 'source' | 'reading'
  api: DesktopApi
  onError: (message: string) => void
  documentId?: string
  revision?: number
  closeCoordinator?: import('./close-coordinator').CloseCoordinator
}

/** Intercept document copying only; form controls and table range handlers retain native behavior. */
export function richClipboardExtension(getContext: () => RichCopyContext) {
  const write = (content: ClipboardContent, context: RichCopyContext) => {
    void queueClipboardWrite(context.api, content).catch(error => context.onError(error instanceof Error ? error.message : '复制失败。'))
  }
  const selection = (view: EditorView): string => view.state.selection.ranges.map(range => view.state.doc.sliceString(range.from, range.to)).join('\n')
  const isEditor = (target: EventTarget | null, view: EditorView): boolean => target instanceof Element && view.contentDOM.contains(target) && !target.closest('input, textarea, select')
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'c' || !isEditor(event.target, view)) return false
      const text = selection(view)
      if (!text) return false
      event.preventDefault()
      write({ text }, getContext())
      return true
    },
    copy(event, view) {
      const context = getContext()
      if (event.defaultPrevented || context.mode === 'reading' || !isEditor(event.target, view)) return false
      const raw = selection(view)
      if (!raw) return false
      let content: ClipboardContent
      try {
        const text = context.mode === 'hybrid' ? view.state.selection.ranges.map(range => richSelectionMarkdown(view.state, range.from, range.to)).join('\n') : raw
        if (!text) return false
        const options = view.state.facet(markdownOptionsFacet)
        const ranges = view.state.selection.ranges.filter(range => !range.empty)
        const literal = context.mode === 'hybrid' && ranges.length === 1 ? literalCodeSelection(view.state, ranges[0].from, ranges[0].to) : null
        content = context.mode === 'hybrid' ? richClipboardContent(text, options, view.contentDOM, true, view.state.facet(editorLocale), literal) : { text }
        if (context.mode === 'hybrid' && options.copyPlainMarkdown) content.text = raw
      } catch (error) {
        event.preventDefault()
        context.onError(error instanceof Error ? error.message : '富文本复制失败。')
        return true
      }
      event.preventDefault()
      write(content, context)
      return true
    },
    cut(event, view) {
      const context = getContext()
      if (event.defaultPrevented || context.mode === 'reading' || !isEditor(event.target, view) || !(event.target instanceof Element) || event.target.closest('th,td')) return false
      const ranges = view.state.selection.ranges.filter(range => !range.empty)
      // Preserve CodeMirror's native linewise cut and subsequent linewise paste.
      if (!ranges.length) return false
      event.preventDefault()
      if (view.composing || view.compositionStarted) return true
      if (view.state.readOnly) { write({ text: ranges.map(range => view.state.doc.sliceString(range.from, range.to)).join('\n') }, context); return true }
      const finish = context.closeCoordinator?.start()
      if (!finish || !context.documentId || context.revision === undefined) { finish?.(); context.onError('无法安全剪切当前文档。'); return true }
      const original = view.state.doc, selected = view.state.selection
      const text = ranges.map(range => original.sliceString(range.from, range.to)).join('\n')
      const unchanged = () => {
        const current = getContext()
        if (!view.dom.isConnected || current.documentId !== context.documentId || current.revision !== context.revision || current.mode !== context.mode || view.state.readOnly || view.composing || view.compositionStarted || view.state.doc !== original || !view.state.selection.eq(selected)) throw new Error('文档或选区已变化，未剪切文本。')
      }
      void queueClipboardWrite(context.api, { text }, unchanged).then(() => {
        unchanged()
        view.dispatch({ changes: ranges.map(range => ({ from: range.from, to: range.to, insert: '' })), userEvent: 'delete.cut', annotations: isolateHistory.of('full'), scrollIntoView: true })
      }).catch(error => context.onError(error instanceof Error ? error.message : '剪切失败。')).finally(finish)
      return true
    },
  })
}
