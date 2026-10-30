import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { history, undo } from '@codemirror/commands'
import { styleScope } from './live-inline'

const parser = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parser.incomplete ? null : actual.ensureSyntaxTree(...args) }
})
const prefix = 'text\n\n'.repeat(1800)
const create = () => EditorState.create({ doc: prefix + 'before **hello** after', selection: { anchor: prefix.length + 11 }, extensions: [markdown({ base: markdownLanguage }), history()] })

describe('selecting style while parsing', () => {
  beforeEach(() => { parser.incomplete = false })
  it('selects only styled content in a late paragraph, and replacement can be undone', () => {
    let state = create()
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length)
    const range = styleScope(state)!
    expect(state.doc.sliceString(range.from, range.to)).toBe('hello')
    state = state.update({ selection: EditorSelection.range(range.from, range.to) }).state
    state = state.update({ changes: { from: range.from, to: range.to, insert: 'world' }, userEvent: 'input.type' }).state
    expect(state.doc.toString()).toBe(prefix + 'before **world** after')
    expect(undo({ get state() { return state }, dispatch: tr => { state = tr.state } })).toBe(true)
    expect(state.doc.toString()).toBe(prefix + 'before **hello** after')
  })
  it('refuses a selection when parsing cannot reach the end of its line', () => {
    const state = create(), selection = state.selection.main
    parser.incomplete = true
    expect(styleScope(state)).toBeNull()
    expect(state.selection.main).toEqual(selection)
  })
})
