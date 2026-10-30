import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { history, undo } from '@codemirror/commands'
import { headingLevelEdit } from './heading-level'

function change(doc: string, position: number, direction: 'promote' | 'demote'): string | null {
  const state = EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage })] })
  const edit = headingLevelEdit(state, direction)
  return edit ? state.update(edit).state.doc.toString() : null
}

describe('heading level transactions', () => {
  it('changes only the parsed ATX marker and preserves indentation and closing syntax', () => {
    const source = 'before\n  ### **Title** ###\nafter'
    expect(change(source, source.indexOf('Title'), 'promote')).toBe('before\n  ## **Title** ###\nafter')
    expect(change(source, source.indexOf('Title'), 'demote')).toBe('before\n  #### **Title** ###\nafter')
  })
  it('preserves quote and list containers when editing nested headings', () => {
    expect(change('> ## Nested', 6, 'promote')).toBe('> # Nested')
    expect(change('- ## Nested', 6, 'demote')).toBe('- ### Nested')
    expect(change('> Header\n> ---', 5, 'promote')).toBe('> Header\n> ===')
    expect(change('> Header\n> ---', 5, 'demote')).toBe('> ### Header')
  })
  it('restores the exact nested source in one undo', () => {
    const source = '> Header\n> ---\n\nother'
    let state = EditorState.create({ doc: source, selection: { anchor: 5 }, extensions: [markdown({ base: markdownLanguage }), history()] })
    state = state.update(headingLevelEdit(state, 'demote')!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })
  it('keeps a setext heading where possible and turns level 2 into level 3 safely', () => {
    expect(change('Title\n---\n\nend', 2, 'promote')).toBe('Title\n===\n\nend')
    expect(change('Title\n---\n\nend', 2, 'demote')).toBe('### Title\n\nend')
    expect(change('Title\n===\n\nend', 2, 'demote')).toBe('Title\n---\n\nend')
  })
  it('maps the caret to the same text after changing a marker', () => {
    const doc = '## 中文标题'
    const state = EditorState.create({ doc, selection: { anchor: 5 }, extensions: [markdown({ base: markdownLanguage })] })
    const updated = state.update(headingLevelEdit(state, 'demote')!).state
    expect(updated.doc.toString()).toBe('### 中文标题')
    expect(updated.selection.main.head).toBe(6)
  })
  it('does not change plain text, fenced code, or headings at level bounds', () => {
    expect(change('## 标题', 5, 'demote')).toBe('### 标题')
    expect(change('ordinary', 3, 'promote')).toBeNull()
    expect(change('```\n## literal\n```', 8, 'promote')).toBeNull()
    expect(change('# one', 3, 'promote')).toBeNull()
    expect(change('###### six', 8, 'demote')).toBeNull()
  })
  it('refuses multiline setext conversion without losing content', () => {
    expect(change('first\nsecond\n---', 2, 'demote')).toBeNull()
  })
})
