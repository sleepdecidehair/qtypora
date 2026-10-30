import type { EditorView } from '@codemirror/view'
import type { ClipboardContent, DesktopApi } from '../../shared/contracts'
import type { AppLocale } from '../../shared/i18n'
import type { MarkdownOptions } from '../../shared/markdown-options'
import { renderMarkdown } from './markdown'
import { assertFormattedCopySize, literalCodeHtml, literalCodeSelection, richFragmentToRtf, richSelectionMarkdown } from './rich-clipboard'
import { queueClipboardWrite } from './clipboard-write'

export type SelectionCopyAction = 'copy-markdown' | 'copy-plain' | 'copy-html'

export interface SelectionCopyContext {
  documentId: string
  revision: number
  mode: 'hybrid' | 'source' | 'reading'
  markdownOptions: MarkdownOptions
  locale?: AppLocale
  desktopApi: Pick<DesktopApi, 'writeClipboard'>
}

export function createSelectionCopy(view: EditorView, getContext: () => SelectionCopyContext) {
  return async (action: SelectionCopyAction): Promise<boolean> => {
    const context = getContext()
    const state = view.state
    if (context.mode === 'reading') return false
    const ranges = state.selection.ranges.filter(range => !range.empty)
    if (!ranges.length) return false
    const length = ranges.reduce((total, range) => total + range.to - range.from, ranges.length - 1)
    if (action !== 'copy-markdown') assertFormattedCopySize(length, context.locale)
    const source = ranges.map(range => state.doc.sliceString(range.from, range.to)).join('\n')
    let content: ClipboardContent
    if (action === 'copy-markdown') content = { text: source }
    else {
      const markdown = context.mode === 'hybrid'
        ? ranges.map(range => richSelectionMarkdown(state, range.from, range.to)).join('\n')
        : source
      const literal = context.mode === 'hybrid' && ranges.length === 1 ? literalCodeSelection(state, ranges[0].from, ranges[0].to) : null
      const html = literal != null ? literalCodeHtml(literal) : renderMarkdown(markdown, context.markdownOptions, context.locale)
      if (action === 'copy-html') content = { text: html, html }
      else {
        const wrapper = document.createElement('div')
        wrapper.innerHTML = html
        content = { text: richFragmentToRtf(wrapper, 24, undefined, literal != null).plain }
      }
    }
    await queueClipboardWrite(context.desktopApi, content, () => {
      const current = getContext()
      if (!view.dom.isConnected || current.documentId !== context.documentId || current.revision !== context.revision || !view.state.doc.eq(state.doc)) {
        throw new Error('文档已变化，未复制内容。')
      }
    })
    return true
  }
}
