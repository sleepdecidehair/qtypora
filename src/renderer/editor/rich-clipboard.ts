import type { ClipboardContent } from '../../shared/contracts'
import type { MarkdownOptions } from '../../shared/markdown-options'
import { renderMarkdown } from './markdown'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

// Keep parsing and RTF generation bounded even for the 16 MB source-only mode.
export const MAX_RICH_COPY_CHARACTERS = 200000

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
export function richFragmentToRtf(root: Node, fontSize = 24, theme?: RtfTheme): { rtf: string; plain: string } {
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
  const walk = (node: Node, depth: number) => {
    if (depth > 64) throw new Error('复制内容嵌套过深，请缩小选区。')
    if (node.nodeType === 3) { text(node.nodeValue || ''); return }
    if (node.nodeType !== 1) return
    const element = node as Element, tag = element.tagName.toUpperCase()
    if (tag === 'BR') { lineBreak(false); return }
    if (tag === 'IMG') { text(element.getAttribute('alt') || ''); return }
    if (tag === 'INPUT') { if (element.getAttribute('type') === 'checkbox') text(element.hasAttribute('checked') ? '☑ ' : '☐ '); return }
    const block = blockTags.has(tag)
    if (block) lineBreak(true)
    if (tag === 'LI') text('• ')
    if (tag === 'TH' || tag === 'TD') { if (!previousBreak) { output.push('\\tab '); plain.push('\t') } }
    const heading = /^H([1-6])$/.exec(tag)
    const controls = [tag === 'STRONG' || tag === 'B' || tag === 'TH' || heading ? '\\b ' : '', tag === 'EM' || tag === 'I' ? '\\i ' : '', tag === 'U' || tag === 'A' ? '\\ul ' : '', tag === 'S' || tag === 'DEL' ? '\\strike ' : '', tag === 'CODE' || tag === 'PRE' ? '\\f1 ' : '', heading ? `\\fs${Math.round(fontSize * (1.6 - Number(heading[1]) * 0.1))} ` : ''].join('')
    if (controls) output.push('{', controls)
    for (const child of Array.from(node.childNodes)) walk(child, depth + 1)
    if (controls) output.push('}')
    if (block) lineBreak(true)
  }
  for (const child of Array.from(root.childNodes)) walk(child, 0)
  output.push('}')
  return { rtf: output.join(''), plain: plain.join('').replace(/\n+$/, '') }
}

// A partial fence is not a standalone Markdown fragment. Complete the selected
// code body using its original delimiters before rendering the clipboard content.
export function richSelectionMarkdown(state: EditorState, from: number, to: number): string {
  const fragments: string[] = []
  let cursor = from
  syntaxTree(state).iterate({ from, to, enter(node) {
    if (node.name !== 'FencedCode') return
    const marks = node.node.getChildren('CodeMark')
    if (marks.length !== 2) return false
    const first = state.doc.lineAt(marks[0].from)
    const last = state.doc.lineAt(marks[1].from)
    const start = first.from, end = last.to, bodyFrom = first.to + 1, bodyTo = Math.max(bodyFrom, last.from - 1)
    if (from >= start && to <= end && from >= bodyFrom && to <= bodyTo) return false
    if (from <= start && to >= end) return false
    const selectedFrom = Math.max(from, start), selectedTo = Math.min(to, end)
    if (selectedFrom >= selectedTo) return false
    fragments.push(state.doc.sliceString(cursor, selectedFrom))
    const bodyStart = Math.max(selectedFrom, bodyFrom), bodyEnd = Math.min(selectedTo, bodyTo)
    if (bodyStart < bodyEnd) {
      fragments.push(first.text + '\n' + state.doc.sliceString(bodyStart, bodyEnd) + '\n' + last.text)
    }
    cursor = selectedTo
    return false
  } })
  fragments.push(state.doc.sliceString(cursor, to))
  return fragments.join('')
}

export function richClipboardContent(markdown: string, options: MarkdownOptions, source: HTMLElement, withTheme: boolean, locale?: import('../../shared/i18n').AppLocale): ClipboardContent {
  if (markdown.length > MAX_RICH_COPY_CHARACTERS) return { text: markdown }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderMarkdown(markdown, options, locale)
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
  const { rtf, plain } = richFragmentToRtf(wrapper, withTheme && Number.isFinite(pixels) ? pixels * 1.5 : 24, withTheme ? { fontFamily: computed.fontFamily, color } : undefined)
  return { text: options.copyPlainMarkdown ? markdown : plain, html: wrapper.outerHTML, rtf }
}

import { EditorView } from '@codemirror/view'
import { markdownOptionsFacet } from './markdown-config'
import { editorLocale } from './live-code'
import type { DesktopApi } from '../../shared/contracts'

interface RichCopyContext {
  mode: 'hybrid' | 'source' | 'reading'
  api: DesktopApi
  onError: (message: string) => void
}

/** Intercept document copying only; form controls and table range handlers retain native behavior. */
export function richClipboardExtension(getContext: () => RichCopyContext) {
  let pending: Promise<void> = Promise.resolve()
  const write = (content: ClipboardContent, context: RichCopyContext) => {
    pending = pending.catch(() => undefined).then(async () => {
      const result = await context.api.writeClipboard(content)
      if (!result.ok) throw new Error(result.error.message)
    }).catch(error => context.onError(error instanceof Error ? error.message : '复制失败。'))
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
      if (event.defaultPrevented || context.mode !== 'hybrid' || !isEditor(event.target, view)) return false
      const text = view.state.selection.ranges.map(range => richSelectionMarkdown(view.state, range.from, range.to)).join('\n')
      if (!text) return false
      let content: ClipboardContent
      try { content = richClipboardContent(text, view.state.facet(markdownOptionsFacet), view.contentDOM, true, view.state.facet(editorLocale)) }
      catch (error) { context.onError(error instanceof Error ? error.message : '富文本复制失败。'); return false }
      event.preventDefault()
      write(content, context)
      return true
    },
  })
}
