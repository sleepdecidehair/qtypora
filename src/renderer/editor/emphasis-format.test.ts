import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { emphasisTransaction } from './emphasis-format'
import { markdownOptionsFacet } from './markdown-config'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'

function fixture(doc: string, anchor = 0, head = doc.length) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage }), history()] })
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
  return { view, get state() { return state }, apply(kind: 'bold' | 'italic' | 'strike') { const edit = emphasisTransaction(state, kind); if (edit) state = state.update(edit).state; return edit } }
}

describe('safe emphasis formatting', () => {
  it('keeps selected edge whitespace outside valid delimiters', () => {
    for (const [kind, text, expected] of [['bold', ' text ', ' **text** '], ['italic', ' text ', ' *text* '], ['strike', ' text ', ' ~~text~~ ']] as const) {
      const target = fixture(text)
      expect(target.apply(kind)).not.toBeNull()
      expect(target.state.doc.toString()).toBe(expected)
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('chooses a compatible delimiter when the content contains markers', () => {
    for (const [kind, text, expected] of [['bold', 'a**b', '__a**b__'], ['italic', 'a*b', '_a*b_']] as const) {
      const target = fixture(text)
      expect(target.apply(kind)).not.toBeNull()
      expect(target.state.doc.toString()).toBe(expected)
    }
    const conflicting = fixture('a~~b')
    expect(conflicting.apply('strike')).toBeNull()
    expect(conflicting.state.doc.toString()).toBe('a~~b')
  })
  it('preserves nested styles and toggles a complete selected style', () => {
    const nested = fixture('*word*')
    expect(nested.apply('bold')).not.toBeNull()
    expect(nested.state.doc.toString()).toBe('__*word*__')
    const original = 'before _legacy_\n中文 text\n<!-- untouched -->'
    const start = original.indexOf('中文')
    const target = fixture(original, start, start + 2)
    expect(target.apply('bold')).not.toBeNull()
    expect(target.state.doc.toString()).toBe('before _legacy_\n**中文** text\n<!-- untouched -->')
    expect(target.apply('bold')).not.toBeNull()
    expect(target.state.doc.toString()).toBe(original)
    const multiline = fixture('one\ntwo')
    expect(multiline.apply('bold')).not.toBeNull()
    expect(multiline.state.doc.toString()).toBe('**one\ntwo**')
    const strike = fixture('*word*')
    expect(strike.apply('strike')).not.toBeNull()
    expect(strike.state.doc.toString()).toBe('~~*word*~~')
    expect(strike.apply('strike')).not.toBeNull()
    expect(strike.state.doc.toString()).toBe('*word*')
  })
  it('keeps reverse selection and rejects all-space and ambiguous multiline selection', () => {
    const target = fixture(' text ', 6, 0)
    expect(target.apply('bold')).not.toBeNull()
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head)
    expect(fixture('  ').apply('italic')).toBeNull()
    expect(fixture('one\n\ntwo').apply('bold')).toBeNull()
    expect(fixture('**# heading**').apply('bold')).toBeNull()
  })
  it('formats a safe single paragraph once a large document is fully parsed', () => {
    const doc = `${'text\n\n'.repeat(34000)}hello`
    const target = fixture(doc, doc.length - 5, doc.length)
    expect(ensureSyntaxTree(target.state, doc.length, 10000)?.length).toBe(doc.length)
    expect(target.apply('bold')).not.toBeNull()
    expect(target.state.doc.toString().endsWith('**hello**')).toBe(true)
  })
  it('does not insert unsupported strike syntax in strict mode', () => {
    const state = EditorState.create({ doc: 'text', selection: { anchor: 0, head: 4 }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true })] })
    expect(emphasisTransaction(state, 'strike')).toBeNull()
    expect(state.doc.toString()).toBe('text')
  })
})
