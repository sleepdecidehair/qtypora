import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { createMarkdownParser } from './markdown-parser'
import { listSoftBreak } from './list-soft-break'

const create = (doc: string, position: number, readOnly = false) => EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })

describe('soft line break inside a simple list item', () => {
  it('uses the exact marker width and undoes in one step', () => {
    for (const [doc, expected] of [['- first', '- first\n  '], ['12. first', '12. first\n    '], [' +   first', ' +   first\n     ']] as const) {
      let state = create(doc, doc.length)
      const edit = listSoftBreak(state, 'hybrid')
      if (!edit || edit === 'blocked') throw new Error('Expected list break')
      state = state.update(edit).state
      expect(state.doc.toString()).toBe(expected)
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(doc)
    }
  })
  it('keeps subsequent heading syntax inside the existing item', () => {
    const state = create('12. first', 9)
    const edit = listSoftBreak(state, 'hybrid')
    if (!edit || edit === 'blocked') throw new Error('Expected list break')
    const next = state.update(edit).state
    const source = next.update({ changes: { from: next.selection.main.head, insert: '# heading' } }).state.doc.toString()
    expect(source).toBe('12. first\n    # heading')
    expect(createMarkdownParser().parse(source, {}).find(token => token.type === 'heading_open')?.level).toBe(2)
  })
  it('keeps task state and nested items while continuing at the correct depth', () => {
    for (const [doc, expected, headingLevel] of [['- [ ] first', '- [ ] first\n  # heading', 2], ['- [x] first', '- [x] first\n  # heading', 2], ['- parent\n  - child', '- parent\n  - child\n    # heading', 4]] as const) {
      let state = create(doc, doc.length)
      const edit = listSoftBreak(state, 'hybrid')
      if (!edit || edit === 'blocked') throw new Error('Expected list break')
      state = state.update(edit).state
      const afterText = state.update({ changes: { from: state.selection.main.head, insert: '# heading' } }).state.doc.toString()
      expect(afterText).toBe(expected)
      const parsed = createMarkdownParser().parse(afterText, {})
      expect(parsed.find(token => token.type === 'heading_open')?.level).toBe(headingLevel)
      if (doc.startsWith('- [')) {
        const checkbox = parsed.flatMap(token => token.children ?? []).find(token => token.type === 'html_inline' && token.content.includes('task-list-item-checkbox'))
        expect(checkbox?.content.includes('checked=""')).toBe(doc.startsWith('- [x]'))
      }
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(doc)
    }
  })
  it('leaves quotes, code, source mode, read-only and ambiguous structures unchanged', () => {
    for (const [doc, position] of [['> - first', 9], ['- [ ] first', 3], ['```\n- first\n```', 11], ['- `code`', 5], ['- first\n- next', 7]] as const) expect(listSoftBreak(create(doc, position), 'hybrid')).toBeNull()
    expect(listSoftBreak(create('- first', 7), 'source')).toBeNull()
    expect(listSoftBreak(create('- first', 7, true), 'hybrid')).toBeNull()
    expect(listSoftBreak(create('- A&amp;B', 5), 'hybrid')).toBe('blocked')
  })
})
