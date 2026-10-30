import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { indentUnit } from '@codemirror/language'
import { markdownCompletionExtension } from './markdown-completion'
import { markdownInputExtension } from './markdown-input'
import { smartDashInputExtension } from './smart-dash-input'
import { markdownOptionsFacet } from './markdown-config'
import { organizeDocumentImages, uploadDocumentImages } from './image-upload'
import { clipboardImportExtension } from './clipboard-import'
import { chooseAndInsertImages } from './choose-image'
import { pasteTableImages } from './table-image-paste'
import { pasteTableInlineHtml } from './table-html-paste'
import { createSelectionCopy } from './selection-copy'
import { richClipboardExtension } from './rich-clipboard'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeLanguageForInfo } from './code-languages'
import { findNext, findPrevious, openSearchPanel, replaceNext, search, searchKeymap } from '@codemirror/search'
import { createTextEdit } from './commands'
import { headingLevelEdit } from './heading-level'
import { insertAdjacentParagraph } from './paragraph-insert'
import { paragraphBreak } from './paragraph-break'
import { guardParagraphBreak } from './paragraph-break-guard'
import { quoteSoftBreak } from './quote-soft-break'
import { listSoftBreak } from './list-soft-break'
import { selectCurrentBlock, deleteCurrentBlock } from './block-range'
import { taskStatusEdit } from './task-status'
import { selectLineSentence, deleteLineSentence } from './line-sentence'
import { deleteCurrentWord } from './word-delete'
import { deleteCurrentStyle } from './style-delete'
import { insertTableOfContents } from './toc-insert'
import { insertYamlFrontMatter } from './yaml-insert'
import { insertAlert } from './alert-insert'
import { insertFootnote } from './footnote-insert'
import { toggleUnderline } from './underline'
import { toggleExtendedInline } from './extended-inline'
import { toggleInlineMath } from './inline-math-insert'
import { toggleHtmlComment } from './html-comment'
import { underlineMultiline } from './underline-multiline'
import { hybridExtension } from './hybrid'
import { ReadingView, type ReadingViewHandle } from './ReadingView'
import { readReadingAnchor, readSourceAnchor, restoreReadingAnchor, type SemanticScrollAnchor } from './semantic-scroll'
import { styleScope } from './live-inline'
import { focusLiveTableSelection, selectLiveTableCell, prepareLiveTablesForClose, captureLiveTableFocus, restoreLiveTableFocus } from './live-table'
import { CloseGuard, type EditorCloseHandle } from './close-guard'
import { editorDefaultKeymap } from './editor-keymap'
import { editorText } from './editor-i18n'
import { autoIndentSelectedCode, codeBlockDisplay, editorLocale, selectLiveCode } from './live-code'
import { preserveHeadingPreview } from './live-source-edit'
import { folderSearchHighlight, setFolderSearch } from './folder-search-highlight'
import { paragraphIndent } from './paragraph-indent'
import { clearFormatTransaction } from './clear-format'
import { canFormatSelectedLines } from './line-format-guard'
import { canFormatInlineSelection } from './inline-format-guard'
import { inlineCodeTransaction } from './inline-code-format'
import { linkFormatTransaction } from './link-format'
import { emphasisTransaction } from './emphasis-format'

import { installEditorContext } from './editor-context'
import { ResourceViewer } from './ResourceViewer'
import type { ViewedResource } from './context-resource'
import type { EditorAction, MarkdownEditorProps } from './types'
import './editor.css'

const editorHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => spec.tag === tags.heading ? { ...spec, textDecoration: 'none' } : spec))
const darkHighlightColors: Record<string, string> = {
  '#404740': '#e4e7ed', '#708': '#efc9ff', '#219': '#c5ddff', '#164': '#d1f2c5',
  '#a11': '#ffd1bd', '#e40': '#ffe2a8', '#00f': '#c5ddff', '#30a': '#efc9ff',
  '#085': '#a8ede1', '#167': '#a8ede1', '#256': '#a8ede1', '#00c': '#c5ddff',
  '#940': '#ffe2a8', '#f00': '#ffd1bd',
}
const darkEditorHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => ({
  ...spec,
  ...(spec.tag === tags.heading ? { textDecoration: 'none' } : {}),
  ...(spec.color && darkHighlightColors[spec.color] ? { color: darkHighlightColors[spec.color] } : {}),
})))
const EXTERNAL_UPDATE = Annotation.define<boolean>()

function applyAction(view: EditorView, action: EditorAction, value?: string): boolean {
  if (action === 'focus-editor') { view.focus(); return true }
  if (action === 'select-line' || action === 'delete-line') {
    if (view.compositionStarted) return false
    const mode = view.contentDOM.getAttribute('data-mode') === 'source' ? 'source' : 'hybrid'
    const edit = action === 'select-line' ? selectLineSentence(view.state, mode) : deleteLineSentence(view.state, mode)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'jump-start' || action === 'jump-end' || action === 'jump-line-start' || action === 'jump-line-end' || action === 'jump-selection') {
    if (action === 'jump-selection' && view.compositionStarted) return false
    const selection = view.state.selection.main
    const line = view.state.doc.lineAt(selection.head)
    const position = action === 'jump-start' ? 0 : action === 'jump-end' ? view.state.doc.length : action === 'jump-line-start' ? line.from : action === 'jump-line-end' ? line.to : selection.head
    view.dispatch({ ...(action === 'jump-selection' ? {} : { selection: { anchor: position } }), effects: EditorView.scrollIntoView(position, { y: 'center' }), userEvent: 'select.jump' })
    view.focus(); return true
  }
  if (action === 'select-block' || action === 'delete-block') {
    const edit = action === 'select-block' ? selectCurrentBlock(view.state) : deleteCurrentBlock(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'delete-style') {
    const edit = deleteCurrentStyle(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'delete-word') {
    if (view.compositionStarted) return false
    const edit = deleteCurrentWord(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'select-word') {
    const word = view.state.wordAt(view.state.selection.main.head)
    if (!word) return false
    view.dispatch({ selection: EditorSelection.range(word.from, word.to), userEvent: 'select.word' })
    view.focus(); return true
  }
  if (action === 'select-scope') {
    if (selectLiveTableCell(view)) return true
    const scope = styleScope(view.state)
    if (!scope) return false
    view.dispatch({ selection: EditorSelection.range(scope.from, scope.to), userEvent: 'select.scope' })
    view.focus(); return true
  }
  if (action === 'find' || action === 'replace') {
    const result = openSearchPanel(view)
    if (action === 'replace') queueMicrotask(() => view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus())
    return result
  }
  if (action === 'find-next' || action === 'find-previous') return action === 'find-next' ? findNext(view) : findPrevious(view)
  if (action === 'replace-next') return replaceNext(view)
  if (action === 'select-all') { const result = selectLiveCode(view) || selectAll(view); view.focus(); return result }
  if ((action === 'ordered-list' || action === 'bullet-list' || action === 'code') && view.compositionStarted) return false
  if (view.state.readOnly) return false
  if ((action === 'bold' || action === 'italic' || action === 'strike' || action === 'inline-code' || action === 'link') && (view.compositionStarted || !canFormatInlineSelection(view.state))) return false
  if (action === 'bold' || action === 'italic' || action === 'strike') {
    const edit = emphasisTransaction(view.state, action)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'inline-code') {
    const edit = inlineCodeTransaction(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'link') {
    const edit = linkFormatTransaction(view.state, value)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if ((action === 'paragraph' || action === 'quote' || action === 'bullet-list' || action === 'ordered-list' || action === 'task-list' || /^heading-[1-6]$/.test(action)) && (view.compositionStarted || !canFormatSelectedLines(view.state))) return false
  if (action === 'clear-format') {
    if (view.compositionStarted) return false
    const edit = clearFormatTransaction(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'task-check' || action === 'task-uncheck' || action === 'task-toggle') {
    const edit = taskStatusEdit(view.state, action === 'task-check' ? 'checked' : action === 'task-uncheck' ? 'unchecked' : 'toggle')
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'underline') {
    const edit = toggleUnderline(view.state) ?? underlineMultiline(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'highlight' || action === 'superscript' || action === 'subscript') {
    const edit = toggleExtendedInline(view.state, action)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'inline-math') {
    const edit = toggleInlineMath(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'html-comment') {
    const edit = toggleHtmlComment(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'insert-footnote') {
    const edit = insertFootnote(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'insert-toc') {
    const edit = insertTableOfContents(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'insert-yaml') {
    const edit = insertYamlFrontMatter(view.state)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'insert-alert-note' || action === 'insert-alert-tip' || action === 'insert-alert-important' || action === 'insert-alert-warning' || action === 'insert-alert-caution') {
    const kind = action.slice('insert-alert-'.length) as Parameters<typeof insertAlert>[1]
    const edit = insertAlert(view.state, kind)
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'paragraph-before' || action === 'paragraph-after') {
    const edit = insertAdjacentParagraph(view.state, action === 'paragraph-before' ? 'before' : 'after')
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'heading-promote' || action === 'heading-demote') {
    const edit = headingLevelEdit(view.state, action === 'heading-promote' ? 'promote' : 'demote')
    if (!edit) return false
    view.dispatch(edit); view.focus(); return true
  }
  if (action === 'undo') { const result = undo(view); if (!focusLiveTableSelection(view)) view.focus(); return result }
  if (action === 'redo') { const result = redo(view); if (!focusLiveTableSelection(view)) view.focus(); return result }
  const { from, to } = view.state.selection.main
  const settings = view.state.facet(markdownOptionsFacet)
  const actionValue = action === 'code' && settings.codeDefaultLanguageMode !== 'typed' ? settings.defaultCodeLanguage : value
  const edit = createTextEdit(action, view.state.doc.toString(), from, to, actionValue)
  if (!edit) return false
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: edit.selection, scrollIntoView: true, userEvent: 'input.format' })
  if (!focusLiveTableSelection(view)) view.focus()
  return true
}

function configuration(props: MarkdownEditorProps, callbacks: Pick<MarkdownEditorProps, 'resolveResource' | 'onLinkOpen'> & Pick<import('./live-types').LiveOptions, 'onError' | 'onTableImagePaste' | 'onTableHtmlPaste'>): Extension[] {
  const extensions: Extension[] = [
    markdownOptionsFacet.of(props.markdownOptions), editorLocale.of(props.locale ?? 'zh-CN'), markdownCompletionExtension, markdownInputExtension, smartDashInputExtension, indentUnit.of(' '.repeat(props.markdownOptions.codeIndentSize)),
    EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly),
    syntaxHighlighting(props.theme === 'dark' ? darkEditorHighlightStyle : editorHighlightStyle),
    EditorView.contentAttributes.of({ 'aria-label': editorText(props.locale, 'Markdown 编辑器'), spellcheck: String(props.spellcheck), 'data-mode': props.mode }),
    EditorView.theme({
      '&': { fontSize: `${props.fontSize}px`, color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' },
      '.cm-content': { fontFamily: props.mode === 'source' ? 'Consolas, "Cascadia Code", monospace' : 'var(--font-editor)', caretColor: 'var(--color-text)', minHeight: '100%', paddingBottom: props.typewriterMode ? '45vh' : '120px' },
      '.cm-line': { lineHeight: 'var(--writing-line-height, 1.8)' },
      '.cm-scroller': { fontFamily: 'inherit' },
      '.cm-gutters': { color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: props.mode === 'source' ? 'var(--color-surface-muted)' : 'transparent' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-editor-selection) !important' },
      '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
    }, { dark: props.theme === 'dark' }),
  ]
  if (props.markdownOptions.autoPairBrackets) extensions.push(closeBrackets())
  if (props.wrapLines) extensions.push(EditorView.lineWrapping)
  if (props.lineNumbers && props.mode === 'source') extensions.push(lineNumbers(), highlightActiveLineGutter())
  if (props.mode === 'hybrid') extensions.push(hybridExtension({ locale: props.locale, theme: props.theme, focusMode: props.focusMode, readOnly: props.readOnly, markdownOptions: props.markdownOptions, ...callbacks }))
  if (props.mode === 'hybrid' && props.indentFirstLine) extensions.push(paragraphIndent)
  return extensions
}

export function MarkdownEditor(props: MarkdownEditorProps): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const guardRef = useRef<CloseGuard | null>(null)
  if (!guardRef.current) guardRef.current = new CloseGuard(() => setContextError('关闭期间文档发生变化，请重试。'))
  const [contextError, setContextError] = useState('')
  const [resource, setResource] = useState<ViewedResource | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const pendingResourceFocusRef = useRef<string | null>(null)
  const propsRef = useRef(props)
  const activeDocumentRef = useRef(props.documentId)
  const cacheRef = useRef(new Map<string, EditorState>())
  const compartmentRef = useRef(new Compartment())
  const pendingExternalRef = useRef<string | null>(null)
  const externalTimersRef = useRef(new Map<number, () => void>())
  const modeRef = useRef(props.mode)
  const emittedValuesRef = useRef(new Set<string>())
  const readingRef = useRef<ReadingViewHandle>(null)
  const restoringScrollRef = useRef(false)
  const readingReturnAnchorRef = useRef<{ documentId: string; anchor: SemanticScrollAnchor } | null>(null)
  const modeScrollAnchorRef = useRef<{ documentId: string; toMode: MarkdownEditorProps['mode']; anchor: SemanticScrollAnchor } | null>(null)
  const readingSnapshotRef = useRef<{ documentId: string; selection: EditorSelection; scrollTop: number; scrollLeft: number; anchor: SemanticScrollAnchor } | null>(null)
  if (props.mode === 'reading' && modeRef.current !== 'reading' && viewRef.current && !readingSnapshotRef.current) {
    const view = viewRef.current
    const anchor = modeRef.current === 'hybrid' ? readReadingAnchor(view.scrollDOM, view.contentDOM) || readSourceAnchor(view) : readSourceAnchor(view)
    readingSnapshotRef.current = { documentId: activeDocumentRef.current, selection: view.state.selection, scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft, anchor }
  }
  if (props.mode !== 'reading' && modeRef.current === 'reading') {
    const anchor = readingRef.current?.getScrollAnchor()
    if (anchor) readingReturnAnchorRef.current = { documentId: activeDocumentRef.current, anchor }
  }
  if (props.mode !== modeRef.current && props.mode !== 'reading' && modeRef.current !== 'reading' && viewRef.current && modeScrollAnchorRef.current?.toMode !== props.mode) {
    const view = viewRef.current
    const anchor = modeRef.current === 'hybrid' ? readReadingAnchor(view.scrollDOM, view.contentDOM) || readSourceAnchor(view) : readSourceAnchor(view)
    modeScrollAnchorRef.current = { documentId: activeDocumentRef.current, toMode: props.mode, anchor }
  }
  propsRef.current = props

  const callbacksRef = useRef({
    resolveResource: (source: string) => propsRef.current.resolveResource(source),
    onLinkOpen: (target: string) => propsRef.current.onLinkOpen(target),
    onError: (message: string) => setContextError(message),
    onTableImagePaste: (view: EditorView, files: File[], range: { from: number; to: number }, isCurrent: () => boolean, virtualCell?: { tableFrom: number; tableTo: number; row: number; column: number; prefix: string }) => { void pasteTableImages(view, () => propsRef.current, files, range, isCurrent, virtualCell).catch((error: unknown) => setContextError(error instanceof Error ? error.message : '图片粘贴失败。')) },
    onTableHtmlPaste: (view: EditorView, html: string, target: import('./live-table').LiveTableImageTarget) => { try { pasteTableInlineHtml(view, propsRef.current, html, target) } catch (error) { setContextError(error instanceof Error ? error.message : 'HTML 粘贴失败。') } },
  })

  function editorConfiguration(current: MarkdownEditorProps): Extension[] {
    return configuration({ ...current, mode: current.mode === 'reading' ? 'source' : current.mode, readOnly: current.readOnly || current.mode === 'reading' }, callbacksRef.current)
  }

  function schedulePendingExternal(view: EditorView): void {
    const pending = pendingExternalRef.current
    if (pending === null) return
    const finish = propsRef.current.closeCoordinator.start()
    if (!finish) return
    const documentId = propsRef.current.documentId
    pendingExternalRef.current = null
    const timer = window.setTimeout(() => {
      externalTimersRef.current.delete(timer)
      try {
        if (viewRef.current === view && propsRef.current.documentId === documentId && propsRef.current.value === pending && pending !== view.state.doc.toString()) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pending }, annotations: EXTERNAL_UPDATE.of(true) })
        }
      } finally { finish() }
    }, 0)
    externalTimersRef.current.set(timer, finish)
  }

  function createState(current: MarkdownEditorProps): EditorState {
    return EditorState.create({
      doc: current.value,
      extensions: [
        guardRef.current!.extension, history(), drawSelection(), indentOnInput(), bracketMatching(), codeBlockDisplay,
        clipboardImportExtension(() => ({ closeCoordinator: propsRef.current.closeCoordinator, snapshot: { id: propsRef.current.documentId, content: viewRef.current?.state.doc.toString() ?? propsRef.current.value, revision: propsRef.current.revision }, mode: propsRef.current.mode, encoding: propsRef.current.encoding, lineEnding: propsRef.current.lineEnding, readOnly: propsRef.current.readOnly, imageOptions: propsRef.current.imageOptions, readClipboardText: () => propsRef.current.desktopApi.readClipboardText(), importImages: request => propsRef.current.desktopApi.importImages(request), onError: setContextError })),
        richClipboardExtension(() => ({ mode: propsRef.current.mode, api: propsRef.current.desktopApi, documentId: propsRef.current.documentId, revision: propsRef.current.revision, closeCoordinator: propsRef.current.closeCoordinator, onError: setContextError })),
        markdown({ codeLanguages: codeLanguageForInfo, base: markdownLanguage }),
        highlightActiveLine(), search({ top: true }), folderSearchHighlight,
        Prec.highest(keymap.of([{ key: 'Enter', run: view => guardParagraphBreak(view, propsRef.current.mode === 'hybrid' ? 'hybrid' : 'source') }])),
        keymap.of([
          { key: 'Mod-b', run: (view) => applyAction(view, 'bold') },
          { key: 'Mod-i', run: (view) => applyAction(view, 'italic') },
          { key: 'Mod-k', run: (view) => applyAction(view, 'link') },
          ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ key: `Mod-${level}`, run: (view: EditorView) => applyAction(view, `heading-${level}`) })),
          { key: 'Mod-0', run: (view) => applyAction(view, 'paragraph') },
          { key: 'Mod-Shift-k', run: (view) => applyAction(view, 'code') },
          { key: 'Mod-Shift-m', run: (view) => applyAction(view, 'math') },
          { key: 'Mod-t', run: (view) => applyAction(view, 'table') },
          { key: 'Mod-Shift-q', run: (view) => applyAction(view, 'quote') },
          { key: 'Mod-Shift-[', run: (view) => applyAction(view, 'ordered-list') },
          { key: 'Mod-Shift-]', run: (view) => applyAction(view, 'bullet-list') },
          { key: 'Mod-Shift-`', run: (view) => applyAction(view, 'inline-code') },
          { key: 'Alt-Shift-5', run: (view) => applyAction(view, 'strike') },
          { key: 'Mod-\\', run: (view) => applyAction(view, 'clear-format') },
          { key: 'Enter', run: (view) => {
            if (view.composing) return false
            const mode = propsRef.current.mode === 'hybrid' ? 'hybrid' : 'source'
            const edit = paragraphBreak(view.state, mode)
            if (!edit) return false
            if (edit === 'blocked') return true
            view.dispatch(edit)
            return true
          } },
          { key: 'Shift-Enter', run: view => {
            if (view.compositionStarted) return false
            const mode = propsRef.current.mode === 'hybrid' ? 'hybrid' : 'source'
            const edit = quoteSoftBreak(view.state, mode) ?? listSoftBreak(view.state, mode)
            if (!edit) return false
            if (edit === 'blocked') return true
            view.dispatch(edit)
            return true
          } },
          { key: 'Shift-Tab', run: autoIndentSelectedCode },
          indentWithTab, ...closeBracketsKeymap, ...editorDefaultKeymap, ...historyKeymap, ...searchKeymap,
        ]),
        compartmentRef.current.of(editorConfiguration(current)),
        EditorView.updateListener.of((update) => {
          const external = update.transactions.some((transaction) => transaction.annotation(EXTERNAL_UPDATE))
          if (update.docChanged && !external) {
            const content = update.state.doc.toString()
            emittedValuesRef.current.add(content)
            if (emittedValuesRef.current.size > 8) {
              const oldest = emittedValuesRef.current.values().next().value
              if (oldest !== undefined) emittedValuesRef.current.delete(oldest)
            }
            propsRef.current.onChange(content)
          }
          if (update.selectionSet || update.docChanged) {
            const { from, to } = update.state.selection.main
            propsRef.current.onSelectionChange({ from, to, text: update.state.doc.sliceString(from, to) })
            if (propsRef.current.typewriterMode && propsRef.current.mode !== 'reading' && !restoringScrollRef.current && !update.view.composing) {
              update.view.requestMeasure({ read: (view) => view.state.selection.main.head, write: (head, view) => {
                if (propsRef.current.mode !== 'reading' && !restoringScrollRef.current && !view.composing) view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
              } })
            }
          }
        }),
        EditorView.domEventHandlers({
          compositionend: (_event, view) => {
            schedulePendingExternal(view)
            return false
          },
        }),
      ],
    })
  }

  useLayoutEffect(() => {
    if (!mountRef.current) return
    const view = new EditorView({ state: createState(propsRef.current), parent: mountRef.current })
    viewRef.current = view
    const guard = guardRef.current!
    let focusBeforeClose: { documentId: string; element: HTMLElement; table: ReturnType<typeof captureLiveTableFocus> } | null = null
    const restoreFocus = () => {
      const snapshot = focusBeforeClose
      focusBeforeClose = null
      const root = rootRef.current
      const doc = view.dom.ownerDocument
      if (!snapshot || !root?.isConnected || propsRef.current.documentId !== snapshot.documentId || !doc.hasFocus()) return
      const active = doc.activeElement
      if (active && active !== doc.body && !root.contains(active)) return
      if (snapshot.table) { restoreLiveTableFocus(view, snapshot.table); return }
      if (snapshot.element.isConnected && root.contains(snapshot.element)) snapshot.element.focus()
    }
    const handle: EditorCloseHandle = {
      begin() {
        if (guard.locked) return 'already-locked'
        if (view.composing || view.compositionStarted || pendingExternalRef.current !== null) return 'composing'
        if (!rootRef.current) return 'unavailable'
        const active = view.dom.ownerDocument.activeElement
        focusBeforeClose = active instanceof HTMLElement && rootRef.current.contains(active) ? { documentId: propsRef.current.documentId, element: active, table: captureLiveTableFocus(view) } : null
        try {
          if (!prepareLiveTablesForClose(view)) { focusBeforeClose = null; return 'composing' }
          if (focusBeforeClose?.table) focusBeforeClose.table.source = view.state.doc
          const result = guard.begin(view)
          if (result !== 'locked') { restoreFocus(); return result }
          if (rootRef.current) rootRef.current.inert = true
          return result
        } catch (error) { guard.end(view); restoreFocus(); throw error }
      },
      end() {
        if (rootRef.current) rootRef.current.inert = false
        guard.end(view)
        restoreFocus()
        const pendingResourceFocus = pendingResourceFocusRef.current
        pendingResourceFocusRef.current = null
        if (pendingResourceFocus) queueMicrotask(() => {
          const doc = view.dom.ownerDocument
          const active = doc.activeElement
          if (viewRef.current !== view || propsRef.current.documentId !== pendingResourceFocus || !doc.hasFocus() || !view.dom.isConnected) return
          if (active && active !== doc.body && active !== view.contentDOM && !(active instanceof Element && active.closest('.editor-resource-viewer'))) return
          const top = view.scrollDOM.scrollTop
          view.focus()
          view.scrollDOM.scrollTop = top
        })
        queueMicrotask(() => { if (viewRef.current === view) schedulePendingExternal(view) })
      },
      get blocked() { return guard.blocked },
    }
    propsRef.current.closeHandleRef.current = handle
    const disposeContext = installEditorContext(view, () => propsRef.current, applyAction, setContextError, setResource)
    if (propsRef.current.mode !== 'reading') view.focus()
    return () => { if (propsRef.current.closeHandleRef.current === handle) propsRef.current.closeHandleRef.current = null; handle.end(); for (const [timer, finish] of externalTimersRef.current) { clearTimeout(timer); finish() }; externalTimersRef.current.clear(); disposeContext(); view.destroy(); viewRef.current = null; cacheRef.current.clear() }
    // The view persists for this component's lifetime; mutable callbacks read propsRef.
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (activeDocumentRef.current !== props.documentId) {
      cacheRef.current.set(activeDocumentRef.current, view.state)
      if (cacheRef.current.size > 32) {
        const oldest = cacheRef.current.keys().next().value
        if (oldest !== undefined) cacheRef.current.delete(oldest)
      }
      const cached = cacheRef.current.get(props.documentId)
      view.setState(cached?.doc.toString() === props.value ? cached : createState(propsRef.current))
      activeDocumentRef.current = props.documentId
      readingSnapshotRef.current = null
      readingReturnAnchorRef.current = null
      modeScrollAnchorRef.current = null
      restoringScrollRef.current = false
      pendingExternalRef.current = null
      emittedValuesRef.current.clear()
      if (propsRef.current.mode !== 'reading') view.focus()
      const { from, to } = view.state.selection.main
      propsRef.current.onSelectionChange({ from, to, text: view.state.doc.sliceString(from, to) })
    } else if (view.state.doc.toString() !== props.value) {
      if (emittedValuesRef.current.has(props.value)) return
      if (view.composing) { pendingExternalRef.current = props.value; return }
      const head = Math.min(view.state.selection.main.head, props.value.length)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value }, selection: EditorSelection.cursor(head), annotations: EXTERNAL_UPDATE.of(true) })
    }
  }, [props.documentId, props.value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const previousMode = modeRef.current
    const isReturning = previousMode === 'reading' && props.mode !== 'reading'
    const snapshot = isReturning && readingSnapshotRef.current?.documentId === props.documentId ? readingSnapshotRef.current : null
    const returnAnchor = isReturning && readingReturnAnchorRef.current?.documentId === props.documentId ? readingReturnAnchorRef.current.anchor : modeScrollAnchorRef.current?.documentId === props.documentId ? modeScrollAnchorRef.current.anchor : null
    restoringScrollRef.current = isReturning || Boolean(returnAnchor)
    const selection = snapshot ? EditorSelection.create(snapshot.selection.ranges.map((range) => EditorSelection.range(Math.min(range.anchor, view.state.doc.length), Math.min(range.head, view.state.doc.length))), snapshot.selection.mainIndex) : null
    view.dispatch({ effects: compartmentRef.current.reconfigure(editorConfiguration(propsRef.current)), ...(selection ? { selection } : {}) })
    if (previousMode !== props.mode && props.mode !== 'reading') {
      view.focus()
      if (returnAnchor) {
        const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, returnAnchor.line)))
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 0 }) })
        // Let CM render/measure the target line before applying its wrapped-line fraction.
        requestAnimationFrame(() => {
          if (viewRef.current !== view || propsRef.current.mode === 'reading' || propsRef.current.documentId !== props.documentId) return
          view.requestMeasure({
            read: (currentView) => {
              const currentLine = currentView.state.doc.line(Math.max(1, Math.min(currentView.state.doc.lines, returnAnchor.line)))
              const block = currentView.lineBlockAt(currentLine.from)
              return block.top + currentView.documentPadding.top + returnAnchor.fraction * block.height
            },
            write: (top, currentView) => {
              if (propsRef.current.mode === 'reading' || propsRef.current.documentId !== props.documentId) return
              if (props.mode === 'hybrid') restoreReadingAnchor(currentView.scrollDOM, currentView.contentDOM, returnAnchor)
              else currentView.scrollDOM.scrollTop = top
              if (snapshot) currentView.scrollDOM.scrollLeft = snapshot.scrollLeft
              restoringScrollRef.current = false
            },
          })
        })
      } else {
        view.requestMeasure({ read: () => snapshot, write: (saved, currentView) => {
          if (saved) { currentView.scrollDOM.scrollTop = saved.scrollTop; currentView.scrollDOM.scrollLeft = saved.scrollLeft }
          restoringScrollRef.current = false
        } })
      }
    }
    if (isReturning) { readingSnapshotRef.current = null; readingReturnAnchorRef.current = null }
    modeScrollAnchorRef.current = null
    modeRef.current = props.mode
  }, [props.documentId, props.mode, props.theme, props.locale, props.fontSize, props.focusMode, props.typewriterMode, props.readOnly, props.lineNumbers, props.wrapLines, props.spellcheck, props.markdownOptions, props.indentFirstLine])

  useEffect(() => {
    const command = props.command
    if (!command) return
    propsRef.current.onCommandStarted(command.id)
    const finish = command.releaseCloseTask ?? (() => undefined)
    const view = viewRef.current
    if (props.mode === 'reading' || !view) { finish(); return }
    try {
      if (command.action === 'copy-markdown' || command.action === 'copy-plain' || command.action === 'copy-html') {
        if (view.compositionStarted) { finish(); return }
        const copy = createSelectionCopy(view, () => propsRef.current)
        void copy(command.action).catch((error: unknown) => setContextError(error instanceof Error ? error.message : '复制失败。')).finally(finish)
      } else if (command.action === 'choose-image') void chooseAndInsertImages(view, () => propsRef.current).catch((error: unknown) => setContextError(error instanceof Error ? error.message : '图片插入失败。')).finally(finish)
      else if (command.action === 'organize-images') void organizeDocumentImages(view, () => propsRef.current).catch((error: unknown) => setContextError(error instanceof Error ? error.message : '图片整理失败。')).finally(finish)
      else if (command.action === 'upload-images') void uploadDocumentImages(view, () => propsRef.current).catch((error: unknown) => setContextError(error instanceof Error ? error.message : '图片上传失败。')).finally(finish)
      else { applyAction(view, command.action, command.value); finish() }
    } catch (error) { finish(); throw error }
  }, [props.command?.id])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setFolderSearch.of(props.folderSearch ?? null) })
  }, [props.documentId, props.folderSearch])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !props.jumpToLine || (props.jumpToLine.documentId && props.jumpToLine.documentId !== props.documentId) || props.mode === 'reading') return
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, props.jumpToLine.line)))
    view.dispatch({ selection: { anchor: line.from }, effects: [preserveHeadingPreview.of(line.from), EditorView.scrollIntoView(line.from, { y: 'center' })] })
    view.focus()
  }, [props.jumpToLine?.id])

  const closeResource = useCallback((): void => {
    setResource(null)
    const view = viewRef.current
    if (view && guardRef.current?.locked) { pendingResourceFocusRef.current = propsRef.current.documentId; return }
    if (view) { const top = view.scrollDOM.scrollTop; view.focus(); view.scrollDOM.scrollTop = top }
  }, [])
  useEffect(() => { setContextError(''); setResource(null) }, [props.documentId])
  useEffect(() => {
    if (!contextError) return
    const timeout = setTimeout(() => setContextError(''), 6000)
    return () => clearTimeout(timeout)
  }, [contextError])

  return <div ref={rootRef} className={`markdown-editor markdown-editor-${props.mode}${props.focusMode ? ' markdown-editor-focus' : ''}`} data-testid="markdown-editor">
    {contextError ? <div className="editor-context-error" role="alert">{editorText(props.locale, contextError)}<button type="button" aria-label={editorText(props.locale, '关闭提示')} onClick={() => setContextError('')}>×</button></div> : null}
    <div className="editor-mount" ref={mountRef} hidden={props.mode === 'reading'} aria-hidden={props.mode === 'reading'} />
    {props.mode === 'reading' ? <ReadingView markdownOptions={props.markdownOptions} ref={readingRef} platform={props.platform} documentId={props.documentId} content={props.value} theme={props.theme} fontSize={props.fontSize} command={props.command} jumpToLine={props.jumpToLine} onLinkOpen={props.onLinkOpen} resolveResource={props.resolveResource} initialAnchor={readingSnapshotRef.current?.documentId === props.documentId ? readingSnapshotRef.current.anchor : null} /> : null}
    {resource ? <ResourceViewer resource={resource} onClose={closeResource} /> : null}
  </div>
}
