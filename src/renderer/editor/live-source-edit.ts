import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { editLiveBlock, liveBlocks } from './live-blocks'
import { sourceContextTarget } from './context-target'

// Newly typed headings render immediately; explicitly entering an existing heading reveals its source.
export const preserveHeadingPreview = StateEffect.define<number>({ map: (value, changes) => changes.mapPos(value, -1) })
export const headingInputPreview = StateField.define<number | null>({
  create: () => null,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(preserveHeadingPreview)) return transaction.state.doc.lineAt(effect.value).from
    if (!transaction.docChanged) return transaction.selection ? null : value
    if (!transaction.isUserEvent('input.type') && !transaction.isUserEvent('delete')) return null
    const position = transaction.state.selection.main.head
    const line = transaction.state.doc.lineAt(position)
    if (value !== null && transaction.changes.mapPos(value, -1) === line.from) return line.from
    const previous = transaction.startState.doc.lineAt(transaction.startState.selection.main.head)
    if (transaction.startState.selection.main.empty && /^ {0,3}#{0,6}$/.test(previous.text) && /^ {0,3}#{1,6}(?:[ \t].*)?$/.test(line.text)) return line.from
    return null
  },
})

// Keep the rendered coordinates stable from mouse-down through mouse-up.
export const previewPointer = StateEffect.define<boolean>()
export const previewPointerSelection = StateField.define<{ position: number | null; headingPreview: number | null } | null>({
  create: () => null,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (!effect.is(previewPointer)) continue
      if (!effect.value) return null
      const start = transaction.startState
      return { position: previewCursor(start), headingPreview: start.field(headingInputPreview, false) ?? null }
    }
    return transaction.docChanged ? null : value
  },
})

export function previewCursor(state: EditorState): number | null {
  const pointer = state.field(previewPointerSelection, false)
  if (pointer) return pointer.position
  return state.selection.main.empty ? state.selection.main.head : null
}

export function sourceEditRange(state: EditorState, position: number): { from: number; to: number } {
  const bounded = Math.max(0, Math.min(state.doc.length, position))
  const line = state.doc.lineAt(bounded)
  let node = syntaxTree(state).resolveInner(bounded, 1)
  while (node.parent) {
    if (/^(?:SetextHeading\d|FencedCode|CodeBlock)$/.test(node.name)) return { from: node.from, to: node.to }
    node = node.parent
  }
  return { from: line.from, to: line.to }
}

export function focusedHeadingEditRange(state: EditorState): { from: number; to: number } | null {
  const position = previewCursor(state)
  if (position === null) return null
  const pointer = state.field(previewPointerSelection, false)
  const headingPreview = pointer ? pointer.headingPreview : state.field(headingInputPreview, false)
  if (headingPreview === state.doc.lineAt(position).from) return null
  for (const side of [1, -1] as const) {
    let node = syntaxTree(state).resolveInner(position, side)
    for (;;) {
      if (/^(?:ATX|Setext)Heading\d$/.test(node.name)) return sourceEditRange(state, position)
      if (!node.parent) break
      node = node.parent
    }
  }
  return null
}

// Capture also reaches widgets that intentionally ignore CodeMirror's text events.
export const liveSourceEditExtension = ViewPlugin.fromClass(class {
  private readonly listeners = new AbortController()
  private startPointer = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    if (event.button !== 0 || event.metaKey || event.ctrlKey || this.view.state.readOnly || this.view.composing ||
        !target?.closest('.cm-line') || target.closest('button,input,select,textarea,.cm-live-footnote')) return
    this.view.dispatch({ effects: previewPointer.of(true) })
  }
  private finishPointer = (): void => {
    if (this.view.state.field(previewPointerSelection, false)) this.view.dispatch({ effects: previewPointer.of(false) })
  }
  private doubleClick = (event: MouseEvent): void => {
    const view = this.view
    const target = event.target instanceof Element ? event.target : null
    if (!target || view.state.readOnly || view.composing || event.ctrlKey || event.metaKey ||
        target.closest('button,input,select,textarea,.cm-live-edit-line,.cm-live-edit-block,.cm-live-code-body')) return
    const widget = target.closest<HTMLElement>('.cm-live-block,.cm-live-table,.cm-live-media')
    const line = target.closest<HTMLElement>('.cm-line')
    if (!widget && !line) return
    const position = widget ? Number(widget.dataset.sourceFrom) : view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (position === null || !Number.isFinite(position)) return
    let range = sourceEditRange(view.state, position)
    let anchor = position
    if (widget && !widget.classList.contains('cm-live-media')) {
      const block = liveBlocks(view.state).find(candidate => candidate.from === position)
      if (!block) return
      range = block
      const cell = target.closest<HTMLElement>('th,td')
      anchor = cell ? Number(cell.dataset.sourceFrom) : block.from
    } else if (widget) {
      range = sourceContextTarget(view.state, Math.min(view.state.doc.length, position + 1))
    }
    event.preventDefault()
    event.stopPropagation()
    view.dispatch({ effects: editLiveBlock.of({ from: range.from, to: range.to }), selection: { anchor: Math.max(range.from, Math.min(range.to, anchor)) }, scrollIntoView: true })
    view.focus()
  }
  constructor(readonly view: EditorView) {
    const signal = this.listeners.signal
    view.contentDOM.addEventListener('mousedown', this.startPointer, { capture: true, signal })
    view.contentDOM.addEventListener('dblclick', this.doubleClick, { capture: true, signal })
    const window = view.contentDOM.ownerDocument.defaultView
    window?.addEventListener('mouseup', this.finishPointer, { signal })
    window?.addEventListener('blur', this.finishPointer, { signal })
    window?.addEventListener('dragend', this.finishPointer, { signal })
  }
  destroy(): void { this.listeners.abort() }
})
