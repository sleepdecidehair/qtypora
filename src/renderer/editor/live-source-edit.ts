import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { editLiveBlock, liveBlocks } from './live-blocks'
import { sourceContextTarget } from './context-target'

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

// Capture also reaches widgets that intentionally ignore CodeMirror's text events.
export const liveSourceEditExtension = ViewPlugin.fromClass(class {
  private doubleClick = (event: MouseEvent): void => {
    const view = this.view
    const target = event.target instanceof Element ? event.target : null
    if (!target || view.state.readOnly || view.composing || event.ctrlKey || event.metaKey ||
        target.closest('button,input,select,textarea,.cm-live-edit-line,.cm-live-edit-block')) return
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
  constructor(readonly view: EditorView) { view.contentDOM.addEventListener('dblclick', this.doubleClick, true) }
  destroy(): void { this.view.contentDOM.removeEventListener('dblclick', this.doubleClick, true) }
})
