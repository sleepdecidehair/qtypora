import { isolateHistory } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import type { MarkdownEditorProps } from './types'
import { fitsPasteBudget } from './paste-budget'
import { escapeTableCellInput } from '../../shared/table-cell-input'
import { emptyTableCellIdentity, hasCompleteTable, imageInsertionContext } from './image-insertion-context'
import { focusLiveTableSelection } from './live-table'

/** Choose local files before writing them, and retain the editor's actual selection. */
export async function chooseAndInsertImages(view: EditorView, getProps: () => MarkdownEditorProps, target?: { from: number; to: number; isCurrent?: () => boolean; virtualCell?: { tableFrom: number; tableTo: number; row: number; column: number; prefix: string } }): Promise<void> {
  const props = getProps()
  if (props.readOnly || view.state.readOnly || props.mode === 'reading' || view.compositionStarted || view.composing) return
  const doc = view.state.doc, selection = view.state.selection, range = target ?? selection.main
  const owner = view.dom.ownerDocument, originalFocus = owner.activeElement
  const unchanged = () => {
    const current = getProps()
    return view.dom.isConnected && current.documentId === props.documentId && current.revision === props.revision && current.mode === props.mode && current.encoding === props.encoding && current.lineEnding === props.lineEnding && current.imageOptions.uploadOnInsert === props.imageOptions.uploadOnInsert && !current.readOnly && !view.state.readOnly && !view.composing && !view.compositionStarted && view.state.doc.eq(doc) && view.state.selection.eq(selection) && (!target?.isCurrent || target.isCurrent())
  }
  const requireCurrent = () => { if (!unchanged()) throw new Error('文档或选区已变化，未插入图片。请重新选择。') }
  requireCurrent()
  const selected = await props.desktopApi.chooseImages()
  if (!selected.ok) throw new Error(selected.error.message)
  if (!selected.data) return
  requireCurrent()
  const virtualCell = target?.virtualCell
  const emptyCell = virtualCell ? null : emptyTableCellIdentity(view.state, range)
  const targetContext = virtualCell ? (hasCompleteTable(view.state, virtualCell.tableFrom, virtualCell.tableTo) ? 'table' : null) : emptyCell ? 'table' : imageInsertionContext(view.state, range)
  if (!targetContext) throw new Error('无法安全插入图片，请调整选区后重试。')
  const identity = virtualCell && { tableFrom: virtualCell.tableFrom, tableTo: virtualCell.tableTo, row: virtualCell.row, column: virtualCell.column }
  const pasteBudget = !props.imageOptions.uploadOnInsert ? { from: range.from, to: range.to, table: targetContext === 'table', ...(identity ? { virtualCell: identity } : {}), ...(emptyCell ? { emptyCell } : {}), encoding: props.encoding, lineEnding: props.lineEnding } : undefined
  const result = await props.desktopApi.importImages({ id: props.documentId, revision: props.revision, content: doc.toString(), images: selected.data, ...(pasteBudget ? { pasteBudget } : {}) })
  if (!result.ok) throw new Error(result.error.message)
  if (!result.data) return
  requireCurrent()
  const insert = targetContext === 'table' ? (virtualCell?.prefix ?? '') + escapeTableCellInput(result.data.markdown) + (virtualCell ? ' |' : '') : result.data.markdown
  const changes = view.state.changes({ from: range.from, to: range.to, insert })
  if (!fitsPasteBudget(doc, changes.apply(doc), props.encoding, props.lineEnding)) throw new Error('插入后的文件将超过 16 MB，未插入图片。')
  const restoreFocus = owner.hasFocus() && (owner.activeElement === originalFocus || view.hasFocus)
  view.dispatch({ changes, selection: { anchor: changes.mapPos(range.from, 1) }, userEvent: 'input.format', annotations: isolateHistory.of('full') })
  if (restoreFocus && owner.hasFocus() && !(targetContext === 'table' && focusLiveTableSelection(view))) view.focus()
}
