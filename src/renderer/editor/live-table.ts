import { EditorSelection } from '@codemirror/state'
import { undo, redo } from '@codemirror/commands'
import { EditorView, WidgetType } from '@codemirror/view'
import { hydratePreview, sanitizeMarkdownHtml } from './markdown'
import { escapeCellInput, parseTableSource, tableCellEdit, type TableCellSource, type TableSource } from './table-model'
import type { LiveBlock, LiveOptions } from './live-types'
import { fitEditorResources } from './resource-fit'

interface TableContext {
  block: LiveBlock
  options: LiveOptions
  model: TableSource
  activeCell: HTMLElement | null
  composing: boolean
  nativeEditing: boolean
}
const contexts = new WeakMap<HTMLElement, TableContext>()

function takeMathSources(container: HTMLElement): Map<HTMLElement, string> {
  const sources = new Map<HTMLElement, string>()
  for (const node of container.querySelectorAll<HTMLElement>('[data-math]')) { sources.set(node, node.textContent || ''); node.replaceChildren() }
  return sources
}

function hydrateCells(container: HTMLElement, sources: Map<HTMLElement, string>, options: LiveOptions, view: EditorView): void {
  void hydratePreview(container, { ...options, sourceText: (node) => sources.get(node) || '', errorMode: 'placeholder' }).then(() => { if (container.isConnected) { fitEditorResources(view); view.requestMeasure() } })
}

function cellSource(context: TableContext, element: HTMLElement): TableCellSource | undefined {
  return context.model.cells.find((cell) => cell.row === Number(element.dataset.row) && cell.column === Number(element.dataset.column))
}

function domOffset(cell: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection?.focusNode || !cell.contains(selection.focusNode)) return cell.textContent?.length || 0
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.setEnd(selection.focusNode, selection.focusOffset)
  return range.toString().length
}

function placeCaret(cell: HTMLElement, offset: number, select = false): void {
  const range = document.createRange()
  range.selectNodeContents(cell)
  if (!select) {
    const text = cell.firstChild
    if (text?.nodeType === Node.TEXT_NODE) range.setStart(text, Math.min(text.textContent?.length || 0, Math.max(0, offset)))
    range.collapse(true)
  }
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function updateCellSelection(view: EditorView, context: TableContext, cell: HTMLElement): void {
  const source = cellSource(context, cell)
  if (!source) return
  const selection = window.getSelection()
  const selectedText = selection?.toString() || ''
  const end = Math.min(source.to, source.from + escapeCellInput((cell.textContent || '').slice(0, domOffset(cell))).length)
  const from = Math.max(source.from, end - escapeCellInput(selectedText).length)
  view.dispatch({ selection: EditorSelection.range(from, end), userEvent: 'select.table' })
}

function commitCell(view: EditorView, context: TableContext, cell: HTMLElement): void {
  if (context.composing || context.options.readOnly || view.state.readOnly) return
  const source = cellSource(context, cell)
  if (!source) return
  const content = cell.textContent || ''
  const caret = escapeCellInput(content.slice(0, domOffset(cell))).length
  const edit = tableCellEdit(source, content)
  if (!edit) return
  context.nativeEditing = true
  try {
    view.dispatch({ changes: edit, selection: EditorSelection.cursor(edit.from + Math.min(edit.insert.length, caret)), userEvent: 'input.table' })
  } finally { context.nativeEditing = false }
}

function applyCellAttributes(container: HTMLElement, context: TableContext): void {
  container.dataset.sourceFrom = String(context.block.from)
  container.dataset.sourceLine = String(context.block.firstLine)
  container.dataset.sourceEnd = String(context.block.lastLine)
  const rows = Array.from(container.querySelectorAll('tr'))
  rows.forEach((row, rowIndex) => Array.from(row.querySelectorAll<HTMLElement>('th,td')).forEach((element, column) => {
    element.dataset.row = String(rowIndex)
    element.dataset.column = String(column)
    const source = cellSource(context, element)
    element.contentEditable = String(Boolean(source) && !context.options.readOnly)
    element.spellcheck = false
    element.setAttribute('aria-label', `表格第 ${rowIndex + 1} 行第 ${column + 1} 列`)
    if (source) {
      element.dataset.sourceFrom = String(source.from)
      element.dataset.sourceTo = String(source.to)
      element.dataset.sourceLine = String(source.line)
      element.dataset.sourceEnd = String(source.line)
    }
  }))
}

export function selectLiveTableCell(view: EditorView): boolean {
  const active = view.dom.ownerDocument.activeElement
  const cell = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-testid="live-table"] th,[data-testid="live-table"] td') : null
  if (!cell) return false
  const container = cell.closest<HTMLElement>('[data-testid="live-table"]')!
  const context = contexts.get(container)
  const source = context && cellSource(context, cell)
  if (!context || !source) return false
  view.dispatch({ selection: EditorSelection.range(source.from, source.to), userEvent: 'select.table' })
  placeCaret(cell, 0, true)
  return true
}

export function focusLiveTableSelection(view: EditorView): boolean {
  const selection = view.state.selection.main
  const cell = Array.from(view.dom.querySelectorAll<HTMLElement>('[data-testid="live-table"] th[contenteditable=true],[data-testid="live-table"] td[contenteditable=true]')).find((element) => Number(element.dataset.sourceFrom) <= selection.from && Number(element.dataset.sourceTo) >= selection.to)
  if (!cell) return false
  const container = cell.closest<HTMLElement>('[data-testid="live-table"]')!
  const context = contexts.get(container)
  const source = context && cellSource(context, cell)
  if (!source) return false
  cell.focus()
  placeCaret(cell, selection.head - source.from)
  return true
}

export class LiveTableWidget extends WidgetType {
  constructor(readonly block: LiveBlock, readonly options: LiveOptions) { super() }

  eq(other: LiveTableWidget): boolean {
    return this.block.from === other.block.from && this.block.source === other.block.source && this.options.theme === other.options.theme && this.options.readOnly === other.options.readOnly
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'md-preview-block cm-live-table'
    container.dataset.testid = 'live-table'
    container.innerHTML = sanitizeMarkdownHtml(this.block.html)
    for (const cell of container.querySelectorAll<HTMLElement>('th,td')) cell.dataset.lastMarkup = cell.innerHTML
    const sources = takeMathSources(container)
    const context: TableContext = { block: this.block, options: this.options, model: parseTableSource(this.block.source, this.block.from, this.block.firstLine), activeCell: null, composing: false, nativeEditing: false }
    contexts.set(container, context)
    applyCellAttributes(container, context)
    container.addEventListener('focusin', (event) => {
      const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('th,td') : null
      if (!cell || cell.contentEditable !== 'true') return
      const source = cellSource(context, cell)
      if (!source) return
      context.activeCell = cell
      cell.textContent = source.content
      cell.classList.add('cm-live-cell-active')
      const offset = Math.max(0, Math.min(source.content.length, view.state.selection.main.head - source.from))
      placeCaret(cell, offset)
      updateCellSelection(view, context, cell)
    })
    container.addEventListener('focusout', () => {
      if (context.composing) return
      const active = context.activeCell
      if (active) commitCell(view, context, active)
      if (active) delete active.dataset.lastMarkup
      context.activeCell = null
      this.refreshCells(container, context, view)
    })
    container.addEventListener('input', (event) => { if (event.target instanceof HTMLElement) commitCell(view, context, event.target.closest<HTMLElement>('th,td') || event.target) })
    container.addEventListener('compositionstart', () => { context.composing = true })
    container.addEventListener('compositionend', () => {
      context.composing = false
      if (context.activeCell) commitCell(view, context, context.activeCell)
      if (context.activeCell && document.activeElement !== context.activeCell) {
        delete context.activeCell.dataset.lastMarkup
        context.activeCell = null
        this.refreshCells(container, context, view)
      }
    })
    container.addEventListener('paste', (event) => {
      if (!context.activeCell || context.options.readOnly || view.state.readOnly) return
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') || ''
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (!range || !context.activeCell.contains(range.commonAncestorContainer)) return
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node); range.setStartAfter(node); range.collapse(true)
      selection?.removeAllRanges(); selection?.addRange(range)
      commitCell(view, context, context.activeCell)
    })
    container.addEventListener('keyup', () => { if (context.activeCell && !context.composing) updateCellSelection(view, context, context.activeCell) })
    container.addEventListener('mouseup', () => { if (context.activeCell && !context.composing) updateCellSelection(view, context, context.activeCell) })
    container.addEventListener('keydown', (event) => {
      if (!context.activeCell || context.composing) return
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation()
        if (event.key.toLowerCase() === 'y' || event.shiftKey) redo(view); else undo(view)
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation()
        const cells = Array.from(container.querySelectorAll<HTMLElement>('th[contenteditable=true],td[contenteditable=true]'))
        const next = cells[cells.indexOf(context.activeCell) + (event.shiftKey ? -1 : 1)]
        next?.focus()
      }
      if (event.key === 'Escape') { event.preventDefault(); view.focus() }
    })
    hydrateCells(container, sources, this.options, view)
    return container
  }

  private refreshCells(container: HTMLElement, context: TableContext, view: EditorView): void {
    const staging = document.createElement('div')
    staging.innerHTML = sanitizeMarkdownHtml(context.block.html)
    const freshCells = Array.from(staging.querySelectorAll<HTMLElement>('th,td'))
    const cells = Array.from(container.querySelectorAll<HTMLElement>('th,td'))
    cells.forEach((cell, index) => {
      const source = cellSource(context, cell)
      if (cell === context.activeCell) {
        if (source && !context.nativeEditing && !context.composing && cell.textContent !== source.content) {
          cell.textContent = source.content
          placeCaret(cell, view.state.selection.main.head - source.from)
        }
      } else if (freshCells[index] && cell.dataset.lastMarkup !== freshCells[index].innerHTML) {
        const markup = freshCells[index].innerHTML
        const sources = takeMathSources(freshCells[index])
        cell.classList.remove('cm-live-cell-active')
        cell.replaceChildren(...Array.from(freshCells[index].childNodes))
        cell.dataset.lastMarkup = markup
        hydrateCells(cell, sources, context.options, view)
      } else {
        cell.classList.remove('cm-live-cell-active')
      }
    })
  }

  updateDOM(container: HTMLElement, view: EditorView): boolean {
    const context = contexts.get(container)
    if (!context) return false
    const model = parseTableSource(this.block.source, this.block.from, this.block.firstLine)
    if (model.rows !== context.model.rows || model.columns !== context.model.columns) return false
    context.block = this.block; context.options = this.options; context.model = model
    applyCellAttributes(container, context)
    this.refreshCells(container, context, view)
    return true
  }

  ignoreEvent(): boolean { return true }
}
