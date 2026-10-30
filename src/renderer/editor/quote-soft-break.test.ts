import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { createMarkdownParser } from './markdown-parser'
import { quoteSoftBreak } from './quote-soft-break'

const create = (doc: string, position: number, readOnly = false) => EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })

describe('soft line break in a blockquote', () => {
  it('preserves explicit nesting and restores the source in one undo', () => {
    for (const [doc, expected] of [['> first', '> first\n> '], ['> > first', '> > first\n> > ']] as const) {
      let state = create(doc, doc.length)
      const edit = quoteSoftBreak(state, 'hybrid')
      if (!edit || edit === 'blocked') throw new Error('Expected quote break')
      state = state.update(edit).state
      expect(state.doc.toString()).toBe(expected)
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(doc)
    }
  })
  it('keeps subsequent heading syntax inside the quote', () => {
    const state = create('> first', 7)
    const edit = quoteSoftBreak(state, 'hybrid')
    if (!edit || edit === 'blocked') throw new Error('Expected quote break')
    const next = state.update(edit).state
    const source = next.update({ changes: { from: next.selection.main.head, insert: '# heading' } }).state.doc.toString()
    const tokens = createMarkdownParser().parse(source, {})
    expect(tokens.find(token => token.type === 'heading_open')?.level).toBe(1)
    expect(source).toBe('> first\n> # heading')
  })
  it('preserves source and code/list behavior, and refuses broken entity positions', () => {
    for (const [doc, position] of [['> - first', 9], ['> ```\n> code\n> ```', 10], ['> `code`', 5], ['> first\n> next', 7]] as const) expect(quoteSoftBreak(create(doc, position), 'hybrid')).toBeNull()
    expect(quoteSoftBreak(create('> first', 7), 'source')).toBeNull()
    expect(quoteSoftBreak(create('> first', 7, true), 'hybrid')).toBeNull()
    expect(quoteSoftBreak(create('> A&amp;B', 5), 'hybrid')).toBe('blocked')
  })
})
