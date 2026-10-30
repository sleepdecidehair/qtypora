import { Compartment, EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { CloseGuard } from './close-guard'

function fixture(readOnly = false) {
  const blocked = vi.fn(), guard = new CloseGuard(blocked), config = new Compartment()
  const view = {
    state: EditorState.create({ doc: 'hello world', selection: EditorSelection.range(1, 4), extensions: [config.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]), guard.extension] }),
    composing: false, compositionStarted: false,
    dispatch(spec: TransactionSpec) { this.state = this.state.update(spec).state },
  }
  return { guard, view, config, blocked }
}

describe('editor close guard', () => {
  it('refuses to start while an IME composition has started', () => {
    const { guard, view } = fixture()
    view.compositionStarted = true
    expect(guard.begin(view)).toBe('composing')
    expect(guard.locked).toBe(false)
    expect(view.state.facet(EditorState.readOnly)).toBe(false)
  })
  it('locks user editing and preserves late programmatic changes for the close caller to detect', async () => {
    const { guard, view, blocked } = fixture()
    expect(guard.begin(view)).toBe('locked')
    expect(view.state.facet(EditorState.readOnly)).toBe(true)
    expect(view.state.facet(EditorView.editable)).toBe(false)
    expect(view.state.selection.main.from).toBe(1)
    expect(view.state.selection.main.to).toBe(4)
    view.dispatch({ changes: { from: 1, insert: 'X' }, userEvent: 'input.type' })
    expect(view.state.doc.toString()).toBe('hXello world')
    expect(guard.blocked).toBe(true)
    await Promise.resolve()
    expect(blocked).toHaveBeenCalledOnce()
    guard.end(view)
    expect(view.state.facet(EditorState.readOnly)).toBe(false)
    expect(view.state.facet(EditorView.editable)).toBe(true)
    expect(view.state.selection.main.from).toBe(2)
    view.dispatch({ changes: { from: 1, insert: 'X' } })
    expect(view.state.doc.toString()).toBe('hXXello world')
  })
  it('preserves prior and subsequently reconfigured read-only state', () => {
    const { guard, view, config } = fixture(true)
    expect(guard.begin(view)).toBe('locked')
    guard.end(view)
    expect(view.state.facet(EditorState.readOnly)).toBe(true)
    expect(view.state.facet(EditorView.editable)).toBe(false)
    view.dispatch({ effects: config.reconfigure([EditorState.readOnly.of(false), EditorView.editable.of(true)]) })
    expect(guard.begin(view)).toBe('locked')
    view.dispatch({ effects: config.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)]) })
    guard.end(view)
    expect(view.state.facet(EditorState.readOnly)).toBe(true)
  })
  it('refuses absent state and repeated acquisition', () => {
    const { guard, view } = fixture()
    const unconfigured = { ...view, state: EditorState.create({ doc: '' }) }
    expect(guard.begin(unconfigured)).toBe('unavailable')
    expect(guard.begin(view)).toBe('locked')
    expect(guard.begin(view)).toBe('already-locked')
    guard.end(view)
  })
})
