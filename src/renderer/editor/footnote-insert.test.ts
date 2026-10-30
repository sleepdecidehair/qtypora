import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet, markdownDocumentModel } from './markdown-config'
import { markdownDefinitions } from './markdown-references'
import { insertFootnote, insertReferenceLink } from './footnote-insert'
import { liveEditingBlock } from './live-blocks'

function create(doc: string, anchor: number, options: { readOnly?: boolean; footnotes?: boolean; strict?: boolean; head?: number } = {}) {
  return EditorState.create({ doc, selection: EditorSelection.range(anchor, options.head ?? anchor), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(!!options.readOnly), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, footnotes: options.footnotes ?? true, strictMode: !!options.strict })] })
}
function result(doc: string, position: number): EditorState {
  const state = create(doc, position)
  const edit = insertFootnote(state)
  if (!edit) throw new Error('Expected footnote insertion')
  return state.update(edit).state
}

describe('insert footnote', () => {
  it('refuses positions inside an HTML entity but allows its exact boundaries', () => {
    const source = 'A &amp; B'
    for (const position of [3, 4, 5, 6]) expect(insertFootnote(create(source, position))).toBeNull()
    expect(result(source, 2).doc.toString()).toBe('A [^fn1]&amp; B\n\n[^fn1]: ')
    expect(result(source, 7).doc.toString()).toBe('A &amp;[^fn1] B\n\n[^fn1]: ')
  })
  it('inserts reference and definition at document end and focuses the definition', () => {
    const state = result('正文', 2)
    expect(state.doc.toString()).toBe('正文[^fn1]\n\n[^fn1]: ')
    expect(state.selection.main.head).toBe(state.doc.length)
    expect(markdownDefinitions(markdownDocumentModel(state).environment)).toContainEqual({ kind: 'footnote', label: 'fn1', line: 3, endLine: 3 })
  })
  it('opens the generated definition for editing in live preview state', () => {
    const state = EditorState.create({ doc: '正文', selection: { anchor: 2 }, extensions: [markdown({ base: markdownLanguage }), liveEditingBlock] })
    const next = state.update(insertFootnote(state)!).state
    expect(next.field(liveEditingBlock)).toEqual({ from: 10, to: 18 })
    expect(next.doc.sliceString(10, 18)).toBe('[^fn1]: ')
  })
  it('preserves original content and line endings at a middle position', () => {
    const source = '第一段文本\n\n第二段\n'
    const state = result(source, 3)
    expect(state.doc.toString()).toBe('第一段[^fn1]文本\n\n第二段\n\n[^fn1]: ')
    expect(state.selection.main.head).toBe(state.doc.length)
  })
  it('chooses a label not already used by a definition or unresolved reference', () => {
    const source = '正文[^fn1] [^Fn2]\n\n[^fn3]: existing'
    const state = result(source, 1)
    expect(state.doc.toString()).toContain('正[^fn4]文[^fn1]')
    expect(state.doc.toString()).toContain('[^fn4]: ')
  })
  it('does not insert into code, math, links, front matter, or after an unclosed fence', () => {
    for (const [source, position] of [
      ['```js\ncode\n```', 7], ['```js\n\n```', 6], ['text `code`', 8],
      ['text [link](url)', 8], ['text $x+y$ after', 8], ['$$\nx+y\n$$', 4], ['---\ntitle: A\n---', 6], ['正文\n\n```\nunclosed', 1],
    ] as const) expect(insertFootnote(create(source, position))).toBeNull()
  })
  it('does not append definitions inside unclosed fences or raw HTML blocks', () => {
    for (const source of ['text\n\n```js\ncode\n', 'text\n\n~~~\ncode\n', 'text\n\n```js\ncode\n``\n', 'text\n\n<!-- unclosed\n', 'text\n\n<script>\ncode\n']) {
      expect(insertFootnote(create(source, 2))).toBeNull()
      expect(insertReferenceLink(create(source, 0, { head: 4 }), 'https://example.com')).toBeNull()
    }
  })
  it('allows definitions after closed fences and comments', () => {
    for (const source of ['text\n\n```\ncode\n```\n', 'text\n\n<!-- closed -->\n']) {
      expect(insertFootnote(create(source, 2))).not.toBeNull()
      expect(insertReferenceLink(create(source, 0, { head: 4 }), 'https://example.com')).not.toBeNull()
    }
  })
  it('respects disabled footnotes, strict mode, selection, read-only and preview budget', () => {
    expect(insertFootnote(create('正文', 1, { readOnly: true }))).toBeNull()
    expect(insertFootnote(create('正文', 1, { footnotes: false }))).toBeNull()
    expect(insertFootnote(create('正文', 1, { strict: true }))).toBeNull()
    expect(insertFootnote(create('正文', 0, { head: 2 }))).toBeNull()
    expect(insertFootnote(create('x'.repeat(200001), 1))).toBeNull()
  })
  it('does not split graphemes or Markdown escapes', () => {
    expect(insertFootnote(create('A😀B', 2))).toBeNull()
    expect(insertFootnote(create('Ae\u0301B', 2))).toBeNull()
    expect(insertFootnote(create('A\\*B', 2))).toBeNull()
    expect(insertReferenceLink(create('A😀B', 1, { head: 2 }), 'https://example.com')).toBeNull()
    expect(insertReferenceLink(create('!文字', 1, { head: 3 }), 'https://example.com')).toBeNull()
  })
  it('does not append inside a distant unclosed fence', () => {
    const source = 'text\n\n' + 'plain text\n'.repeat(500) + '```js\ncode'
    expect(insertFootnote(create(source, 2))).toBeNull()
    expect(insertReferenceLink(create(source, 0, { head: 4 }), 'https://example.com')).toBeNull()
  })
  it('undoes both reference and definition as one transaction', () => {
    const original = '正文\n\n结尾'
    let state = result(original, 2)
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
})
