import { describe, expect, it } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo, redo } from '@codemirror/commands'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { markdownInputTransaction, markdownPairBackspace, markdownPairs } from './markdown-input'

function create(doc = '', anchor = doc.length, options = DEFAULT_MARKDOWN_OPTIONS): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions: [history(), markdown({ base: markdownLanguage }), markdownOptionsFacet.of(options), markdownPairs] })
}
function type(state: EditorState, text: string): EditorState {
  for (const character of text) {
    const { from, to } = state.selection.main
    state = state.update(markdownInputTransaction(state, from, to, character) ?? { changes: { from, to, insert: character }, selection: { anchor: from + character.length }, userEvent: 'input.type' }).state
  }
  return state
}

describe('typed Markdown pairing source transactions', () => {
  it('pairs empty emphasis, grows bold, and advances through only the auto-inserted closing markers', () => {
    let state = type(create('before '), '*')
    expect(state.doc.toString()).toBe('before **')
    expect(state.selection.main.head).toBe(8)
    state = type(state, '*bold**')
    expect(state.doc.toString()).toBe('before **bold**')
    expect(state.selection.main.head).toBe(state.doc.length)
    expect(state.field(markdownPairs)).toHaveLength(0)
    expect(type(create('*existing*', 9), '*').doc.toString()).toBe('*existing**')
  })
  it('keeps triple backticks and double dollar block triggers without extra closers', () => {
    expect(type(create(), '```typescript').doc.toString()).toBe('```typescript')
    expect(type(create(), '$$').doc.toString()).toBe('$$')
    expect(type(create(), '* item').doc.toString()).toBe('* item')
    expect(type(create('text '), '`code`').doc.toString()).toBe('text `code`')
  })
  it('pairs highlight only after the second equals sign and leaves equations and intraword punctuation alone', () => {
    expect(type(create('x '), '=').doc.toString()).toBe('x =')
    expect(type(create(), '==highlight==').doc.toString()).toBe('==highlight==')
    expect(type(create('snake'), '_').doc.toString()).toBe('snake_')
    expect(type(create('10'), '$').doc.toString()).toBe('10$')
    expect(type(create('H'), '~2~').doc.toString()).toBe('H~2~')
  })
  it('supports pair deletion, undo, redo and selected text wrapping through source transactions', () => {
    let state = type(create('prefix '), '_')
    const dispatch = (transaction: Transaction) => { state = transaction.state }
    expect(undo({ state, dispatch })).toBe(true)
    expect(state.doc.toString()).toBe('prefix ')
    expect(redo({ state, dispatch })).toBe(true)
    expect(state.doc.toString()).toBe('prefix __')
    state = type(create('prefix '), '_')
    const remove = markdownPairBackspace(state)
    expect(remove).not.toBeNull()
    state = state.update(remove!).state
    expect(state.doc.toString()).toBe('prefix ')
    state = create('unchanged word tail').update({ selection: { anchor: 10, head: 14 } }).state
    state = type(state, '*')
    expect(state.doc.toString()).toBe('unchanged *word* tail')
    expect(state.doc.sliceString(state.selection.main.from, state.selection.main.to)).toBe('word')
  })
  it('does not intercept paste, escaped markers, URLs, HTML, YAML or code contexts', () => {
    expect(markdownInputTransaction(create(), 0, 0, '**paste**')).toBeNull()
    for (const doc of ['\\', 'https://example.test/', '<a href="test">', '```js\nvalue', '---\ntitle: value\n---']) {
      const at = doc.startsWith('---') ? doc.indexOf('value') + 5 : doc.length
      expect(markdownInputTransaction(create(doc, at), at, at, '*'), doc).toBeNull()
    }
    const doc = '`literal`'
    expect(markdownInputTransaction(create(doc, 5), 5, 5, '*')).toBeNull()
  })
  it('respects disabled pairing and effective strict syntax settings', () => {
    expect(type(create('', 0, { ...DEFAULT_MARKDOWN_OPTIONS, autoPairMarkdown: false }), '*').doc.toString()).toBe('*')
    expect(type(create('', 0, { ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true }), '$').doc.toString()).toBe('$')
    expect(type(create('', 0, { ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true }), '*word*').doc.toString()).toBe('*word*')
  })
})
