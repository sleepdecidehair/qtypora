import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undoDepth, redoDepth, isolateHistory } from '@codemirror/commands'
import { indentRange } from '@codemirror/language'
import type { ClipboardContent, ContextMenuAction, ContextMenuRequest, Result } from '../../shared/contracts'
import type { EditorAction, MarkdownEditorProps } from './types'
import { sourceContextTarget, imageContextTarget, contextTargetUnchanged, contextObjectSource, isLocalResource, type ContextTarget } from './context-target'
import { tableOperation } from './table-operations'
import { parseTableSource, escapeCellInput } from './table-model'
import { editLiveBlock, liveEditingBlock } from './live-blocks'
import { renderMarkdown, isSafeLink } from './markdown'
import { mathMarkup, diagramSvg, rasterizeDiagram, type ViewedResource } from './context-resource'
import { focusLiveTableSelection } from './live-table'
import { markdownOptionsFacet } from './markdown-config'
import type { MarkdownOptions } from '../../shared/markdown-options'
import { chooseImageSize, currentImageSize, imageSizeEdit } from './image-size'
import { clipboardHtmlToMarkdown } from './clipboard-import'
import { validSpellingWord } from '../../shared/spelling'
import { richClipboardContent, richFragmentToRtf } from './rich-clipboard'

interface ContextSnapshot {
  documentId: string
  revision: number
  content: string
  target: ContextTarget
  selection: { from: number; to: number; text: string }
  spelling?: { from: number; to: number; word: string; suggestions: string[] }
}
type ApplyAction = (view: EditorView, action: EditorAction, value?: string) => boolean
const formatActions = ['bold', 'italic', 'strike', 'inline-code', 'clear-format', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'paragraph', 'quote', 'ordered-list', 'bullet-list', 'task-list', 'code', 'math', 'table', 'link'] as const

function resultValue<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function plainText(markdown: string, options: MarkdownOptions): string {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(markdown, options)
  return richFragmentToRtf(container).plain
}

async function apiSpelling(props: MarkdownEditorProps, word: string) {
  const result = await props.desktopApi.readSpelling(word)
  return result.ok ? result.data : null
}

export function contextMenuRequest(view: EditorView, target: ContextTarget, hasSelection: boolean, resourceReady = true): ContextMenuRequest {
  const actions: ContextMenuAction[] = ['copy', 'copy-markdown', 'copy-html', 'copy-plain', 'copy-without-theme', 'select-all']
  const readOnly = view.state.readOnly
  if (!readOnly) actions.push('undo', 'redo', 'cut', 'paste', 'paste-plain', ...formatActions, 'horizontal-rule', 'insert-image')
  if (target.kind === 'table') {
    const model = parseTableSource(target.source)
    actions.push('copy-table')
    if (!readOnly) {
      actions.push('table-row-before', 'table-row-after', 'table-column-before', 'table-column-after', 'table-align-left', 'table-align-center', 'table-align-right', 'table-delete')
      if ((target.row || 0) > 0 && model.rows > 2) actions.push('table-row-delete')
      if (model.columns > 1) actions.push('table-column-delete')
    }
  }
  if (target.kind === 'code') {
    actions.push('copy-code')
    if (!readOnly) {
      actions.push('edit-block')
      if (target.body && !indentRange(view.state, target.body.from, target.body.to).empty) actions.push('indent-code')
    }
  }
  if (target.kind === 'math') { actions.push('copy-math', 'copy-mathml', 'view-resource'); if (!readOnly) actions.push('edit-block') }
  if (target.kind === 'diagram') { actions.push('copy-diagram'); if (resourceReady) actions.push('resource-save-svg', 'resource-save-png', 'resource-save-jpeg', 'view-resource'); if (!readOnly) actions.push('edit-block') }
  if (target.kind === 'link' && target.address) { actions.push('copy-link'); if (isSafeLink(target.address.value)) actions.push('open-link') }
  if (target.kind === 'image' && target.address) {
    actions.push('image-copy-path', 'view-resource')
    if (isLocalResource(target.address.value)) { actions.push('image-save-as'); if (!readOnly) actions.push('image-copy', 'image-move', 'image-delete') }
    if (!readOnly) actions.push('image-remove', 'image-resize')
    if (!readOnly && isLocalResource(target.address.value)) actions.push('image-upload')
  }
  return { kind: target.kind, readOnly, hasSelection, availableActions: actions, hasLocalResource: target.kind === 'image' && Boolean(target.address && isLocalResource(target.address.value)), canUndo: undoDepth(view.state) > 0, canRedo: redoDepth(view.state) > 0 }
}

export function installEditorContext(view: EditorView, getProps: () => MarkdownEditorProps, applyAction: ApplyAction, onError: (message: string) => void, showResource: (resource: ViewedResource) => void): () => void {
  let requestId = 0
  let disposed = false
  function unchanged(snapshot: ContextSnapshot): boolean {
    return !disposed && getProps().documentId === snapshot.documentId && getProps().revision === snapshot.revision && view.state.doc.toString() === snapshot.content && contextTargetUnchanged(snapshot.target, view.state.doc.toString())
  }
  function requireCurrent(snapshot: ContextSnapshot): void {
    if (!unchanged(snapshot)) throw new Error('文档或目标内容已变化，请重新打开右键菜单。')
  }
  function requireEditable(snapshot: ContextSnapshot): void {
    requireCurrent(snapshot)
    if (view.state.readOnly || getProps().readOnly) throw new Error('文档已变为只读，未修改原文。')
  }
  function focus(): void { if (!focusLiveTableSelection(view)) view.focus() }
  async function write(snapshot: ContextSnapshot, content: ClipboardContent): Promise<void> {
    requireCurrent(snapshot)
    resultValue(await getProps().desktopApi.writeClipboard(content))
  }
  async function execute(action: ContextMenuAction, snapshot: ContextSnapshot, cachedSvg: string | null): Promise<void> {
    requireCurrent(snapshot)
    const { target, selection } = snapshot
    const props = getProps(), api = props.desktopApi
    const markdownOptions = view.state.facet(markdownOptionsFacet)
    if ((action === 'spell-learn' || action === 'spell-ignore') && snapshot.spelling) {
      requireEditable(snapshot)
      if (action === 'spell-ignore') resultValue(await api.ignoreSpelling(snapshot.spelling.word))
      else resultValue(await api.learnSpelling(snapshot.spelling.word))
      if (unchanged(snapshot)) view.focus()
      return
    }
    if (action.startsWith('spell-suggestion-') && snapshot.spelling) {
      requireEditable(snapshot)
      const spelling = snapshot.spelling
      const suggestion = spelling.suggestions[Number(action.slice('spell-suggestion-'.length))]
      if (!suggestion || view.state.doc.sliceString(spelling.from, spelling.to) !== spelling.word) return
      view.dispatch({ changes: { from: spelling.from, to: spelling.to, insert: suggestion }, selection: { anchor: spelling.from + suggestion.length }, userEvent: 'input.spelling', annotations: isolateHistory.of('full') })
      view.focus(); return
    }
    const select = (): void => { view.dispatch({ selection: EditorSelection.range(selection.from, selection.to) }) }
    const clipboardSelection = (withTheme = true): ClipboardContent => props.mode === 'hybrid' ? richClipboardContent(selection.text, markdownOptions, view.contentDOM, withTheme, props.locale) : { text: selection.text }
    if (action === 'copy') { await write(snapshot, clipboardSelection()); return }
    if (action === 'copy-without-theme') { await write(snapshot, clipboardSelection(false)); return }
    if (action === 'copy-markdown') { await write(snapshot, { text: selection.text }); return }
    if (action === 'copy-plain') { await write(snapshot, { text: plainText(selection.text, markdownOptions) }); return }
    if (action === 'copy-html') { const html = renderMarkdown(selection.text, markdownOptions); await write(snapshot, { text: html, html }); return }
    if (action === 'copy-table') { await write(snapshot, { text: target.source }); return }
    if (action === 'copy-code' || action === 'copy-math' || action === 'copy-diagram') { await write(snapshot, { text: contextObjectSource(target) }); return }
    if (action === 'copy-mathml') { await write(snapshot, { text: await mathMarkup(target) }); return }
    if (action === 'copy-link' || action === 'image-copy-path') { await write(snapshot, { text: target.address?.value || '' }); return }
    if (action === 'open-link') { if (target.address && isSafeLink(target.address.value)) props.onLinkOpen(target.address.value); return }
    if (action === 'view-resource') {
      const resource: ViewedResource = target.kind === 'diagram' ? { kind: 'diagram', source: cachedSvg || await diagramSvg(target, props.theme) } : target.kind === 'math' ? { kind: 'math', source: await mathMarkup(target) } : { kind: 'image', source: await props.resolveResource(target.address?.value || '') }
      requireCurrent(snapshot); showResource(resource); return
    }
    if (action.startsWith('resource-save-') && target.kind === 'diagram') {
      const format = action.slice('resource-save-'.length) as 'svg' | 'png' | 'jpeg'
      const svg = cachedSvg || await diagramSvg(target, props.theme)
      const data = format === 'svg' ? svg : await rasterizeDiagram(svg, format)
      requireCurrent(snapshot); resultValue(await api.saveResource({ id: snapshot.documentId, format, data })); return
    }
    if (action === 'select-all') { applyAction(view, 'select-all'); return }
    if (action === 'image-save-as' && target.address) {
      resultValue(await api.imageOperation({ id: snapshot.documentId, content: snapshot.content, revision: props.revision, source: target.address.value, action: 'save-as' })); return
    }
    if (view.state.readOnly) return
    if (action === 'cut') {
      await write(snapshot, clipboardSelection()); requireEditable(snapshot)
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: '' }, selection: { anchor: selection.from }, userEvent: 'delete.cut' }); focus(); return
    }
    if (action === 'paste' || action === 'paste-plain') {
      let text: string
      if (action === 'paste-plain') text = resultValue(await api.readClipboardText())
      else {
        const clipboard = resultValue(await api.readClipboard())
        requireEditable(snapshot)
        if (clipboard.images?.length) {
          const imported = resultValue(await api.importImages({ id: snapshot.documentId, content: snapshot.content, revision: snapshot.revision, images: clipboard.images }))
          if (!imported) return
          text = imported.markdown
        } else text = props.mode === 'hybrid' && props.imageOptions.smartPaste && clipboard.html ? clipboardHtmlToMarkdown(clipboard.html) ?? clipboard.text : clipboard.text
      }
      requireEditable(snapshot)
      const insert = target.kind === 'table' ? escapeCellInput(text) : text
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor: selection.from + insert.length }, userEvent: 'input.paste', annotations: isolateHistory.of('full') }); focus(); return
    }
    if (action.startsWith('table-') && target.kind === 'table') {
      const changes = tableOperation(target.source, target.from, target.row || 0, target.column || 0, action)
      if (changes) view.dispatch({ changes, userEvent: 'input.table-structure' })
      focus(); return
    }
    if (action === 'edit-block') {
      const effects = view.state.field(liveEditingBlock, false) !== undefined ? editLiveBlock.of({ from: target.from, to: target.to }) : []
      view.dispatch({ effects, selection: { anchor: target.body?.from || target.from } }); view.focus(); return
    }
    if (action === 'indent-code' && target.body) { view.dispatch({ changes: indentRange(view.state, target.body.from, target.body.to), userEvent: 'input.indent' }); focus(); return }
    if (action === 'image-remove') { view.dispatch({ changes: { from: target.from, to: target.to, insert: '' }, userEvent: 'delete.image' }); view.focus(); return }
    if (action === 'image-resize') {
      const size = await chooseImageSize(currentImageSize(target.source), props.locale)
      if (!size) return
      requireEditable(snapshot)
      const changes = imageSizeEdit(target, size, markdownOptions)
      if (changes) view.dispatch({ changes, userEvent: 'input.image-size', annotations: isolateHistory.of('full') })
      view.focus(); return
    }
    if (action === 'image-upload' && target.address) {
      const outcome = resultValue(await api.uploadImages({ id: snapshot.documentId, content: snapshot.content, revision: props.revision, sources: [target.address.value] }))
      requireEditable(snapshot)
      const replacement = outcome.replacements[0]?.url
      if (!replacement) throw new Error('上传器没有返回图片地址。')
      const insert = /^<img\b/i.test(target.source) ? replacement.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : replacement.replace(/[()]/g, value => value === '(' ? '%28' : '%29')
      view.dispatch({ changes: { from: target.address.from, to: target.address.to, insert }, userEvent: 'input.image-upload', annotations: isolateHistory.of('full') }); view.focus(); return
    }
    if (['image-copy', 'image-move', 'image-delete', 'image-save-as'].includes(action) && target.address) {
      const imageAction = action === 'image-save-as' ? 'save-as' : action.slice('image-'.length) as 'copy' | 'move' | 'delete'
      const outcome = resultValue(await api.imageOperation({ id: snapshot.documentId, content: snapshot.content, revision: props.revision, source: target.address.value, action: imageAction }))
      if (!outcome) return
      requireEditable(snapshot)
      if (imageAction === 'save-as') return
      const changes = outcome.source === null ? { from: target.from, to: target.to, insert: '' } : { from: target.address.from, to: target.address.to, insert: outcome.source.replace(/\\/g, '/').replace(/[ <>()[\]]/g, encodeURIComponent) }
      view.dispatch({ changes, userEvent: 'input.image-resource' }); focus(); return
    }
    if (action === 'insert-image') { const markdown = resultValue(await api.insertImage(snapshot.documentId)); if (markdown) { requireEditable(snapshot); select(); applyAction(view, 'image', markdown) }; return }
    select()
    if (action === 'horizontal-rule') applyAction(view, 'rule')
    else if (action === 'undo' || action === 'redo' || formatActions.includes(action as typeof formatActions[number])) applyAction(view, action as EditorAction)
  }
  async function contextmenu(event: MouseEvent): Promise<void> {
    if (event.defaultPrevented || getProps().mode === 'reading' || !(event.target instanceof Element) || !view.contentDOM.contains(event.target)) return
    event.preventDefault()
    const props = getProps(), element = event.target
    const metadata = element.closest<HTMLElement>('[data-source-from]')
    const coordinates = { x: event.clientX, y: event.clientY }
    let pos = metadata ? Number(metadata.dataset.sourceFrom) : view.posAtCoords(coordinates)
    if (pos === null) {
      // Chromium can return no text caret at the centre of a trailing <br> line.
      // Its native CM DOM position remains exact and does not focus/reveal a widget.
      const line = element.closest<HTMLElement>('.cm-line')
      if (line && view.contentDOM.contains(line)) pos = view.posAtDOM(line, 0)
      else pos = view.posAtCoords(coordinates, false)
    }
    if (pos === null || !Number.isFinite(pos)) return
    let target = sourceContextTarget(view.state, pos)
    const image = element.closest<HTMLImageElement>('img[data-original-resource]')
    if (image) {
      const firstLine = Number(metadata?.dataset.sourceLine) || view.state.doc.lineAt(pos).number
      const lastLine = Number(metadata?.dataset.sourceEnd) || firstLine
      target = imageContextTarget(view.state, image.dataset.originalResource!, view.state.doc.line(Math.min(firstLine, view.state.doc.lines)).from, view.state.doc.line(Math.min(lastLine, view.state.doc.lines)).to) || target
    }
    const cell = element.closest<HTMLElement>('th[data-row],td[data-row]')
    if (cell && target.kind === 'table') { target.row = Number(cell.dataset.row); target.column = Number(cell.dataset.column) }
    const current = view.state.selection.main
    const from = pos >= current.from && pos <= current.to ? current.from : pos
    const to = pos >= current.from && pos <= current.to ? current.to : pos
    const snapshot: ContextSnapshot = { documentId: props.documentId, revision: props.revision, content: view.state.doc.toString(), target, selection: { from, to, text: view.state.doc.sliceString(from, to) } }
    const id = ++requestId
    try {
      let cachedSvg: string | null = null
      if (target.kind === 'diagram') {
        try { cachedSvg = await diagramSvg(target, props.theme) } catch { /* Invalid diagrams still offer source copying and editing. */ }
      }
      if (disposed || id !== requestId || !unchanged(snapshot)) return
      const menu = contextMenuRequest(view, target, to > from, target.kind !== 'diagram' || cachedSvg !== null)
      if (props.spellcheck && !props.readOnly && !view.state.readOnly && ['editor', 'table'].includes(target.kind)) {
        const wordRange = view.state.wordAt(view.posAtCoords(coordinates) ?? pos)
        const word = wordRange && view.state.doc.sliceString(wordRange.from, wordRange.to)
        if (wordRange && validSpellingWord(word)) {
          const spelling = await apiSpelling(props, word)
          if (disposed || id !== requestId || !unchanged(snapshot)) return
          if (spelling?.misspelled && !spelling.ignored) {
            snapshot.spelling = { from: wordRange.from, to: wordRange.to, word, suggestions: spelling.suggestions }
            menu.spelling = { word, suggestions: spelling.suggestions }
            menu.availableActions.push('spell-learn', 'spell-ignore', ...spelling.suggestions.map((_, index) => `spell-suggestion-${index}` as ContextMenuAction))
          }
        }
      }
      const action = resultValue(await props.desktopApi.showContextMenu(menu))
      if (disposed || id !== requestId || action === null) return
      if (!menu.availableActions.includes(action)) throw new Error('该右键操作当前不可用。')
      await execute(action, snapshot, cachedSvg)
    } catch (error) { if (!disposed) onError(error instanceof Error ? error.message : '右键操作失败，请重试。') }
  }
  const listener = (event: MouseEvent): void => { void contextmenu(event) }
  view.dom.addEventListener('contextmenu', listener, true)
  return () => { disposed = true; requestId++; view.dom.removeEventListener('contextmenu', listener, true) }
}
