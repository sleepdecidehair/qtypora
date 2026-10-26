import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { focusedHeadingEditRange, headingInputPreview, preserveHeadingPreview } from './live-source-edit'

const create = (doc = '', anchor = doc.length) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), headingInputPreview] })
const type = (state: EditorState, text: string) => state.update({ changes: { from: state.selection.main.head, insert: text }, selection: { anchor: state.selection.main.head + text.length }, userEvent: 'input.type' }).state

describe('new heading input and existing heading focus', () => {
  it('keeps a new heading in preview through typing and backward deletion until explicit selection', () => {
    let state = type(type(create(), '#'), '#')
    state = type(state, ' ')
    expect(focusedHeadingEditRange(state)).toBeNull()
    state = state.update({ changes: { from: 2, to: 3 }, selection: { anchor: 2 }, userEvent: 'delete.backward' }).state
    state = type(type(state, ' '), '标题')
    expect(focusedHeadingEditRange(state)).toBeNull()
    expect(state.doc.toString()).toBe('## 标题')
    state = state.update({ selection: { anchor: 4 }, userEvent: 'select.pointer' }).state
    expect(focusedHeadingEditRange(state)).toEqual({ from: 0, to: 5 })
  })
  it('retains existing heading source focus while programmatic navigation can preserve preview', () => {
    let state = create('## Title\n\nbody', 5)
    expect(focusedHeadingEditRange(state)).toEqual({ from: 0, to: 8 })
    state = state.update({ selection: { anchor: 0 }, effects: preserveHeadingPreview.of(0) }).state
    expect(focusedHeadingEditRange(state)).toBeNull()
    state = state.update({ selection: { anchor: 3 }, userEvent: 'select.pointer' }).state
    expect(focusedHeadingEditRange(state)).toEqual({ from: 0, to: 8 })
  })
})
