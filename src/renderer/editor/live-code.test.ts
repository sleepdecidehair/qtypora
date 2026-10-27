import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo, redo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { autoIndentSelectedCode, codeBlockDisplay, confirmCodeFence, fenceCreation, liveCodeBlocks, liveCodeExtension, setCodeBlockDisplay } from './live-code'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { createTextEdit } from './commands'

const state = (doc: string, cursor = doc.length): EditorState => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage }), history()] })

describe('Enter confirms Markdown code fences', () => {
  it.each(['```', '```js', '````python', '   ```'])('creates an empty body for %s without discarding its prefix', (prefix) => {
    const current = state(prefix)
    const transaction = fenceCreation(current)!
    const next = current.update(transaction).state
    expect(next.doc.toString()).toBe(`${prefix}\n\n${prefix.match(/^( {0,3}`{3,})/)![1]}`)
    expect(next.selection.main.head).toBe(prefix.length + 1)
    expect(liveCodeBlocks(next)).toHaveLength(1)
    expect(next.doc.sliceString(liveCodeBlocks(next)[0].bodyFrom, liveCodeBlocks(next)[0].bodyTo)).toBe('')
  })
  it.each(['`', '``', "'''", '‘‘‘', 'text ```', '> ```', '- ```', '    ```', '```\ninside\n```\n```'])('does not convert unrelated or nested text %s', (source) => {
    const cursor = source.startsWith('```\n') ? 3 : source.length
    expect(fenceCreation(state(source, cursor))).toBeNull()
  })
  it('does not create a fence while the cursor is inside an existing code body', () => {
    const current = state('````\n```\n````', 8)
    expect(fenceCreation(current)).toBeNull()
  })
  it('preserves unrelated paragraphs when creating a block in the middle', () => {
    const source = 'Before\n\n```js\n\nAfter'
    const current = state(source, source.indexOf('js') + 2)
    const next = current.update(fenceCreation(current)!).state
    expect(next.doc.toString()).toBe('Before\n\n```js\n\n```\n\nAfter')
  })
  it('requires an empty selection and an editable document', () => {
    expect(fenceCreation(state('```').update({ selection: EditorSelection.range(0, 3) }).state)).toBeNull()
    const readOnly = EditorState.create({ doc: '```', selection: { anchor: 3 }, extensions: [markdown(), EditorState.readOnly.of(true)] })
    expect(fenceCreation(readOnly)).toBeNull()
  })
  it('does not consume Enter while an input method is composing', () => {
    const current = state('```')
    let dispatched = false
    expect(confirmCodeFence({ state: current, composing: true, dispatch: () => { dispatched = true } })).toBe(false)
    expect(dispatched).toBe(false)
  })
  it('isolates conversion from typing so one undo restores the exact prefix and caret', () => {
    let current = state('')
    current = current.update({ changes: { from: 0, insert: '```' }, selection: { anchor: 3 }, userEvent: 'input.type' }).state
    expect(confirmCodeFence({ get state() { return current }, composing: false, dispatch: (...specs: readonly TransactionSpec[]) => { current = current.update(...specs).state } })).toBe(true)
    const target = { get state() { return current }, dispatch: (transaction: { state: EditorState }) => { current = transaction.state } }
    expect(undo(target)).toBe(true)
    expect(current.doc.toString()).toBe('```')
    expect(current.selection.main.head).toBe(3)
    expect(redo(target)).toBe(true)
    expect(current.doc.toString()).toBe('```\n\n```')
    expect(current.selection.main.head).toBe(4)
  })
  it('leaves Mermaid preview to its existing editor and ignores unclosed candidates', () => {
    expect(liveCodeBlocks(state('```mermaid\ngraph LR\nA-->B\n```'))).toEqual([])
    expect(liveCodeBlocks(state('```js\nunfinished'))).toEqual([])
  })
})

describe('per-block display options', () => {
  it('updates only the chosen block decorations when a display setting changes', () => {
    let current = EditorState.create({ doc: '```js\na\n```\n\n```js\nb\n```', extensions: [markdown({ base: markdownLanguage }), codeBlockDisplay, liveCodeExtension()] })
    const blocks = liveCodeBlocks(current)
    current = current.update({ effects: setCodeBlockDisplay.of({ from: blocks[0].from, display: { lineNumbers: true, wrapLines: false } }) }).state
    const classes: string[] = []
    for (const set of current.facet(EditorView.decorations)) if (typeof set !== 'function') (set as DecorationSet).between(0, current.doc.length, (_from, _to, value) => {
      if (typeof value.spec.class === 'string' && value.spec.class.includes('cm-live-code-body')) classes.push(value.spec.class)
    })
    expect(classes).toHaveLength(2)
    expect(classes[0]).toContain('cm-live-code-numbered')
    expect(classes[0]).toContain('cm-live-code-nowrap')
    expect(classes[1]).not.toContain('cm-live-code-numbered')
    expect(classes[1]).not.toContain('cm-live-code-nowrap')
  })
  it('refreshes the language control when same-length fence markers change', () => {
    const source = '```js\nbody\n```'
    let current = EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage }), codeBlockDisplay, liveCodeExtension()] })
    const widget = (state: EditorState) => {
      const found: import('@codemirror/view').WidgetType[] = []
      for (const set of state.facet(EditorView.decorations)) if (typeof set !== 'function') (set as DecorationSet).between(0, state.doc.length, (_from, _to, value) => {
        if (value.spec.widget) found.push(value.spec.widget)
      })
      expect(found).toHaveLength(1)
      return found[0]
    }
    const oldWidget = widget(current)
    current = current.update({ changes: [{ from: 0, to: 3, insert: '~~~' }, { from: source.length - 3, to: source.length, insert: '~~~' }] }).state
    expect(current.doc.toString()).toBe('~~~js\nbody\n~~~')
    expect(oldWidget.eq(widget(current))).toBe(false)
  })
  it('preserves source, maps the override across edits, and removes it when the block disappears', () => {
    const source = 'Intro\n\n```js\na\n```\n\n```js\nb\n```\n'
    let current = EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage }), codeBlockDisplay] })
    const [first, second] = liveCodeBlocks(current)
    current = current.update({ effects: setCodeBlockDisplay.of({ from: first.from, display: { lineNumbers: true, wrapLines: false } }) }).state
    expect(current.doc.toString()).toBe(source)
    expect(current.field(codeBlockDisplay).get(first.from)).toEqual({ lineNumbers: true, wrapLines: false })
    expect(current.field(codeBlockDisplay).has(second.from)).toBe(false)
    current = current.update({ changes: { from: 0, insert: 'new\n' } }).state
    const moved = liveCodeBlocks(current)[0]
    expect(current.field(codeBlockDisplay).get(moved.from)).toEqual({ lineNumbers: true, wrapLines: false })
    current = current.update({ changes: { from: moved.bodyFrom, to: moved.bodyTo, insert: 'edited' } }).state
    const edited = liveCodeBlocks(current)[0]
    expect(current.field(codeBlockDisplay).get(edited.from)?.lineNumbers).toBe(true)
    current = current.update({ changes: { from: edited.from, to: current.doc.line(edited.firstLine).to, insert: '```python' } }).state
    const renamed = liveCodeBlocks(current)[0]
    expect(current.field(codeBlockDisplay).get(renamed.from)?.lineNumbers).toBe(true)
    current = current.update({ changes: { from: renamed.from, to: renamed.to, insert: 'removed' } }).state
    expect(current.field(codeBlockDisplay).size).toBe(0)
  })
  it('supports restoring the global preference without changing source or history', () => {
    let current = EditorState.create({ doc: '```\nbody\n```', extensions: [markdown(), codeBlockDisplay, history()] })
    current = current.update({ effects: setCodeBlockDisplay.of({ from: 0, display: { lineNumbers: false } }) }).state
    current = current.update({ effects: setCodeBlockDisplay.of({ from: 0, display: {} }) }).state
    expect(current.field(codeBlockDisplay).size).toBe(0)
    expect(current.doc.toString()).toBe('```\nbody\n```')
    expect(undo({ state: current, dispatch: () => undefined })).toBe(false)
  })
})

describe('default code language modes', () => {
  it('applies the configured language to typed fences unless configured for menus only', () => {
    const create = (mode: 'both' | 'typed' | 'menu') => EditorState.create({ doc: '```', selection: { anchor: 3 }, extensions: [markdown(), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, defaultCodeLanguage: 'python', codeDefaultLanguageMode: mode })] })
    for (const mode of ['both', 'typed'] as const) expect(create(mode).update(fenceCreation(create(mode))!).state.doc.toString()).toBe('```python\n\n```')
    const menu = create('menu')
    expect(menu.update(fenceCreation(menu)!).state.doc.toString()).toBe('```\n\n```')
  })
  it('inserts a configured safe language through the normal source transaction', () => {
    const edit = createTextEdit('code', '', 0, 0, 'python')!
    expect(edit.insert).toBe('```python\n代码\n```\n')
    expect(edit.selection.anchor).toBe(10)
    expect(createTextEdit('code', '', 0, 0, 'bad\ntext')!.insert).toBe('```\n代码\n```\n')
  })
})

describe('optional Shift+Tab code formatting', () => {
  it('formats a selected code line in one undoable transaction without touching other blocks', () => {
    const source = 'before\n\n```js\nfunction f() {\nreturn 1\n}\n```\n\nafter'
    const start = source.indexOf('return 1')
    let current = EditorState.create({ doc: source, selection: { anchor: start, head: start + 8 }, extensions: [markdown({ base: markdownLanguage, codeLanguages: [LanguageDescription.of({ name: 'JavaScript', alias: ['js'], support: javascript() })] }), history(), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, codeShiftTabAutoIndent: true })] })
    const view = { get state() { return current }, composing: false, dispatch: (transaction: TransactionSpec) => { current = current.update(transaction).state } } as unknown as EditorView
    expect(autoIndentSelectedCode(view)).toBe(true)
    expect(current.doc.toString()).toBe(source.replace('return 1', '  return 1'))
    expect(undo(view)).toBe(true)
    expect(current.doc.toString()).toBe(source)
  })
  it('leaves Shift+Tab to the editor when disabled, composing, or outside a code block', () => {
    const current = state('```js\ncode\n```', 6)
    expect(autoIndentSelectedCode({ state: current, composing: false } as EditorView)).toBe(false)
    const enabled = EditorState.create({ doc: 'outside\n\n```js\ncode\n```', extensions: [markdown(), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, codeShiftTabAutoIndent: true })] })
    expect(autoIndentSelectedCode({ state: enabled, composing: false } as EditorView)).toBe(false)
    expect(autoIndentSelectedCode({ state: enabled, composing: true } as EditorView)).toBe(false)
  })
})
