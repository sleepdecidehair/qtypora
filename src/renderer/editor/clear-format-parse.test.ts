import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: () => null }
})
import { clearFormatTransaction } from './clear-format'

describe('clear format parser budget', () => {
  it('refuses changes when parsing cannot finish', () => {
    const state = EditorState.create({ doc: '**bold**', selection: { anchor: 0, head: 8 }, extensions: [markdown()] })
    expect(clearFormatTransaction(state)).toBeNull()
    expect(state.doc.toString()).toBe('**bold**')
  })
})
