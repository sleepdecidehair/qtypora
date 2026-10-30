import { history, undo } from '@codemirror/commands'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { SearchQuery, replaceNext, search, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

function fixture(readOnly = false) {
  let state = EditorState.create({ doc: 'alpha beta alpha', extensions: [history(), search(), EditorState.readOnly.of(readOnly)] })
  state = state.update({ effects: setSearchQuery.of(new SearchQuery({ search: 'alpha', replace: '新' })) }).state
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
  return { view, get state() { return state } }
}

describe('replace next command', () => {
  it('selects then replaces one match and undoes the edit', () => {
    const target = fixture()
    expect(replaceNext(target.view)).toBe(true)
    expect(target.state.selection.main.from).toBe(0)
    expect(target.state.selection.main.to).toBe(5)
    expect(target.state.doc.toString()).toBe('alpha beta alpha')
    expect(replaceNext(target.view)).toBe(true)
    expect(target.state.doc.toString()).toBe('新 beta alpha')
    expect(undo(target.view)).toBe(true)
    expect(target.state.doc.toString()).toBe('alpha beta alpha')
  })
  it('never changes a read-only document', () => {
    const target = fixture(true)
    expect(replaceNext(target.view)).toBe(false)
    expect(target.state.doc.toString()).toBe('alpha beta alpha')
  })
})
