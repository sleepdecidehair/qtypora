import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { linkFormatTransaction } from './link-format'

function fixture(doc: string, from = 0, to = doc.length) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: [markdown({ base: markdownLanguage }), history()] })
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
  return { view, get state() { return state }, apply() { const edit = linkFormatTransaction(state); if (edit) state = state.update(edit).state; return edit } }
}

describe('safe link formatting', () => {
  it('preserves selected rendering for brackets, escapes and existing markup', () => {
    const parser = new MarkdownIt({ linkify: true })
    for (const text of ['ordinary', 'a]b', 'a[b', '[balanced]', '\\[already escaped\\]', 'a\\', '**bold**', '`[code`', '![alt](image.png)', '中]文']) {
      const target = fixture(text)
      expect(target.apply(), text).not.toBeNull()
      const children = parser.parseInline(target.state.doc.toString(), {})[0].children!
      expect(children[0].type, text).toBe('link_open')
      expect(children.at(-1)?.type, text).toBe('link_close')
      expect(children[0].attrGet('href'), text).toBe('https://example.com')
      expect(parser.renderer.renderInline(children.slice(1, -1), parser.options, {}), text).toBe(parser.renderInline(text))
      expect(target.state.doc.sliceString(target.state.selection.main.from, target.state.selection.main.to)).toBe('https://example.com')
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('rejects nested links and partial code spans without altering the document', () => {
    expect(fixture('[existing](https://example.org)').apply()).toBeNull()
    expect(fixture('`[code`', 2, 5).apply()).toBeNull()
  })
})
