import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeLanguageForInfo } from './code-languages'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { createTextEdit } from './commands'
import { hybridExtension } from './hybrid'
import { ReadingView, type ReadingViewHandle } from './ReadingView'
import { readReadingAnchor, readSourceAnchor, restoreReadingAnchor, type SemanticScrollAnchor } from './semantic-scroll'
import { styleScope } from './live-inline'
import { focusLiveTableSelection, selectLiveTableCell } from './live-table'
import { editorDefaultKeymap } from './editor-keymap'
import { selectLiveCode } from './live-code'
import { folderSearchHighlight, setFolderSearch } from './folder-search-highlight'

import { installEditorContext } from './editor-context'
import { ResourceViewer } from './ResourceViewer'
import type { ViewedResource } from './context-resource'
import type { EditorAction, MarkdownEditorProps } from './types'
import './editor.css'

const editorHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => spec.tag === tags.heading ? { ...spec, textDecoration: 'none' } : spec))
const EXTERNAL_UPDATE = Annotation.define<boolean>()

function applyAction(view: EditorView, action: EditorAction, value?: string): boolean {
  if (action === 'focus-editor') { view.focus(); return true }
  if (action === 'select-scope') {
    if (selectLiveTableCell(view)) return true
    const scope = styleScope(view.state)
    view.dispatch({ selection: EditorSelection.range(scope.from, scope.to), userEvent: 'select.scope' })
    view.focus(); return true
  }
  if (action === 'find' || action === 'replace') {
    const result = openSearchPanel(view)
    if (action === 'replace') queueMicrotask(() => view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus())
    return result
  }
  if (action === 'select-all') { const result = selectLiveCode(view) || selectAll(view); view.focus(); return result }
  if (view.state.readOnly) return false
  if (action === 'undo') { const result = undo(view); if (!focusLiveTableSelection(view)) view.focus(); return result }
  if (action === 'redo') { const result = redo(view); if (!focusLiveTableSelection(view)) view.focus(); return result }
  const { from, to } = view.state.selection.main
  const edit = createTextEdit(action, view.state.doc.toString(), from, to, value)
  if (!edit) return false
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: edit.selection, scrollIntoView: true, userEvent: 'input.format' })
  if (!focusLiveTableSelection(view)) view.focus()
  return true
}

function configuration(props: MarkdownEditorProps, callbacks: Pick<MarkdownEditorProps, 'resolveResource' | 'onLinkOpen'>): Extension[] {
  const extensions: Extension[] = [
    EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: String(props.spellcheck), 'data-mode': props.mode }),
    EditorView.theme({
      '&': { fontSize: `${props.fontSize}px`, color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' },
      '.cm-content': { fontFamily: props.mode === 'source' ? 'Consolas, "Cascadia Code", monospace' : 'var(--font-editor)', caretColor: 'var(--color-text)', minHeight: '100%', paddingBottom: props.typewriterMode ? '45vh' : '120px' },
      '.cm-line': { lineHeight: '1.85' },
      '.cm-scroller': { fontFamily: 'inherit' },
      '.cm-gutters': { color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: props.mode === 'source' ? 'var(--color-surface-muted)' : 'transparent' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-selection) !important' },
      '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
    }, { dark: props.theme === 'dark' }),
  ]
  if (props.wrapLines) extensions.push(EditorView.lineWrapping)
  if (props.lineNumbers && props.mode === 'source') extensions.push(lineNumbers(), highlightActiveLineGutter())
  if (props.mode === 'hybrid') extensions.push(hybridExtension({ theme: props.theme, focusMode: props.focusMode, readOnly: props.readOnly, ...callbacks }))
  return extensions
}

export function MarkdownEditor(props: MarkdownEditorProps): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const [contextError, setContextError] = useState('')
  const [resource, setResource] = useState<ViewedResource | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  const activeDocumentRef = useRef(props.documentId)
  const cacheRef = useRef(new Map<string, EditorState>())
  const compartmentRef = useRef(new Compartment())
  const pendingExternalRef = useRef<string | null>(null)
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
  })

  function editorConfiguration(current: MarkdownEditorProps): Extension[] {
    return configuration({ ...current, mode: current.mode === 'reading' ? 'source' : current.mode, readOnly: current.readOnly || current.mode === 'reading' }, callbacksRef.current)
  }

  function createState(current: MarkdownEditorProps): EditorState {
    return EditorState.create({
      doc: current.value,
      extensions: [
        history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
        markdown({ codeLanguages: codeLanguageForInfo, base: markdownLanguage }), syntaxHighlighting(editorHighlightStyle),
        highlightActiveLine(), search({ top: true }), folderSearchHighlight,
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
            const pending = pendingExternalRef.current
            pendingExternalRef.current = null
            if (pending !== null) setTimeout(() => {
              if (viewRef.current === view && pending !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pending }, annotations: EXTERNAL_UPDATE.of(true) })
            }, 0)
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
    const disposeContext = installEditorContext(view, () => propsRef.current, applyAction, setContextError, setResource)
    if (propsRef.current.mode !== 'reading') view.focus()
    return () => { disposeContext(); view.destroy(); viewRef.current = null; cacheRef.current.clear() }
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
  }, [props.documentId, props.mode, props.theme, props.fontSize, props.focusMode, props.typewriterMode, props.readOnly, props.lineNumbers, props.wrapLines, props.spellcheck])

  useEffect(() => {
    if (props.mode !== 'reading' && props.command && viewRef.current) applyAction(viewRef.current, props.command.action, props.command.value)
  }, [props.command?.id])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setFolderSearch.of(props.folderSearch ?? null) })
  }, [props.documentId, props.folderSearch])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !props.jumpToLine || props.mode === 'reading') return
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, props.jumpToLine.line)))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [props.jumpToLine?.id])

  const closeResource = useCallback((): void => {
    setResource(null)
    const view = viewRef.current
    if (view) { const top = view.scrollDOM.scrollTop; view.focus(); view.scrollDOM.scrollTop = top }
  }, [])
  useEffect(() => { setContextError(''); setResource(null) }, [props.documentId])
  useEffect(() => {
    if (!contextError) return
    const timeout = setTimeout(() => setContextError(''), 6000)
    return () => clearTimeout(timeout)
  }, [contextError])

  return <div className={`markdown-editor markdown-editor-${props.mode}${props.focusMode ? ' markdown-editor-focus' : ''}`} data-testid="markdown-editor">
    {contextError ? <div className="editor-context-error" role="alert">{contextError}<button type="button" aria-label="关闭提示" onClick={() => setContextError('')}>×</button></div> : null}
    <div className="editor-mount" ref={mountRef} hidden={props.mode === 'reading'} aria-hidden={props.mode === 'reading'} />
    {props.mode === 'reading' ? <ReadingView ref={readingRef} documentId={props.documentId} content={props.value} theme={props.theme} fontSize={props.fontSize} command={props.command} jumpToLine={props.jumpToLine} onLinkOpen={props.onLinkOpen} resolveResource={props.resolveResource} initialAnchor={readingSnapshotRef.current?.documentId === props.documentId ? readingSnapshotRef.current.anchor : null} /> : null}
    {resource ? <ResourceViewer resource={resource} onClose={closeResource} /> : null}
  </div>
}
