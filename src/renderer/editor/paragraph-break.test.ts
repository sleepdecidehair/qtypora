import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { createMarkdownParser } from './markdown-parser'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { paragraphBreak } from './paragraph-break'

const create = (doc: string, position: number, readOnly = false, head = position) => EditorState.create({ doc, selection: EditorSelection.range(position, head), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })

describe('live preview paragraph break', () => {
  it('splits plain text and restores the entire original in one undo', () => {
    const original = '前😀文后'
    let state = create(original, 3)
    const edit = paragraphBreak(state, 'hybrid')
    if (!edit || edit === 'blocked') throw new Error('Expected paragraph transaction')
    state = state.update(edit).state
    expect(state.doc.toString()).toBe('前😀\n\n文后')
    expect(state.selection.main.head).toBe(5)
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
  it('leaves source mode, code, lists, quotes, selection and read-only to their existing behavior', () => {
    expect(paragraphBreak(create('onetwo', 3), 'source')).toBeNull()
    for (const [doc, position] of [['```js\ncode\n```', 7], ['- one', 3], ['> one', 3], ['---\ntitle: x\n---', 8], ['text **bold**', 9]] as const) expect(paragraphBreak(create(doc, position), 'hybrid')).toBeNull()
    expect(paragraphBreak(create('onetwo', 1, true), 'hybrid')).toBeNull()
    expect(paragraphBreak(create('onetwo', 0, false, 3), 'hybrid')).toBeNull()
  })
  it('replaces the existing soft break from either side and undoes in one step', () => {
    for (const position of [3, 4]) {
      let state = create('one\ntwo', position)
      const edit = paragraphBreak(state, 'hybrid')
      if (!edit || edit === 'blocked') throw new Error('Expected paragraph transaction')
      state = state.update(edit).state
      expect(state.doc.toString()).toBe('one\n\ntwo')
      expect(state.selection.main.head).toBe(5)
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe('one\ntwo')
    }
  })
  it('consumes Enter inside an entity without modifying it', () => {
    for (const doc of ['A&amp;B', 'A&#123;B', 'A&#x1f600;B']) expect(paragraphBreak(create(doc, 3), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('> A&amp;B', 5), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('- A&amp;B', 5), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('`A&amp;B`', 4), 'hybrid')).toBeNull()
    expect(paragraphBreak(create('```\nA&amp;B\n```', 7), 'hybrid')).toBeNull()
    const escaped = create('A\\&amp;B', 4)
    const edit = paragraphBreak(escaped, 'hybrid')
    if (!edit || edit === 'blocked') throw new Error('Expected paragraph transaction for escaped text')
    expect(escaped.update(edit).state.doc.toString()).toBe('A\\&a\n\nmp;B')
    expect(paragraphBreak(create('A\\\\&amp;B', 5), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('A&amp;B', 3), 'source')).toBeNull()
  })
  it('blocks positions inside Unicode grapheme clusters in preview mode', () => {
    for (const [doc, position] of [['A😀B', 2], ['Ae\u0301B', 2], ['> A😀B', 4], ['- Ae\u0301B', 4]] as const) expect(paragraphBreak(create(doc, position), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('A😀' + 'x'.repeat(200001), 2), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('A&amp;' + 'x'.repeat(200001), 3), 'hybrid')).toBe('blocked')
    expect(paragraphBreak(create('```\nA&amp;B\n```\n\n' + 'x'.repeat(200001), 7), 'hybrid')).toBeNull()
  })
  it('replaces an ordinary selection with a paragraph break and restores reversed selection on undo', () => {
    for (const [anchor, head] of [[2, 4], [4, 2]]) {
      let state = create('onetwo', anchor, false, head)
      const edit = paragraphBreak(state, 'hybrid')
      if (!edit || edit === 'blocked') throw new Error('Expected paragraph transaction')
      state = state.update(edit).state
      expect(state.doc.toString()).toBe('on\n\nwo')
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe('onetwo')
      expect(state.selection.main.anchor).toBe(anchor)
      expect(state.selection.main.head).toBe(head)
    }
  })
  it('does not replace selections that touch syntax, structures, lines or grapheme interiors', () => {
    for (const [doc, from, to] of [['A **bold** end', 3, 8], ['A $x+y$ end', 4, 5], ['A &amp; end', 3, 5], ['A😀BC', 2, 4], ['> quoted', 3, 5], ['ab\ncd', 1, 4]] as const) expect(paragraphBreak(create(doc, from, false, to), 'hybrid')).toBeNull()
  })
  it('protects enabled extension syntax but leaves literal or disabled syntax editable', () => {
    for (const [doc, position] of [['A $x+y$ B', 4], ['A $x\\$y$ B', 7], ['A ==highlight== B', 5], ['A ~sub~ B', 4], ['A ^sup^ B', 4], ['> A $x+y$ B', 6], ['- A ==mark== B', 7]] as const) expect(paragraphBreak(create(doc, position), 'hybrid')).toBe('blocked')
    for (const [doc, position] of [['`$x+y$`', 3], ['```\n==mark==\n```', 7], ['A \\$x+y$ B', 5]] as const) expect(paragraphBreak(create(doc, position), 'hybrid')).not.toBe('blocked')
    for (const settings of [{ ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true }, { ...DEFAULT_MARKDOWN_OPTIONS, inlineMath: false }]) {
      const state = EditorState.create({ doc: 'A $x+y$ B', selection: { anchor: 4 }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(settings)] })
      expect(paragraphBreak(state, 'hybrid')).not.toBe('blocked')
    }
  })
  it('protects multiline inline math without altering the source or undo history', () => {
    const doc = 'Before $x.\ny$ after.'
    const parser = createMarkdownParser()
    const types = (text: string) => parser.parse(text, {}).flatMap(token => token.children ?? []).map(token => token.type)
    expect(types(doc)).toContain('math_inline')
    expect(types(doc.replace('\n', '\n\n'))).not.toContain('math_inline')
    for (const position of [doc.indexOf('x'), doc.indexOf('y')]) {
      const state = create(doc, position)
      expect(paragraphBreak(state, 'hybrid')).toBe('blocked')
      expect(state.doc.toString()).toBe(doc)
      const target = { state, dispatch: () => { throw new Error('unexpected transaction') } }
      expect(undo(target as never)).toBe(false)
    }
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('y') }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, inlineMath: false })] })
    expect(paragraphBreak(state, 'hybrid')).not.toBe('blocked')
  })
})
