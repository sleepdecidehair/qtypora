import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

const parser = vi.hoisted(() => ({ timeout: vi.fn() }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => { parser.timeout(...args); return actual.ensureSyntaxTree(args[0], args[1], 0) } }
})
import { emphasisTransaction } from './emphasis-format'

describe('emphasis formatting parser budget', () => {
  it('refuses formatting without a complete syntax tree', () => {
    const doc = `${'text\n\n'.repeat(50000)}tail`
    const state = EditorState.create({ doc, selection: { anchor: 0, head: 4 }, extensions: [markdown({ base: markdownLanguage })] })
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length)
    expect(emphasisTransaction(state, 'bold')).toBeNull()
    expect(emphasisTransaction(state, 'italic')).toBeNull()
    expect(parser.timeout).toHaveBeenCalledWith(state, state.doc.length, 50)
    expect(state.doc.toString()).toBe(doc)
  })
})
