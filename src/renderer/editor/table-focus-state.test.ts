import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { resolveTableFocusSelection, type TableFocusState } from './table-focus-state'

const source = Text.of(['before', '| a | b |'])
const snapshot: TableFocusState = { source, tableFrom: 7, row: 0, column: 1, anchor: 2, focus: 1 }

describe('table focus snapshot', () => {
  it('preserves backward selection and safely clamps against a shorter text node', () => {
    expect(resolveTableFocusSelection(snapshot, Text.of(['before', '| a | b |']), 1)).toEqual({ target: 'text', anchor: 1, focus: 1 })
    expect(resolveTableFocusSelection(snapshot, source, 3)).toEqual({ target: 'text', anchor: 2, focus: 1 })
  })

  it('invalidates a snapshot if the document changes even when an old table offset still exists', () => {
    expect(resolveTableFocusSelection(snapshot, Text.of(['changed', '| a | b |']), 3)).toBeNull()
    expect(resolveTableFocusSelection(snapshot, Text.of(['before', '| x | y |']), 3)).toBeNull()
  })

  it('restores an empty cell caret on the cell element itself', () => {
    expect(resolveTableFocusSelection({ ...snapshot, anchor: 0, focus: 0 }, source, null)).toEqual({ target: 'cell', anchor: 0, focus: 0 })
    expect(resolveTableFocusSelection(snapshot, source, null)).toBeNull()
  })
})
