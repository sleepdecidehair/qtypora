import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { underlineMultiline } from './underline-multiline'
import { inlinePreviewSpans } from './live-inline'

const create = (doc: string, anchor: number, head: number, readOnly = false) => EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })

describe('underline multiline plain paragraph', () => {
  it('wraps each selected line and preserves source outside it', () => {
    const source = '前文 first\nsecond 后文'
    let state = create(source, 3, source.indexOf(' 后文'))
    state = state.update(underlineMultiline(state)!).state
    expect(state.doc.toString()).toBe('前文 <u>first</u>\n<u>second</u> 后文')
    expect(inlinePreviewSpans(state).filter(span => span.className === 'cm-live-underline')).toHaveLength(2)
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })
  it('preserves indentation and direction with Unicode text', () => {
    const source = '甲😀乙\n  丙丁'
    const state = create(source, source.length, 0)
    const next = state.update(underlineMultiline(state)!).state
    expect(next.doc.toString()).toBe('<u>甲😀乙</u>\n  <u>丙丁</u>')
    expect(next.selection.main.anchor).toBeGreaterThan(next.selection.main.head)
  })
  it('rejects nested blocks, multiple paragraphs, markup, math and read-only documents', () => {
    for (const text of ['one\n\ntwo', '- one\n  two', '> one\n> two', 'one\n**bold**', 'one\n$x$', 'one\n`code`', 'one\n<u>two</u>']) expect(underlineMultiline(create(text, 0, text.length))).toBeNull()
    expect(underlineMultiline(create('one\ntwo', 0, 7, true))).toBeNull()
  })
  it('rejects selections that split surrogate pairs', () => {
    const source = 'a😀b\nc'
    expect(underlineMultiline(create(source, 2, source.length))).toBeNull()
  })
})
