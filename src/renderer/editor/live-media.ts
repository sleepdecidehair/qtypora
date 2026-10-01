import { EditorView, WidgetType } from '@codemirror/view'
import { editLiveBlock } from './live-blocks'
import { hydratePreview, markdownParser, sanitizeMarkdownHtml } from './markdown'
import type { LiveOptions } from './live-types'
import { fitEditorResources } from './resource-fit'

export class LiveMediaWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly line: number, readonly source: string, readonly kind: 'math' | 'image', readonly options: LiveOptions) { super() }
  eq(other: LiveMediaWidget): boolean { return this.from === other.from && this.source === other.source && this.options.theme === other.options.theme && this.options.readOnly === other.options.readOnly }
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('span')
    container.className = 'cm-live-media'
    container.contentEditable = 'false'
    container.dataset.sourceFrom = String(this.from)
    container.dataset.sourceLine = String(this.line)
    container.dataset.sourceEnd = String(this.line)
    const content = document.createElement('span')
    const staging = document.createElement('span')
    staging.innerHTML = sanitizeMarkdownHtml(markdownParser.renderInline(this.source))
    const sources = new Map<HTMLElement, string>()
    for (const node of staging.querySelectorAll<HTMLElement>('[data-math]')) {
      sources.set(node, node.textContent || '')
      node.replaceChildren()
      node.dataset.sourceFrom = String(this.from)
      node.dataset.sourceLine = String(this.line)
      node.dataset.sourceEnd = String(this.line)
    }
    content.style.visibility = 'hidden'
    content.append(...Array.from(staging.childNodes))
    container.append(content)
    if (!this.options.readOnly) {
      const edit = document.createElement('button')
      edit.type = 'button'; edit.dataset.action = 'edit-block'; edit.className = 'cm-live-media-edit'
      edit.textContent = '编辑'
      edit.setAttribute('aria-label', this.kind === 'math' ? '编辑行内公式' : '编辑图片')
      edit.addEventListener('click', (event) => {
        event.preventDefault()
        if (view.state.readOnly) return
        view.dispatch({ effects: editLiveBlock.of({ from: this.from, to: this.to }), selection: { anchor: Math.min(this.to, this.from + 1) } })
        view.focus()
      })
      container.append(edit)
    }
    void hydratePreview(content, { ...this.options, sourceText: (node) => sources.get(node) || '', errorMode: 'placeholder' }).then(() => {
      content.style.visibility = 'visible'
      if (container.isConnected) { fitEditorResources(view); view.requestMeasure() }
    })
    return container
  }
  ignoreEvent(): boolean { return true }
}
