import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { editLiveBlock, liveEditingBlock } from './live-blocks'

describe('explicitly opened source block selection', () => {
  it('keeps an internal selection editable and closes on a selection crossing the block', () => {
    let state = EditorState.create({ doc: 'before\nblock text\nafter', extensions: [liveEditingBlock] })
    state = state.update({ effects: editLiveBlock.of({ from: 7, to: 17 }), selection: { anchor: 7 } }).state
    state = state.update({ selection: { anchor: 7, head: 12 } }).state
    expect(state.field(liveEditingBlock)).toEqual({ from: 7, to: 17 })
    state = state.update({ changes: { from: 7, to: 12, insert: 'changed' }, selection: { anchor: 14 } }).state
    expect(state.field(liveEditingBlock)).toEqual({ from: 7, to: 19 })
    state = state.update({ selection: { anchor: 0, head: 10 } }).state
    expect(state.field(liveEditingBlock)).toBeNull()
  })
})
