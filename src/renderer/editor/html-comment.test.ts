import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { toggleHtmlComment } from './html-comment'

function create(doc: string, from: number, to = from, readOnly = false) {
  return EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
}

describe('HTML comment format', () => {
  it('comments an exact plain selection and restores it in one undo', () => {
    const original = '前 保留文字 后'
    let state = create(original, 2, 6)
    state = state.update(toggleHtmlComment(state)!).state
    expect(state.doc.toString()).toBe('前 <!--保留文字--> 后')
    expect(state.doc.sliceString(state.selection.main.from, state.selection.main.to)).toBe('保留文字')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
  it('unwraps a whole selected comment or exactly its body', () => {
    const source = '前 <!--文字--> 后'
    for (const [from, to] of [[2, 11], [6, 8]] as const) {
      const state = create(source, from, to)
      expect(state.update(toggleHtmlComment(state)!).state.doc.toString()).toBe('前 文字 后')
    }
  })
  it('refuses unsafe syntax, partial comments, empty selections and partial graphemes', () => {
    for (const [source, from, to] of [['**bold**', 2, 6], ['`code`', 1, 5], ['[label](url)', 1, 6], ['&amp;', 1, 4], ['a--b', 0, 4], ['one\ntwo', 0, 7], ['e\u0301', 0, 1], ['<!--文字-->', 5, 6], ['> text', 0, 6]] as const) {
      expect(toggleHtmlComment(create(source, from, to))).toBeNull()
    }
    expect(toggleHtmlComment(create('text', 0))).toBeNull()
    expect(toggleHtmlComment(create('text', 0, 4, true))).toBeNull()
    expect(toggleHtmlComment(create('e\u0301', 0, 2))).not.toBeNull()
  })
})
