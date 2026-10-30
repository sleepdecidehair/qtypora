import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { insertReferenceLink } from './footnote-insert'
import { markdownDocumentModel } from './markdown-config'

function create(doc: string, from: number, to: number, readOnly = false) {
  return EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
}

describe('insert reference link', () => {
  it('rejects partial HTML entities while permitting an intact entity', () => {
    const source = 'A &amp; B'
    expect(insertReferenceLink(create(source, 3, 6), 'https://example.com')).toBeNull()
    expect(insertReferenceLink(create(source, 0, 4), 'https://example.com')).toBeNull()
    const state = create(source, 2, 7)
    const next = state.update(insertReferenceLink(state, 'https://example.com')!).state
    expect(next.doc.toString()).toBe('A [&amp;][ref1] B\n\n[ref1]: <https://example.com>')
  })
  it('wraps selected text and appends a definition without changing other source', () => {
    const state = create('before 选中 after', 7, 9)
    const next = state.update(insertReferenceLink(state, 'https://example.com/path')!).state
    expect(next.doc.toString()).toBe('before [选中][ref1] after\n\n[ref1]: <https://example.com/path>')
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe('选中')
    expect(markdownDocumentModel(next).parser.render(next.doc.toString())).toContain('href="https://example.com/path"')
  })
  it('inserts at document end and avoids duplicate labels', () => {
    const doc = '[ref1]: https://example.org\n\n文字'
    const state = create(doc, doc.length - 2, doc.length)
    const next = state.update(insertReferenceLink(state, 'https://example.com')!).state
    expect(next.doc.toString()).toBe('[ref1]: https://example.org\n\n[文字][ref2]\n\n[ref2]: <https://example.com>')
  })
  it('rejects unsafe destinations, markup, code, existing links and read-only state', () => {
    expect(insertReferenceLink(create('text', 0, 4), 'javascript:alert(1)')).toBeNull()
    expect(insertReferenceLink(create('text', 0, 4), 'https://a b')).toBeNull()
    expect(insertReferenceLink(create('text', 0, 4), 'https://example.com/\\')).toBeNull()
    expect(insertReferenceLink(create('`code`', 1, 5), 'https://example.com')).toBeNull()
    expect(insertReferenceLink(create('[label](url)', 1, 6), 'https://example.com')).toBeNull()
    expect(insertReferenceLink(create('text', 0, 4, true), 'https://example.com')).toBeNull()
    expect(insertReferenceLink(create('before\n\n```\ncode', 0, 6), 'https://example.com')).toBeNull()
  })
  it('undoes wrapping and definition together', () => {
    const original = '文字'
    let state = create(original, 0, 2)
    state = state.update(insertReferenceLink(state, 'https://example.com')!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
})
