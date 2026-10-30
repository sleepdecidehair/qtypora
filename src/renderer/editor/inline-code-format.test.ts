import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { inlineCodeTransaction } from './inline-code-format'

function fixture(doc: string, anchor = 0, head = doc.length) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage }), history()] })
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
  return { view, get state() { return state }, apply() { const edit = inlineCodeTransaction(state); if (edit) state = state.update(edit).state; return edit } }
}

describe('safe inline code formatting', () => {
  it('renders selected literal text including backticks and edge spaces unchanged', () => {
    const parser = new MarkdownIt()
    for (const text of ['a`b', 'a``b', 'a```b', '`start', 'end`', ' a ', '  a  ', ' ', '中`文', 'a\tb']) {
      const target = fixture(text)
      expect(target.apply()).not.toBeNull()
      const children = parser.parseInline(target.state.doc.toString(), {})[0].children!
      expect(children).toHaveLength(1)
      expect(children[0].type).toBe('code_inline')
      expect(children[0].content).toBe(text)
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('toggles a complete code span and preserves reverse selection', () => {
    const target = fixture('a`b', 3, 0)
    expect(target.apply()).not.toBeNull()
    expect(target.state.doc.toString()).toBe('``a`b``')
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head)
    expect(target.apply()).not.toBeNull()
    expect(target.state.doc.toString()).toBe('a`b')
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head)
  })
  it('handles an empty selection and refuses partial or multiline code', () => {
    const empty = fixture('', 0, 0)
    expect(empty.apply()).not.toBeNull()
    expect(empty.state.doc.toString()).toBe('`code`')
    expect(fixture('`hello`', 2, 4).apply()).toBeNull()
    expect(fixture('a\nb').apply()).toBeNull()
    expect(fixture('   ').apply()).toBeNull()
    const existing = fixture('`a`')
    expect(existing.apply()).not.toBeNull()
    expect(existing.state.doc.toString()).toBe('a')
  })
})
