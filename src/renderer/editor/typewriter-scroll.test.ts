import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { changesTypewriterPosition, isTypewriterInputChange, shouldApplyTypewriterScroll, type TypewriterScrollContext, type TypewriterScrollRequest } from './typewriter-scroll'

function transaction(userEvent?: string, changed = true) {
  const state = EditorState.create({ doc: 'abc' })
  return state.update({
    ...(changed ? { changes: { from: 0, to: 1, insert: 'x' } } : { selection: { anchor: 1 } }),
    ...(userEvent ? { userEvent } : {}),
  })
}

describe('typewriter scroll policy', () => {
  it('centers input, paste, drop, completion, table edits, and deletions in input-only mode', () => {
    for (const event of [
      'input', 'input.type', 'input.type.compose', 'input.paste', 'input.drop', 'input.complete', 'input.replace',
      'input.table', 'input.table.structure', 'delete', 'delete.backward', 'delete.cut', 'delete.line',
    ]) expect(isTypewriterInputChange([transaction(event)])).toBe(true)
  })

  it('leaves selection, navigation, undo, redo, drag-move, and external changes alone in input-only mode', () => {
    for (const event of ['select', 'select.pointer', 'select.table', 'move.character', 'undo', 'redo', 'move.drop']) {
      expect(isTypewriterInputChange([transaction(event)])).toBe(false)
    }
    expect(isTypewriterInputChange([transaction('input.type', false)])).toBe(false)
    expect(isTypewriterInputChange([transaction()])).toBe(false)
  })

  it('keeps a pending input scroll when keyup synchronizes the same table caret', () => {
    const state = EditorState.create({ doc: '| abc |', selection: { anchor: 3 } })
    const input = state.update({ changes: { from: 3, insert: 'x' }, selection: { anchor: 4 }, userEvent: 'input.table' })
    const keyup = input.state.update({ selection: EditorSelection.range(4, 4), userEvent: 'select.table' })
    expect(changesTypewriterPosition([input])).toBe(true)
    expect(changesTypewriterPosition([keyup])).toBe(false)
    expect(changesTypewriterPosition([])).toBe(false)
  })

  it('invalidates pending input after a real caret, selection direction, association, or document change', () => {
    const state = EditorState.create({ doc: 'abcdef', selection: EditorSelection.range(2, 4) })
    expect(changesTypewriterPosition([state.update({ selection: EditorSelection.range(2, 4), userEvent: 'select.table' })])).toBe(false)
    expect(changesTypewriterPosition([state.update({ selection: { anchor: 4 }, userEvent: 'select.table' })])).toBe(true)
    expect(changesTypewriterPosition([state.update({ selection: EditorSelection.range(4, 2), userEvent: 'select.table' })])).toBe(true)
    expect(changesTypewriterPosition([state.update({ changes: { from: 0, to: 1, insert: 'x' } })])).toBe(true)
    const cursor = state.update({ selection: EditorSelection.create([EditorSelection.cursor(3, -1)]) }).state
    expect(changesTypewriterPosition([cursor.update({ selection: EditorSelection.create([EditorSelection.cursor(3, 1)]) })])).toBe(true)
  })

  it('rejects a measured caret after a newer edit, selection, preference, document, or mode change', () => {
    const request: TypewriterScrollRequest = { version: 4, documentId: 'doc-a', mode: 'source', alwaysCenter: false, isInput: true }
    const context: TypewriterScrollContext = { version: 4, documentId: 'doc-a', mode: 'source', typewriterMode: true, alwaysCenter: false, composing: false, restoringScroll: false }
    expect(shouldApplyTypewriterScroll(request, context)).toBe(true)
    expect(shouldApplyTypewriterScroll({ ...request, alwaysCenter: true, isInput: false }, { ...context, alwaysCenter: true })).toBe(true)
    expect(shouldApplyTypewriterScroll(request, { ...context, version: 5 })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, documentId: 'doc-b' })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, alwaysCenter: true })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, mode: 'reading' })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, typewriterMode: false })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, composing: true })).toBe(false)
    expect(shouldApplyTypewriterScroll(request, { ...context, restoringScroll: true })).toBe(false)
    expect(shouldApplyTypewriterScroll({ ...request, isInput: false }, context)).toBe(false)
  })
})
