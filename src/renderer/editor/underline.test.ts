import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { toggleUnderline, underlineRanges } from './underline'
import { inlinePreviewSpans } from './live-inline'

function create(doc: string, from: number, to = from, readOnly = false) {
  return EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
}

describe('underline editing and preview', () => {
  it('wraps a selection without changing surrounding Markdown and undoes in one step', () => {
    let state = create('前 **粗体** 后', 2, 8)
    state = state.update(toggleUnderline(state)!).state
    expect(state.doc.toString()).toBe('前 <u>**粗体**</u> 后')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe('前 **粗体** 后')
  })
  it('removes a whole existing underline without replacing its contents', () => {
    const state = create('a <u>**bold**</u> z', 5, 13)
    const next = state.update(toggleUnderline(state)!).state
    expect(next.doc.toString()).toBe('a **bold** z')
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe('**bold**')
  })
  it('toggles an existing underline from a caret and preserves its relative location', () => {
    const state = create('<u>abc</u>', 5)
    const next = state.update(toggleUnderline(state)!).state
    expect(next.doc.toString()).toBe('abc')
    expect(next.selection.main.head).toBe(2)
  })
  it('refuses partial styles, code, cross-line selections and read-only documents', () => {
    expect(toggleUnderline(create('**bold** rest', 3, 10))).toBeNull()
    expect(toggleUnderline(create('`code`', 1, 5))).toBeNull()
    expect(toggleUnderline(create('one\ntwo', 0, 7))).toBeNull()
    expect(toggleUnderline(create('text', 0, 4, true))).toBeNull()
    expect(toggleUnderline(create('<u>hello</u>', 4, 6))).toBeNull()
  })
  it('does not split escaped punctuation, custom inline syntax or Unicode surrogate pairs', () => {
    expect(toggleUnderline(create('\\*', 1, 2))).toBeNull()
    expect(toggleUnderline(create('Text $x + y$ rest', 7, 8))).toBeNull()
    expect(toggleUnderline(create('==highlight==', 2, 5))).toBeNull()
    expect(toggleUnderline(create('H~2~O', 2, 3))).toBeNull()
    expect(toggleUnderline(create('x^2^', 2, 3))).toBeNull()
    expect(toggleUnderline(create('A😀B', 1, 2))).toBeNull()
  })
  it('pairs nested underline tags without affecting escaped or multiline tags', () => {
    const source = '<u>a <u>b</u> c</u>'
    expect(underlineRanges(create(source, 0))).toEqual([
      { from: 5, contentFrom: 8, contentTo: 9, to: 13 },
      { from: 0, contentFrom: 3, contentTo: 15, to: 19 },
    ])
    expect(underlineRanges(create('<u>one\ntwo</u>', 0))).toEqual([])
  })
  it('removes the innermost nested underline and restores both tags on undo', () => {
    const source = '<u>a <u>b</u> c</u>'
    let state = create(source, 8)
    state = state.update(toggleUnderline(state)!).state
    expect(state.doc.toString()).toBe('<u>a b c</u>')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })
  it('only recognizes actual paired inline tags and leaves code and escaped tags visible', () => {
    expect(underlineRanges(create('`<u>code</u>`', 0))).toEqual([])
    expect(underlineRanges(create('\\<u>x</u>', 0))).toEqual([])
    const doc = '<u>**bold**</u> and <u>text</u>'
    const spans = inlinePreviewSpans(create(doc, 0, doc.length))
    expect(spans).toContainEqual({ from: 3, to: 11, className: 'cm-live-underline' })
    expect(spans).toContainEqual({ from: 0, to: 3, hidden: true })
    expect(spans).toContainEqual({ from: 11, to: 15, hidden: true })
    expect(spans).toContainEqual({ from: 23, to: 27, className: 'cm-live-underline' })
  })
})
