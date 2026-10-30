import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { Tree } from '@lezer/common'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, syntaxTree: () => Tree.empty }
})
import { focusedParagraphLines } from './focus-paragraph'

describe('focus mode with incomplete parse', () => {
  it('falls back to the cursor line without widening focus', () => {
    const state = EditorState.create({ doc: 'first\nsecond', selection: { anchor: 7 }, extensions: [markdown()] })
    expect(focusedParagraphLines(state)).toEqual({ first: 2, last: 2 })
  })
})
