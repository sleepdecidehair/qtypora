import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { inlinePreviewSpans } from './live-inline'
import { editLiveBlock, liveBlocks, liveEditingBlock, LiveBlockWidget } from './live-blocks'
import { LiveTableWidget } from './live-table'
import type { LiveOptions } from './live-types'
import { isSafeLink } from './markdown'
import { syntaxTree } from '@codemirror/language'
import { LiveMediaWidget } from './live-media'
import { resourceFitExtension } from './resource-fit'
import { liveCodeBlocks, liveCodeExtension } from './live-code'
import { liveSourceEditExtension } from './live-source-edit'

export type HybridOptions = LiveOptions

class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly checked: boolean, readonly readOnly: boolean) { super() }
  eq(other: TaskWidget): boolean { return this.from === other.from && this.checked === other.checked && this.readOnly === other.readOnly }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'; input.checked = this.checked; input.disabled = this.readOnly
    input.setAttribute('aria-label', this.checked ? '标为未完成' : '标为完成')
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('click', (event) => {
      event.preventDefault()
      if (!view.state.readOnly) view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.task' })
    })
    return input
  }
  ignoreEvent(): boolean { return true }
}

function decorations(state: EditorState, options: HybridOptions): DecorationSet {
  if (state.doc.length > 200000) return Decoration.none
  const ranges: Range<Decoration>[] = []
  const blocks = liveBlocks(state)
  const editing = state.field(liveEditingBlock)
  const isEditing = (from: number, to: number): boolean => Boolean(editing && from >= editing.from && to <= editing.to)
  const codeBlocks = liveCodeBlocks(state).filter(block => !isEditing(block.from, block.to))
  const excluded = blocks.filter((block) => !isEditing(block.from, block.to))
  const mediaRanges: { from: number; to: number }[] = []
  syntaxTree(state).iterate({ enter: (node) => {
    if (excluded.some((block) => node.from >= block.from && node.to <= block.to)) return false
    if (isEditing(node.from, node.to)) return false
    if (node.name === 'Image') {
      mediaRanges.push({ from: node.from, to: node.to })
      ranges.push(Decoration.replace({ widget: new LiveMediaWidget(node.from, node.to, state.doc.lineAt(node.from).number, state.doc.sliceString(node.from, node.to), 'image', options) }).range(node.from, node.to))
      return false
    }
  } })
  for (const block of blocks) {
    if (isEditing(block.from, block.to)) {
      for (let line = block.firstLine; line <= block.lastLine; line++) ranges.push(Decoration.line({ class: 'cm-live-edit-block' }).range(state.doc.line(line).from))
    } else ranges.push(Decoration.replace({ widget: block.kind === 'table' ? new LiveTableWidget(block, options) : new LiveBlockWidget(block, options), block: true }).range(block.from, block.to))
  }
  for (const span of inlinePreviewSpans(state, [...excluded, ...mediaRanges, ...codeBlocks, ...(editing ? [editing] : [])])) {
    if (span.line) ranges.push(Decoration.line({ class: span.className }).range(span.from))
    else if (span.hidden && span.to > span.from) ranges.push(Decoration.replace({}).range(span.from, span.to))
    else if (span.className && span.to > span.from) ranges.push(Decoration.mark({ class: span.className, ...(span.href && isSafeLink(span.href) ? { attributes: { 'data-href': span.href } } : {}) }).range(span.from, span.to))
  }
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if ([...excluded, ...codeBlocks].some((block) => line.from >= block.from && line.from <= block.to)) continue
    ranges.push(Decoration.line({ attributes: { 'data-source-line': String(number), 'data-source-end': String(number) } }).range(line.from))
    if (isEditing(line.from, line.to)) {
      ranges.push(Decoration.line({ class: 'cm-live-edit-line' }).range(line.from))
      continue
    }
    const task = line.text.match(/^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/)
    if (task) ranges.push(Decoration.replace({ widget: new TaskWidget(line.from + task[1].length, task[2] !== ' ', options.readOnly) }).range(line.from + task[1].length, line.from + task[1].length + 3))
    for (const match of line.text.matchAll(/(?<!\\)\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?!\$)/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (isEditing(from, to) || mediaRanges.some((range) => from >= range.from && to <= range.to) || /\d/.test(line.text[match.index + match[0].length] || '')) continue
      let node = syntaxTree(state).resolveInner(from, 1)
      let inCode = false
      while (node.parent) { if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') inCode = true; node = node.parent }
      if (!inCode) ranges.push(Decoration.replace({ widget: new LiveMediaWidget(from, to, number, match[0], 'math', options) }).range(from, to))
    }
    if (options.focusMode && state.doc.lineAt(state.selection.main.head).number !== number) ranges.push(Decoration.line({ class: 'cm-focus-muted' }).range(line.from))
  }
  return Decoration.set(ranges, true)
}

export function hybridExtension(options: HybridOptions): Extension {
  const previews = StateField.define<DecorationSet>({
    create: (state) => decorations(state, options),
    update: (value, transaction) => transaction.docChanged || transaction.selection || transaction.effects.some((effect) => effect.is(editLiveBlock)) ? decorations(transaction.state, options) : value,
    provide: (field) => EditorView.decorations.from(field),
  })
  return [liveEditingBlock, liveCodeExtension(), previews, resourceFitExtension, liveSourceEditExtension, EditorView.domEventHandlers({
    mousedown: (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-live-link[data-href]') : null
      if (!link || !(event.ctrlKey || event.metaKey)) return false
      event.preventDefault(); options.onLinkOpen(link.dataset.href!); return true
    },
    keydown: (event, view) => {
      if (event.key !== 'Escape' || !view.state.field(liveEditingBlock, false)) return false
      view.dispatch({ effects: editLiveBlock.of(null) }); return true
    },
  })]
}
