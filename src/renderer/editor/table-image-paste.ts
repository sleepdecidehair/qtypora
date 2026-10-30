import { isolateHistory } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import type { MarkdownEditorProps } from './types'
import { readClipboardImages } from './clipboard-import'
import { emptyTableCellIdentity, hasCompleteTable, imageInsertionContext } from './image-insertion-context'
import { escapeTableCellInput } from '../../shared/table-cell-input'
import { fitsPasteBudget } from './paste-budget'
import { focusLiveTableSelection } from './live-table'

export async function pasteTableImages(view: EditorView, getProps: () => MarkdownEditorProps, files: File[], range: { from: number; to: number }, isCurrent: () => boolean, virtualCell?: { tableFrom: number; tableTo: number; row: number; column: number; prefix: string }): Promise<void> {
  const props = getProps(), doc = view.state.doc
  const finish = props.closeCoordinator.start()
  if (!finish) throw new Error('文档正在关闭，操作未执行。')
  try {
    const unchanged = () => {
      const current = getProps()
      return view.dom.isConnected && current.documentId === props.documentId && current.revision === props.revision && current.mode === props.mode && current.encoding === props.encoding && current.lineEnding === props.lineEnding && current.imageOptions.uploadOnInsert === props.imageOptions.uploadOnInsert && !current.readOnly && !view.state.readOnly && !view.composing && !view.compositionStarted && view.state.doc.eq(doc) && isCurrent()
    }
    const requireCurrent = () => { if (!unchanged()) throw new Error('文档或表格选区已变化，未粘贴图片。') }
    const images = await readClipboardImages(files)
    requireCurrent()
    const emptyCell = virtualCell ? null : emptyTableCellIdentity(view.state, range)
    if (virtualCell ? !hasCompleteTable(view.state, virtualCell.tableFrom, virtualCell.tableTo) : !emptyCell && imageInsertionContext(view.state, range) !== 'table') throw new Error('无法安全粘贴图片到此表格选区，请使用插入图片。')
    const identity = virtualCell && { tableFrom: virtualCell.tableFrom, tableTo: virtualCell.tableTo, row: virtualCell.row, column: virtualCell.column }
    const pasteBudget = !props.imageOptions.uploadOnInsert ? { ...range, table: true, ...(identity ? { virtualCell: identity } : {}), ...(emptyCell ? { emptyCell } : {}), encoding: props.encoding, lineEnding: props.lineEnding } : undefined
    const result = await props.desktopApi.importImages({ id: props.documentId, revision: props.revision, content: doc.toString(), images, ...(pasteBudget ? { pasteBudget } : {}) })
    if (!result.ok) throw new Error(result.error.message)
    if (!result.data) return
    requireCurrent()
    const insert = (virtualCell?.prefix ?? '') + escapeTableCellInput(result.data.markdown) + (virtualCell ? ' |' : '')
    const changes = view.state.changes({ ...range, insert })
    if (!fitsPasteBudget(doc, changes.apply(doc), props.encoding, props.lineEnding)) throw new Error('粘贴后的文件将超过 16 MB，未执行粘贴。')
    view.dispatch({ changes, selection: { anchor: changes.mapPos(range.from, 1) }, userEvent: 'input.paste', annotations: isolateHistory.of('full') })
    if (view.dom.ownerDocument.hasFocus()) focusLiveTableSelection(view)
  } finally { finish() }
}
