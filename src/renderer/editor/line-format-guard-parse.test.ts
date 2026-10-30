import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: () => null }
})
import { canFormatSelectedLines } from './line-format-guard'
import { canFormatInlineSelection } from './inline-format-guard'

describe('line formatting parser budget', () => {
  it('refuses when parsing is incomplete', () => {
    expect(canFormatSelectedLines(EditorState.create({ doc: 'text', extensions: [markdown()] }))).toBe(false)
    expect(canFormatInlineSelection(EditorState.create({ doc: 'text', extensions: [markdown()] }))).toBe(false)
  })
})
