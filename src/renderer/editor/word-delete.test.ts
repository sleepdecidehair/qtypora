import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { deleteCurrentWord } from './word-delete'

const state = (doc: string, anchor: number, readOnly = false) => EditorState.create({ doc, selection: { anchor }, extensions: [history(), EditorState.readOnly.of(readOnly)] })

describe('delete current word', () => {
  it('removes only the word at the caret and retains surrounding whitespace and Markdown', () => {
    const input = 'before **hello**  after'
    const current = state(input, input.indexOf('hello') + 2)
    const next = current.update(deleteCurrentWord(current)!).state
    expect(next.doc.toString()).toBe('before ****  after')
    expect(next.selection.main.head).toBe(input.indexOf('hello'))
  })
  it('does not delete spaces or punctuation when no word is at the caret', () => {
    expect(deleteCurrentWord(state('foo   bar', 4))).toBeNull()
    expect(deleteCurrentWord(state('!!!', 1))).toBeNull()
  })
  it('uses CodeMirror Unicode word boundaries', () => {
    const input = '你好 世界 😀 test'
    const current = state(input, 1)
    const range = current.wordAt(1)!
    const next = current.update(deleteCurrentWord(current)!).state
    expect(next.doc.toString()).toBe(input.slice(0, range.from) + input.slice(range.to))
  })
  it('does not mutate read-only documents or replace a selection', () => {
    expect(deleteCurrentWord(state('hello', 2, true))).toBeNull()
    const selected = EditorState.create({ doc: 'hello world', selection: { anchor: 0, head: 5 } })
    expect(deleteCurrentWord(selected)).toBeNull()
  })
  it('restores the exact source in one undo', () => {
    let current = state('one 中文 two', 5)
    current = current.update(deleteCurrentWord(current)!).state
    const target = { get state() { return current }, dispatch(spec: Parameters<typeof current.update>[0]) { current = current.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(current.doc.toString()).toBe('one 中文 two')
  })
})
