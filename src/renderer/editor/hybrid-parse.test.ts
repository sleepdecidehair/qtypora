import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { hybridExtension } from './hybrid'

function taskWidgets(state: EditorState): number {
  let count = 0
  for (const decoration of state.facet(EditorView.decorations)) {
    if (typeof decoration === 'function') continue
    decoration.between(0, state.doc.length, (_from, _to, value) => { if (value.spec.widget?.constructor.name === 'TaskWidget') count++ })
  }
  return count
}

describe('hybrid preview after incremental parsing', () => {
  it('reveals a late parsed task once and reuses decorations for unrelated transactions', () => {
    const doc = 'plain\n\n'.repeat(1800) + '- [ ] task'
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), hybridExtension({ theme: 'light', focusMode: false, readOnly: false, resolveResource: async value => value, onLinkOpen: () => {} })] })
    expect(syntaxTree(state).length).toBeLessThan(doc.length)
    expect(taskWidgets(state)).toBe(0)
    expect(ensureSyntaxTree(state, doc.length, 10000)?.length).toBe(doc.length)
    state = state.update({}).state
    expect(syntaxTree(state).length).toBe(doc.length)
    expect(taskWidgets(state)).toBe(1)
    expect(state.doc.toString()).toBe(doc)
    const before = state.facet(EditorView.decorations)
    state = state.update({}).state
    const after = state.facet(EditorView.decorations)
    expect(after).toEqual(before)
    expect(after.every((value, index) => value === before[index])).toBe(true)
    expect(taskWidgets(state)).toBe(1)
  })
})
