import { isolateHistory } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import type { MarkdownEditorProps } from './types'
import type { LiveTableImageTarget } from './live-table'
import { focusLiveTableSelection } from './live-table'
import { clipboardHtmlToMarkdown } from './clipboard-import'
import { emptyTableCellIdentity, hasCompleteTable, imageInsertionContext } from './image-insertion-context'
import { tableHtmlChanges } from './table-html-changes'

/** Convert bounded paragraphs and inline formatting into one table cell. */
export function tableInlineHtmlToMarkdown(html: string): string | null {
  if (!html || html.length > 2 * 1024 * 1024) return null
  // Chromium prefixes copied HTML with this encoding declaration on macOS.
  html = html.replace(/^\s*<meta\s+charset=(['"])utf-8\1\s*\/?>/i, '')
  const allowed = new Set(['p', 'span', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'code', 'br', 'a'])
  // Reject resource-bearing and malformed markup before constructing a DOM.
  const tags = html.match(/<[^>]*>/g) || []
  if (html.replace(/<[^>]*>/g, '').includes('<')) return null
  for (const tag of tags) {
    const match = /^<\/?([a-z]+)(?:\s[^<>]*)?\/?>$/i.exec(tag)
    if (!match || !allowed.has(match[1].toLowerCase())) return null
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  let count = 0, paragraphs = 0
  const visit = (node: Node, depth: number): boolean => {
    if (++count > 20000 || depth > 64) return false
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) return true
    if (!(node instanceof HTMLElement)) return false
    const tag = node.tagName.toLowerCase()
    if (!allowed.has(tag)) return false
    if (tag === 'p') {
      paragraphs++
      if (paragraphs > 500 || node.parentElement !== parsed.body) return false
    }
    for (const attribute of Array.from(node.attributes)) {
      if (tag !== 'a' || !['href', 'title'].includes(attribute.name.toLowerCase())) return false
    }
    if (tag === 'a') {
      const href = (node.getAttribute('href') || '').trim()
      if (!href || /[\x00-\x20\x7f]/.test(href) || /^\/\//.test(href) || (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:https?|mailto):/i.test(href))) return false
    }
    return Array.from(node.childNodes).every(child => visit(child, depth + 1))
  }
  if (!Array.from(parsed.body.childNodes).every(node => visit(node, 0))) return null
  if (paragraphs && Array.from(parsed.body.childNodes).some(node => node.nodeType === Node.TEXT_NODE && /[^\t\n\r\f ]/.test(node.textContent || ''))) return null
  if (paragraphs > 1) {
    // Convert separately so an empty paragraph does not disappear when the
    // shared converter normalizes runs of block whitespace.
    const elements = Array.from(parsed.body.children)
    if (elements.some(node => node.tagName !== 'P')) return null
    return elements.map(node => clipboardHtmlToMarkdown(node.outerHTML, true) ?? '').join('\n\n')
  }
  return clipboardHtmlToMarkdown(html, true)
}

export function pasteTableInlineHtml(view: EditorView, props: MarkdownEditorProps, html: string, target: LiveTableImageTarget): void {
  if (props.readOnly || view.state.readOnly || view.composing || view.compositionStarted || !target.isCurrent()) throw new Error('无法安全粘贴 HTML 到此表格选区。')
  const markdown = tableInlineHtmlToMarkdown(html)
  if (!markdown) throw new Error('无法安全粘贴 HTML 到此表格选区。')
  const { range, virtualCell } = target
  const empty = virtualCell ? null : emptyTableCellIdentity(view.state, range)
  if (virtualCell ? !hasCompleteTable(view.state, virtualCell.tableFrom, virtualCell.tableTo) : !empty && imageInsertionContext(view.state, range) !== 'table') throw new Error('无法安全粘贴 HTML 到此表格选区。')
  const changes = tableHtmlChanges(view.state, range, markdown, virtualCell?.prefix, props.encoding, props.lineEnding)
  if (!changes) throw new Error('粘贴后的文件将超过 16 MB，未执行粘贴。')
  if (!target.isCurrent()) throw new Error('文档或表格选区已变化，未粘贴文本。')
  view.dispatch({ changes, selection: { anchor: changes.mapPos(range.from, 1) }, userEvent: 'input.paste', annotations: isolateHistory.of('full') })
  if (view.dom.ownerDocument.hasFocus()) focusLiveTableSelection(view)
}
