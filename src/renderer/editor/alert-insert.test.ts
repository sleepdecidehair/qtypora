import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { insertAlert } from './alert-insert'

function state(doc: string, anchor: number, options: { readOnly?: boolean; enabled?: boolean; strict?: boolean; head?: number } = {}) {
  return EditorState.create({ doc, selection: EditorSelection.range(anchor, options.head ?? anchor), extensions: [markdown(), history(), EditorState.readOnly.of(!!options.readOnly), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, alerts: options.enabled ?? true, strictMode: !!options.strict })] })
}
describe('insert alert on a top-level empty line', () => {
  it.each(['note', 'tip', 'important', 'warning', 'caution'] as const)('inserts %s and undoes in one step', type => {
    const original = 'before\n\nafter'
    let current = state(original, 7)
    const transaction = insertAlert(current, type)!
    expect(transaction).not.toBeNull()
    current = current.update(transaction).state
    expect(current.doc.toString()).toBe(`before\n\n> [!${type.toUpperCase()}]\n> \n\nafter`)
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
  })
  it('rejects disabled, readonly, selected and nonblank content', () => {
    expect(insertAlert(state('', 0, { enabled: false }), 'note')).toBeNull()
    expect(insertAlert(state('', 0, { strict: true }), 'note')).toBeNull()
    expect(insertAlert(state('', 0, { readOnly: true }), 'note')).toBeNull()
    expect(insertAlert(state('abc', 0, { head: 1 }), 'note')).toBeNull()
    expect(insertAlert(state('**bold**', 4), 'note')).toBeNull()
  })
  it.each([0, 2, 5])('splits a plain paragraph at position %i and undoes exactly', position => {
    const original = 'hello'
    let current = state(original, position)
    current = current.update(insertAlert(current, 'note')!).state
    const expected = position === 0 ? '> [!NOTE]\n> \n\nhello' : position === 5 ? 'hello\n\n> [!NOTE]\n> ' : 'he\n\n> [!NOTE]\n> \n\nllo'
    expect(current.doc.toString()).toBe(expected)
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
  })
  it('refuses ambiguous syntax and grapheme splits', () => {
    for (const doc of ['a *b*', 'a 1. item', 'a # heading', 'a &amp; b', 'x    y']) expect(insertAlert(state(doc, 2), 'note'), doc).toBeNull()
    expect(insertAlert(state('a👩‍👩‍👦b', 2), 'note')).toBeNull()
  })
  it('only splits hyphenated text when both fragments remain plain paragraphs', () => {
    const original = 'hello-world'
    let current = state(original, 5)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe('hello\n\n> [!NOTE]\n> \n\n-world')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
    expect(insertAlert(state('hello - world', 5), 'note')).toBeNull()
    expect(insertAlert(state('a👩‍👩‍👦-b', 2), 'note')).toBeNull()
  })
  it('splits ordinary hash text but refuses a generated heading', () => {
    const original = 'C# language'
    let current = state(original, 2)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe('C#\n\n> [!NOTE]\n> \n\n language')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
    expect(insertAlert(state('Hello # title', 6), 'note')).toBeNull()
    expect(insertAlert(state('# heading', 2), 'note')).toBeNull()
  })
  it('splits ordinary version numbers but refuses a generated ordered list', () => {
    const original = 'Version 2.0'
    let current = state(original, 10)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe('Version 2.\n\n> [!NOTE]\n> \n\n0')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
    expect(insertAlert(state('hello 1. item', 6), 'note')).toBeNull()
  })
  it('rejects splitting enabled emoji while allowing ordinary Chinese', () => {
    const doc = 'hello :smile: text'
    expect(insertAlert(state(doc, 9), 'note')).toBeNull()
    const plain = '你好世界'
    let current = state(plain, 2)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe('你好\n\n> [!NOTE]\n> \n\n世界')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(plain)
    const disabled = EditorState.create({ doc, selection: { anchor: 9 }, extensions: [markdown(), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, alerts: true, emoji: false })] })
    expect(insertAlert(disabled, 'note')).not.toBeNull()
  })
  it('preserves whitespace on the original empty line', () => {
    const original = 'before\n  \nafter'
    const current = state(original, original.indexOf('  ') + 1)
    expect(current.update(insertAlert(current, 'note')!).state.doc.toString()).toBe('before\n\n> [!NOTE]\n> \n  \nafter')
  })
  it('changes or removes a canonical alert while preserving body, selection and undo', () => {
    const original = 'before\n\n> [!NOTE]\n> body text\n\nafter'
    const from = original.indexOf('body'), to = from + 4
    let current = state(original, from, { head: to })
    current = current.update(insertAlert(current, 'warning')!).state
    expect(current.doc.toString()).toBe(original.replace('[!NOTE]', '[!WARNING]'))
    expect(current.sliceDoc(current.selection.main.from, current.selection.main.to)).toBe('body')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe(original.replace('> [!NOTE]\n', ''))
    expect(current.sliceDoc(current.selection.main.from, current.selection.main.to)).toBe('body')
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
  })
  it('changes an empty alert type while preserving its caret and undo', () => {
    const original = '> [!NOTE]\n> '
    let current = state(original, original.length)
    current = current.update(insertAlert(current, 'warning')!).state
    expect(current.doc.toString()).toBe('> [!WARNING]\n> ')
    expect(current.selection.main.head).toBe(current.doc.length)
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
    current = current.update(insertAlert(current, 'note')!).state
    expect(current.doc.toString()).toBe('> ')
    expect(current.selection.main.head).toBe(2)
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
  })
  it('refuses to change nested alerts', () => {
    const doc = '> [!NOTE]\n> > nested'
    expect(insertAlert(state(doc, doc.length), 'warning')).toBeNull()
  })
  it('rejects empty lines in code, lists, HTML, YAML, and math', () => {
    for (const doc of ['```\n\n```', '- item\n  \n  - child', '<!--\n\n-->', '---\na: b\n\n---', '---\na: b\n\nunfinished', '$$\nx\n\n$$']) {
      expect(insertAlert(state(doc, doc.indexOf('\n\n') + 1), 'note'), doc).toBeNull()
    }
  })
})
