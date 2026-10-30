import { EditorSelection } from '@codemirror/state'
import { undo, redo, isolateHistory } from '@codemirror/commands'
import { EditorView, WidgetType } from '@codemirror/view'
import { hydratePreview, sanitizeMarkdownHtml } from './markdown'
import { escapeCellInput, missingTableCellSource, parseTableSource, tableCellEdit, type TableCellSource, type TableSource } from './table-model'
import type { LiveBlock, LiveOptions } from './live-types'
import { fitEditorResources } from './resource-fit'
import { tableRangeSelection } from './table-range-selection'
import { clearTableRange, copyTableRange, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, moveTableColumn, moveTableRow, pasteTableCells, resizeTable, tableOperation, tableRangeContains, type SourcePatch, type TableRange } from './table-operations'
import { editorText } from './editor-i18n'
import { resolveTableFocusSelection, type TableFocusState } from './table-focus-state'

interface TableContext {
  block: LiveBlock
  options: LiveOptions
  model: TableSource
  activeCell: HTMLElement | null
  composing: boolean
  nativeEditing: boolean
  cursor: { row: number; column: number }
  range: TableRange | null
  stopRangeSelection: () => void
  skipMouseupSelection: boolean
}
const contexts = new WeakMap<HTMLElement, TableContext>()

export type LiveTableFocusSnapshot = TableFocusState

/** Capture the native cell selection before blur commits the cell. */
export function captureLiveTableFocus(view: EditorView): LiveTableFocusSnapshot | null {
  const active = view.dom.ownerDocument.activeElement
  if (!(active instanceof HTMLElement) || !active.matches('[data-testid="live-table"] th[contenteditable=true],[data-testid="live-table"] td[contenteditable=true]')) return null
  const selection = view.dom.ownerDocument.getSelection()
  if (!selection?.anchorNode || !selection.focusNode || !active.contains(selection.anchorNode) || !active.contains(selection.focusNode)) return null
  const table = active.closest<HTMLElement>('[data-testid="live-table"]')
  const tableFrom = Number(table?.dataset.sourceFrom), row = Number(active.dataset.row), column = Number(active.dataset.column)
  if (!table || !Number.isInteger(tableFrom) || !Number.isInteger(row) || !Number.isInteger(column)) return null
  const offset = (node: Node, at: number) => {
    const range = view.dom.ownerDocument.createRange()
    range.selectNodeContents(active)
    range.setEnd(node, at)
    return range.toString().length
  }
  return { source: view.state.doc, tableFrom, row, column, anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) }
}

export interface LiveTableImageTarget {
  range: { from: number; to: number }
  isCurrent: () => boolean
  virtualCell?: { tableFrom: number; tableTo: number; row: number; column: number; prefix: string }
}

/** Resolve only a focused, single native cell selection with unchanged source. */
export function captureLiveTableImageTarget(view: EditorView, cell: HTMLElement): LiveTableImageTarget | null {
  const container = cell.closest<HTMLElement>('[data-testid="live-table"]')
  const context = container && contexts.get(container)
  const source = context && cellSource(context, cell), snapshot = captureLiveTableFocus(view)
  if (!context || context.activeCell !== cell || !source || context.composing || context.range || !snapshot || cell.textContent !== source.content || snapshot.anchor > source.content.length || snapshot.focus > source.content.length || (source.missingPrefix !== undefined && (snapshot.anchor !== 0 || snapshot.focus !== 0))) return null
  const range = { from: source.from + Math.min(snapshot.anchor, snapshot.focus), to: source.from + Math.max(snapshot.anchor, snapshot.focus) }
  const isCurrent = () => {
    const now = captureLiveTableFocus(view)
    return !context.composing && !context.range && context.activeCell === cell && cell.textContent === source.content && Boolean(now && now.source.eq(snapshot.source) && now.tableFrom === snapshot.tableFrom && now.row === snapshot.row && now.column === snapshot.column && now.anchor === snapshot.anchor && now.focus === snapshot.focus)
  }
  const virtualCell = source.missingPrefix === undefined ? undefined : { tableFrom: context.block.from, tableTo: context.block.to, row: source.row, column: source.column, prefix: source.missingPrefix }
  return { range, isCurrent, ...(virtualCell ? { virtualCell } : {}) }
}

export function restoreLiveTableFocus(view: EditorView, snapshot: LiveTableFocusSnapshot): boolean {
  if (!snapshot.source.eq(view.state.doc)) return false
  const table = Array.from(view.dom.querySelectorAll<HTMLElement>('[data-testid="live-table"]')).find(element => Number(element.dataset.sourceFrom) === snapshot.tableFrom)
  const cell = table && Array.from(table.querySelectorAll<HTMLElement>('th[contenteditable=true],td[contenteditable=true]')).find(element => Number(element.dataset.row) === snapshot.row && Number(element.dataset.column) === snapshot.column)
  if (!cell) return false
  cell.focus()
  const text = cell.firstChild?.nodeType === Node.TEXT_NODE ? cell.firstChild : null
  const offsets = resolveTableFocusSelection(snapshot, view.state.doc, text ? (text.textContent?.length ?? 0) : null)
  if (!offsets) return false
  const selection = view.dom.ownerDocument.getSelection()
  if (!selection) return false
  const target = offsets.target === 'text' ? text : cell
  if (!target) return false
  selection.setBaseAndExtent(target, offsets.anchor, target, offsets.focus)
  return true
}

/** Commit native cell editing before a document is frozen for closing. */
export function prepareLiveTablesForClose(view: EditorView): boolean {
  const tables = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-live-table'))
  if (tables.some(table => contexts.get(table)?.composing)) return false
  for (const table of tables) {
    const context = contexts.get(table)
    if (!context?.activeCell) continue
    const active = context.activeCell
    commitCell(view, context, active)
    if (document.activeElement === active) active.blur()
  }
  return true
}

function takeMathSources(container: HTMLElement): Map<HTMLElement, string> {
  const sources = new Map<HTMLElement, string>()
  for (const node of container.querySelectorAll<HTMLElement>('[data-math]')) { sources.set(node, node.textContent || ''); node.replaceChildren() }
  return sources
}

function hydrateCells(container: HTMLElement, sources: Map<HTMLElement, string>, options: LiveOptions, view: EditorView): void {
  void hydratePreview(container, { ...options, sourceText: (node) => sources.get(node) || '', errorMode: 'placeholder' }).then(() => { if (container.isConnected) { fitEditorResources(view); view.requestMeasure() } })
}

function cellSource(context: TableContext, element: HTMLElement): TableCellSource | undefined {
  const row = Number(element.dataset.row), column = Number(element.dataset.column)
  return context.model.cells.find((cell) => cell.row === row && cell.column === column)
    ?? missingTableCellSource(context.block.source, context.model, row, column, context.block.from, context.block.firstLine)
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
    view.dispatch({ changes: edit, selection: EditorSelection.cursor(edit.from + (source.missingPrefix?.length ?? 0) + Math.min(escapeCellInput(content).length, caret)), userEvent: 'input.table' })
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
    element.setAttribute('aria-label', editorText(context.options.locale, '表格第 {row} 行第 {column} 列', { row: rowIndex + 1, column: column + 1 }))
    element.classList.toggle('cm-table-cell-selected', Boolean(context.range && tableRangeContains(context.range, rowIndex, column)))
    if (context.range) element.setAttribute('aria-selected', String(tableRangeContains(context.range, rowIndex, column)))
    else element.removeAttribute('aria-selected')
    if (source) {
      element.dataset.sourceFrom = String(source.from)
      element.dataset.sourceTo = String(source.to)
      element.dataset.sourceLine = String(source.line)
      element.dataset.sourceEnd = String(source.line)
    }
  }))
}

function applyStructure(view: EditorView, container: HTMLElement, context: TableContext, operation: () => SourcePatch | SourcePatch[] | null, target = context.cursor): void {
  if (view.state.readOnly || context.options.readOnly || context.composing) return
  if (context.activeCell) commitCell(view, context, context.activeCell)
  if (view.state.doc.sliceString(context.block.from, context.block.to) !== context.block.source) return
  const changes = operation()
  if (!changes || (Array.isArray(changes) && !changes.length)) return
  const originalFrom = context.block.from
  const transaction = view.state.update({ changes, userEvent: 'input.table.structure', annotations: isolateHistory.of('full') })
  const from = transaction.changes.mapPos(originalFrom, -1)
  const to = transaction.changes.mapPos(context.block.to, 1)
  const model = parseTableSource(transaction.newDoc.sliceString(from, to), from)
  const row = Math.max(0, Math.min(model.rows - 1, target.row))
  const column = Math.max(0, Math.min(model.columns - 1, target.column))
  const cell = model.cells.find(value => value.row === row && value.column === column)
  context.range = null
  view.dispatch({ changes, selection: EditorSelection.cursor(cell?.from ?? from), userEvent: 'input.table.structure', annotations: isolateHistory.of('full') })
  const updated = view.state.doc
  const focusTarget = (): boolean => {
    if (!view.dom.isConnected || view.state.doc !== updated) return true
    const next = Array.from(view.dom.querySelectorAll<HTMLElement>('[data-testid="live-table"]')).find(element => Number(element.dataset.sourceFrom) === from)
    const targetCell = next?.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`)
    if (!targetCell) return false
    targetCell.focus()
    view.requestMeasure()
    return true
  }
  if (!focusTarget()) requestAnimationFrame(focusTarget)
  container.querySelector<HTMLElement>('.cm-table-controls [role=status]')?.replaceChildren()
}

function tableControls(view: EditorView, container: HTMLElement, context: TableContext): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'cm-table-controls'
  controls.contentEditable = 'false'
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', editorText(context.options.locale, '表格工具'))
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  const sizeInput = (name: string, value: number, min: number, max: number) => {
    const label = document.createElement('label')
    label.textContent = editorText(context.options.locale, name)
    const input = document.createElement('input')
    input.type = 'number'; input.min = String(min); input.max = String(max); input.value = String(value)
    input.setAttribute('aria-label', editorText(context.options.locale, name))
    input.addEventListener('keydown', event => { event.stopPropagation() })
    label.append(input); controls.append(label)
    return input
  }
  const rows = sizeInput('行数（含表头）', context.model.rows, 2, MAX_TABLE_ROWS)
  const columns = sizeInput('列数', context.model.columns, 1, MAX_TABLE_COLUMNS)
  const button = (label: string, action: () => void) => {
    const element = document.createElement('button')
    element.type = 'button'; element.textContent = editorText(context.options.locale, label); element.setAttribute('aria-label', editorText(context.options.locale, label))
    element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action() })
    controls.append(element)
    return element
  }
  button('调整尺寸', () => {
    const countRows = Number(rows.value), countColumns = Number(columns.value)
    if (!Number.isInteger(countRows) || !Number.isInteger(countColumns) || countRows < 2 || countRows > MAX_TABLE_ROWS || countColumns < 1 || countColumns > MAX_TABLE_COLUMNS) { status.textContent = editorText(context.options.locale, '表格需为 2–{rows} 行、1–{columns} 列。', { rows: MAX_TABLE_ROWS, columns: MAX_TABLE_COLUMNS }); return }
    applyStructure(view, container, context, () => resizeTable(context.block.source, context.block.from, countRows, countColumns))
  }).title = editorText(context.options.locale, '缩小尺寸会删除超出范围的单元格，可撤销')
  button('上移行', () => applyStructure(view, container, context, () => moveTableRow(context.block.source, context.block.from, context.cursor.row, context.cursor.row - 1), { ...context.cursor, row: context.cursor.row - 1 }))
  button('下移行', () => applyStructure(view, container, context, () => moveTableRow(context.block.source, context.block.from, context.cursor.row, context.cursor.row + 1), { ...context.cursor, row: context.cursor.row + 1 }))
  button('左移列', () => applyStructure(view, container, context, () => moveTableColumn(context.block.source, context.block.from, context.cursor.column, context.cursor.column - 1), { ...context.cursor, column: context.cursor.column - 1 }))
  button('右移列', () => applyStructure(view, container, context, () => moveTableColumn(context.block.source, context.block.from, context.cursor.column, context.cursor.column + 1), { ...context.cursor, column: context.cursor.column + 1 }))
  button('清空选区', () => {
    if (context.range) applyStructure(view, container, context, () => context.range && clearTableRange(context.block.source, context.block.from, context.range))
  })
  const hint = document.createElement('small')
  hint.textContent = editorText(context.options.locale, 'Alt+拖动或 Shift+点击选择多格；拖动行/列序号排序')
  controls.append(hint, status)
  return controls
}

function tableDragHandles(view: EditorView, container: HTMLElement, context: TableContext): HTMLElement {
  const handles = document.createElement('div')
  handles.className = 'cm-table-drag-handles'; handles.contentEditable = 'false'
  let drag: { kind: 'row' | 'column'; index: number } | null = null
  for (const kind of ['row', 'column'] as const) {
    const group = document.createElement('div')
    group.className = 'cm-table-handle-group'
    const title = document.createElement('span'); title.textContent = editorText(context.options.locale, kind === 'row' ? '行' : '列'); group.append(title)
    const count = kind === 'row' ? context.model.rows : context.model.columns
    for (let index = kind === 'row' ? 1 : 0; index < count; index++) {
      const handle = document.createElement('button')
      handle.type = 'button'; handle.draggable = true; handle.textContent = String(index + 1)
      handle.setAttribute('aria-label', editorText(context.options.locale, kind === 'row' ? '移动第 {index} 行' : '移动第 {index} 列', { index: index + 1 }))
      handle.addEventListener('dragstart', event => {
        drag = { kind, index }; event.stopPropagation()
        event.dataTransfer?.setData('text/plain', '')
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      })
      handle.addEventListener('dragover', event => { if (drag?.kind === kind) { event.preventDefault(); event.stopPropagation() } })
      handle.addEventListener('drop', event => {
        if (!drag || drag.kind !== kind) return
        event.preventDefault(); event.stopPropagation()
        const from = drag.index; drag = null
        applyStructure(view, container, context, () => kind === 'row' ? moveTableRow(context.block.source, context.block.from, from, index) : moveTableColumn(context.block.source, context.block.from, from, index), kind === 'row' ? { row: index, column: context.cursor.column } : { row: context.cursor.row, column: index })
      })
      handle.addEventListener('dragend', () => { drag = null })
      handle.addEventListener('click', () => {
        context.range = kind === 'row' ? { fromRow: index, toRow: index, fromColumn: 0, toColumn: context.model.columns - 1 } : { fromRow: 0, toRow: context.model.rows - 1, fromColumn: index, toColumn: index }
        context.cursor = kind === 'row' ? { row: index, column: 0 } : { row: 0, column: index }
        applyCellAttributes(container, context)
      })
      group.append(handle)
    }
    handles.append(group)
  }
  return handles
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
    return this.block.from === other.block.from && this.block.source === other.block.source && this.options.theme === other.options.theme && this.options.readOnly === other.options.readOnly && this.options.mathKey === other.options.mathKey && this.options.locale === other.options.locale
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'md-preview-block cm-live-table'
    container.dataset.testid = 'live-table'
    container.innerHTML = sanitizeMarkdownHtml(this.block.html, this.options.locale)
    for (const cell of container.querySelectorAll<HTMLElement>('th,td')) cell.dataset.lastMarkup = cell.innerHTML
    const sources = takeMathSources(container)
    const context: TableContext = { block: this.block, options: this.options, model: parseTableSource(this.block.source, this.block.from, this.block.firstLine), activeCell: null, composing: false, nativeEditing: false, cursor: { row: 1, column: 0 }, range: null, stopRangeSelection: () => undefined, skipMouseupSelection: false }
    contexts.set(container, context)
    applyCellAttributes(container, context)
    if (!context.options.readOnly) {
      const tools = document.createElement('details')
      tools.className = 'cm-table-tools'
      tools.contentEditable = 'false'
      const summary = document.createElement('summary')
      summary.textContent = editorText(context.options.locale, '表格工具')
      tools.append(summary, tableControls(view, container, context), tableDragHandles(view, container, context))
      tools.addEventListener('toggle', () => { view.requestMeasure() })
      container.append(tools)
    }
    context.stopRangeSelection = tableRangeSelection(container, {
      canSelect: () => !context.options.readOnly && !view.state.readOnly && !context.composing,
      start: cell => { context.skipMouseupSelection = true; cell.focus({ preventScroll: true }) },
      select: (from, to) => {
        context.cursor = from
        context.range = { fromRow: from.row, fromColumn: from.column, toRow: to.row, toColumn: to.column }
        applyCellAttributes(container, context)
      },
    })
    container.addEventListener('mousedown', event => {
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('th,td') : null
      if (!cell || context.options.readOnly || context.composing || event.altKey) return
      context.skipMouseupSelection = false
      const row = Number(cell.dataset.row), column = Number(cell.dataset.column)
      if (event.shiftKey) {
        event.preventDefault()
        context.range = { fromRow: context.range?.fromRow ?? context.cursor.row, fromColumn: context.range?.fromColumn ?? context.cursor.column, toRow: row, toColumn: column }
        applyCellAttributes(container, context)
      } else { context.range = null; context.cursor = { row, column }; applyCellAttributes(container, context) }
    })
    container.addEventListener('copy', event => {
      if (!context.range) return
      event.preventDefault(); event.stopPropagation()
      event.clipboardData?.setData('text/plain', copyTableRange(context.block.source, context.range))
    })
    container.addEventListener('focusin', (event) => {
      const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('th,td') : null
      if (!cell || cell.contentEditable !== 'true') return
      const source = cellSource(context, cell)
      if (!source) return
      context.activeCell = cell
      context.cursor = { row: source.row, column: source.column }
      cell.textContent = source.content
      cell.classList.add('cm-live-cell-active')
      const offset = Math.max(0, Math.min(source.content.length, view.state.selection.main.head - source.from))
      placeCaret(cell, offset)
      // Mouseup/keyup synchronize the selection after the native caret settles.
      // Updating it during focus can collapse a preceding heading's source view
      // and move a different cell under the still-pressed pointer.
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
      if (!text && event.clipboardData?.files.length) {
        event.stopPropagation()
        const target = captureLiveTableImageTarget(view, context.activeCell)
        if (!target || !context.options.onTableImagePaste) {
          context.options.onError?.('无法安全粘贴图片到此表格选区，请使用插入图片。')
          return
        }
        context.options.onTableImagePaste(view, Array.from(event.clipboardData.files), target.range, target.isCurrent, target.virtualCell)
        return
      }
      if (!text) {
        event.stopPropagation()
        const html = event.clipboardData?.getData('text/html') || ''
        if (html) {
          const target = captureLiveTableImageTarget(view, context.activeCell)
          if (target && context.options.onTableHtmlPaste) context.options.onTableHtmlPaste(view, html, target)
          else context.options.onError?.('无法安全粘贴 HTML 到此表格选区。')
          return
        }
        context.options.onError?.('剪贴板没有可粘贴到表格的文本，原内容已保留。')
        return
      }
      if (text.includes('\t') || context.range) {
        const row = context.range ? Math.min(context.range.fromRow, context.range.toRow) : context.cursor.row
        const column = context.range ? Math.min(context.range.fromColumn, context.range.toColumn) : context.cursor.column
        applyStructure(view, container, context, () => pasteTableCells(context.block.source, context.block.from, row, column, text), { row, column })
        return
      }
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
    container.addEventListener('mouseup', () => {
      if (context.skipMouseupSelection) { context.skipMouseupSelection = false; return }
      if (context.activeCell && !context.composing) updateCellSelection(view, context, context.activeCell)
    })
    container.addEventListener('keydown', (event) => {
      if (!context.activeCell || context.composing) return
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation()
        if (event.key.toLowerCase() === 'y' || event.shiftKey) redo(view); else undo(view)
        if (!focusLiveTableSelection(view)) view.focus()
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && context.model.rows < MAX_TABLE_ROWS) {
          const row = context.cursor.row
          applyStructure(view, container, context, () => tableOperation(context.block.source, context.block.from, row, context.cursor.column, 'table-row-after'), { row: row + 1, column: 0 })
          return
        }
        const cells = Array.from(container.querySelectorAll<HTMLElement>('th[contenteditable=true],td[contenteditable=true]'))
        const next = cells[cells.indexOf(context.activeCell) + (event.shiftKey ? -1 : 1)]
        if (next) next.focus()
        else if (event.key === 'Tab' && !event.shiftKey && context.model.rows < MAX_TABLE_ROWS) applyStructure(view, container, context, () => tableOperation(context.block.source, context.block.from, context.model.rows - 1, context.model.columns - 1, 'table-row-after'), { row: context.model.rows, column: 0 })
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && context.range) {
        event.preventDefault(); event.stopPropagation()
        applyStructure(view, container, context, () => context.range && clearTableRange(context.block.source, context.block.from, context.range))
      }
      if (event.key === 'Escape') { event.preventDefault(); view.focus() }
    })
    hydrateCells(container, sources, this.options, view)
    return container
  }

  private refreshCells(container: HTMLElement, context: TableContext, view: EditorView): void {
    const staging = document.createElement('div')
    staging.innerHTML = sanitizeMarkdownHtml(context.block.html, context.options.locale)
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
    if (context.options.readOnly !== this.options.readOnly || context.options.mathKey !== this.options.mathKey || context.options.locale !== this.options.locale) return false
    const model = parseTableSource(this.block.source, this.block.from, this.block.firstLine)
    if (model.rows !== context.model.rows || model.columns !== context.model.columns) return false
    context.block = this.block; context.options = this.options; context.model = model
    applyCellAttributes(container, context)
    this.refreshCells(container, context, view)
    return true
  }

  ignoreEvent(): boolean { return true }

  destroy(container: HTMLElement): void { contexts.get(container)?.stopRangeSelection() }
}
