import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo, redo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { confirmCodeFence, fenceCreation, liveCodeBlocks } from './live-code'

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
