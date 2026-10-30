import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { markdownInputTransaction, markdownPairs } from './markdown-input'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})
const prefix = 'text\n\n'.repeat(1800)
const create = (doc: string) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), markdownPairs, history()] })

describe('auto-pair after incremental parsing', () => {
  it('inserts only the typed character inside late code and undoes it', () => {
    const original = prefix + '```js\nconst x = '
    let state = create(original)
    const position = state.selection.main.head
    expect(markdownInputTransaction(state, position, position, '*')).toBeNull()
    state = state.update({ changes: { from: position, insert: '*' }, userEvent: 'input.type' }).state
    expect(state.doc.toString()).toBe(original + '*')
    const target = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
  it('still pairs ordinary text after the parse completes', () => {
    const original = prefix + 'last '
    const state = create(original), position = state.selection.main.head
    const edit = markdownInputTransaction(state, position, position, '*')
    if (!edit) throw new Error('Expected auto pair')
    expect(state.update(edit).state.doc.toString()).toBe(original + '**')
  })
  it('falls back to the typed character when the parse cannot complete', () => {
    const original = prefix + 'last '
    let state = create(original), position = state.selection.main.head
    parserControl.incomplete = true
    try {
      const edit = markdownInputTransaction(state, position, position, '*')
      expect(edit).toBeNull()
      state = state.update({ changes: { from: position, insert: '*' }, userEvent: 'input.type' }).state
      expect(state.doc.toString()).toBe(original + '*')
      const target = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(original)
    } finally { parserControl.incomplete = false }
  })
})
