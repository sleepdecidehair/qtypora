import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { history, undo } from '@codemirror/commands'
import { confirmCodeFence, fenceCreation } from './live-code'

const parser = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parser.incomplete ? null : actual.ensureSyntaxTree(...args) }
})

const prefix = 'text\n\n'.repeat(1800)
const create = (doc: string, anchor = doc.length) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), history()] })

describe('fence creation with incremental parsing', () => {
  beforeEach(() => { parser.incomplete = false })
  it('creates a late fence and undoes it independently', () => {
    let current = create(prefix + '```')
    expect(syntaxTree(current).length).toBeLessThan(current.doc.length)
    expect(confirmCodeFence({ get state() { return current }, composing: false, dispatch: (spec: TransactionSpec) => { current = current.update(spec).state } })).toBe(true)
    expect(current.doc.toString()).toBe(prefix + '```\n\n```')
    expect(undo({ get state() { return current }, dispatch: transaction => { current = transaction.state } })).toBe(true)
    expect(current.doc.toString()).toBe(prefix + '```')
  })
  it('does not create a nested fence inside an existing code block', () => {
    const doc = prefix + '````\n```\n````'
    expect(fenceCreation(create(doc, prefix.length + 9))).toBeNull()
  })
  it('does not consume Enter when parsing is unavailable or input composition is active', () => {
    const current = create(prefix + '```')
    parser.incomplete = true
    let dispatched = false
    expect(confirmCodeFence({ state: current, composing: false, dispatch: () => { dispatched = true } })).toBe(false)
    expect(confirmCodeFence({ state: current, composing: true, dispatch: () => { dispatched = true } })).toBe(false)
    expect(dispatched).toBe(false)
    expect(current.update({ changes: { from: current.doc.length, insert: '\n' } }).state.doc.toString()).toBe(prefix + '```\n')
  })
})
