import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { hydratePreview, markdownParser, sanitizeMarkdownHtml } from './markdown'
import type { LiveBlock, LiveOptions } from './live-types'
import { fitEditorResources } from './resource-fit'

export const editLiveBlock = StateEffect.define<{ from: number; to: number } | null>({ map: (value, changes) => value ? { from: changes.mapPos(value.from), to: changes.mapPos(value.to, 1) } : null })
export const liveEditingBlock = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update: (value, transaction) => {
    if (value && transaction.docChanged) value = { from: transaction.changes.mapPos(value.from), to: transaction.changes.mapPos(value.to, 1) }
    for (const effect of transaction.effects) if (effect.is(editLiveBlock)) return effect.value
    if (value && transaction.selection && (transaction.state.selection.main.head < value.from || transaction.state.selection.main.head > value.to)) return null
    return value
  },
})

function detailsBlockEnd(tokens: ReturnType<typeof markdownParser.parse>, start: number): number | null {
  if (tokens[start].type !== 'html_block' || !/^\s*<details(?=[\s>])/i.test(tokens[start].content)) return null
  let depth = 0
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].type !== 'html_block') continue
    // Only HTML tokens participate: code examples and escaped tags remain literal text.
    const tags = /<!--[\s\S]*?(?:-->|$)|<(\/?)details(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
    for (const tag of tokens[index].content.matchAll(tags)) {
      if (tag[1] !== undefined) depth += tag[1] === '/' ? -1 : 1
    }
    if (depth === 0) return index + 1
    if (depth < 0) return null
  }
  return null
}

export function liveBlocks(state: EditorState): LiveBlock[] {
  if (state.doc.length > 200000) return []
  const env: Record<string, unknown> = {}
  const tokens = markdownParser.parse(state.doc.toString(), env)
  const blocks: LiveBlock[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.map || token.level !== 0 || token.nesting === -1) continue
    let kind: LiveBlock['kind'] | null = null
    if (token.type === 'table_open') kind = 'table'
    if (token.type === 'math_block') kind = 'math'
    if (token.type === 'fence' && token.info.trim().split(/\s+/)[0] === 'mermaid') kind = 'mermaid'
    if (token.type === 'html_block') kind = 'html'
    if (token.type === 'hr') kind = 'rule'
    if (token.type === 'paragraph_open' && tokens[index + 1]?.children?.every((child) => child.type === 'image' || (child.type === 'text' && !child.content.trim()))) kind = 'image'
    if (!kind) continue
    const [start, originalEnd] = token.map
    let last = index + 1
    if (token.nesting === 1) while (last < tokens.length && !(tokens[last].level === 0 && tokens[last].nesting === -1)) last++
    if (token.nesting === 1) last++
    const disclosureEnd = detailsBlockEnd(tokens, index)
    if (disclosureEnd !== null) last = disclosureEnd
    const end = disclosureEnd === null ? originalEnd : tokens[last - 1].map![1]
    if (start >= state.doc.lines || end <= start) continue
    const from = state.doc.line(start + 1).from
    const to = state.doc.line(Math.min(end, state.doc.lines)).to
    token.attrSet('data-source-line', String(start + 1))
    token.attrSet('data-source-end', String(end))
    blocks.push({ from, to, firstLine: start + 1, lastLine: end, source: state.doc.sliceString(from, to), html: markdownParser.renderer.render(tokens.slice(index, last), markdownParser.options, env), kind })
    index = last - 1
  }
  return blocks
}

export class LiveBlockWidget extends WidgetType {
  constructor(readonly block: LiveBlock, readonly options: LiveOptions) { super() }
  eq(other: LiveBlockWidget): boolean { return this.block.from === other.block.from && this.block.source === other.block.source && this.options.theme === other.options.theme && this.options.readOnly === other.options.readOnly }
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'md-preview-block cm-live-block'
    container.contentEditable = 'false'
    container.dataset.sourceFrom = String(this.block.from)
    container.dataset.sourceLine = String(this.block.firstLine)
    container.dataset.sourceEnd = String(this.block.lastLine)
    const staging = document.createElement('div')
    staging.innerHTML = sanitizeMarkdownHtml(this.block.html)
    const sources = new Map<HTMLElement, string>()
    for (const node of staging.querySelectorAll<HTMLElement>('[data-math],[data-mermaid]')) {
      sources.set(node, node.textContent || '')
      node.replaceChildren()
      node.dataset.sourceFrom = String(this.block.from)
      node.dataset.sourceLine = String(this.block.firstLine)
      node.dataset.sourceEnd = String(this.block.lastLine)
    }
    const content = document.createElement('div')
    content.className = 'cm-live-block-content'
    content.style.visibility = this.block.kind === 'math' || this.block.kind === 'mermaid' ? 'hidden' : 'visible'
    content.append(...Array.from(staging.childNodes))
    content.addEventListener('toggle', () => {
      if (container.isConnected) { fitEditorResources(view); view.requestMeasure() }
    }, true)
    container.append(content)
    if (!this.options.readOnly && this.block.kind !== 'rule') {
      const edit = document.createElement('button')
      edit.type = 'button'; edit.dataset.action = 'edit-block'; edit.className = 'cm-live-block-edit'
      edit.textContent = '编辑'
      edit.setAttribute('aria-label', this.block.kind === 'math' ? '编辑公式' : this.block.kind === 'mermaid' ? '编辑流程图' : '编辑此块')
      edit.addEventListener('click', (event) => {
        event.preventDefault()
        if (view.state.readOnly) return
        const contentStart = this.block.kind === 'mermaid' ? this.block.source.indexOf('\n') + 1 : this.block.kind === 'math' ? 2 : 0
        view.dispatch({ effects: editLiveBlock.of({ from: this.block.from, to: this.block.to }), selection: { anchor: Math.min(this.block.to, this.block.from + contentStart) } })
        view.focus()
      })
      container.append(edit)
    }
    content.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (anchor) {
        event.preventDefault()
        const href = anchor.getAttribute('href')
        if (href && (event.ctrlKey || event.metaKey)) this.options.onLinkOpen(href)
      }
    })
    void hydratePreview(content, { ...this.options, sourceText: (node) => sources.get(node) || '', errorMode: 'placeholder' }).then(() => {
      content.style.visibility = 'visible'
      if (container.isConnected) { fitEditorResources(view); view.requestMeasure() }
    })
    return container
  }
  ignoreEvent(): boolean { return true }
}
