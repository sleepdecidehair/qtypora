import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { toggleExtendedInline, type ExtendedInlineKind } from './extended-inline'

function create(doc: string, from: number, to = from, options = DEFAULT_MARKDOWN_OPTIONS, readOnly = false): EditorState {
  return EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(options), EditorState.readOnly.of(readOnly), history()] })
}

describe('extended inline format commands', () => {
  for (const [kind, delimiter] of [['highlight', '=='], ['superscript', '^'], ['subscript', '~']] as const) {
    it(`toggles ${kind} around an exact selection and restores it in one undo`, () => {
      const source = '前 文本 后'
      let state = create(source, 2, 4)
      const edit = toggleExtendedInline(state, kind)!
      state = state.update(edit).state
      expect(state.doc.toString()).toBe(`前 ${delimiter}文本${delimiter} 后`)
      expect(state.doc.sliceString(state.selection.main.from, state.selection.main.to)).toBe('文本')
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(source)
    })
    it(`removes ${kind} at the caret without affecting its text`, () => {
      const source = `前 ${delimiter}文字${delimiter} 后`
      const state = create(source, 2 + delimiter.length + 1)
      expect(state.update(toggleExtendedInline(state, kind)!).state.doc.toString()).toBe('前 文字 后')
    })
  }
  it('respects extension settings, strict mode and read-only state', () => {
    for (const kind of ['highlight', 'superscript', 'subscript'] as ExtendedInlineKind[]) {
      expect(toggleExtendedInline(create('文本', 0, 2, { ...DEFAULT_MARKDOWN_OPTIONS, [kind]: false }), kind)).toBeNull()
      expect(toggleExtendedInline(create('文本', 0, 2, { ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true }), kind)).toBeNull()
      expect(toggleExtendedInline(create('文本', 0, 2, DEFAULT_MARKDOWN_OPTIONS, true), kind)).toBeNull()
    }
  })
  it('refuses nested syntax, code, metadata, partial spans and invalid Unicode ranges', () => {
    for (const [source, from, to] of [['**bold**', 2, 6], ['`code`', 1, 5], ['[link](url)', 1, 5], ['&amp;', 1, 4], ['---\ntitle: test\n---', 5, 10], ['==one two==', 3, 5], ['A😀B', 1, 2], ['a\nb', 0, 3]] as const) {
      expect(toggleExtendedInline(create(source, from, to), 'highlight')).toBeNull()
    }
    expect(toggleExtendedInline(create('word with spaces', 0, 16), 'superscript')).toBeNull()
    expect(toggleExtendedInline(create('$formula$', 1, 3), 'subscript')).toBeNull()
  })
  it('does not split combining sequences or emoji grapheme clusters', () => {
    for (const kind of ['highlight', 'superscript', 'subscript'] as ExtendedInlineKind[]) {
      for (const [source, from, to] of [['e\u0301', 0, 1], ['✈️', 0, 1], ['👩‍💻', 0, 2]] as const) {
        expect(toggleExtendedInline(create(source, from, to), kind)).toBeNull()
        expect(toggleExtendedInline(create(source, 0, source.length), kind)).not.toBeNull()
      }
    }
  })
})
