import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { insertTableOfContents } from './toc-insert'

function create(doc: string, anchor: number, options: { readOnly?: boolean; toc?: boolean; strict?: boolean; head?: number } = {}) {
  return EditorState.create({ doc, selection: EditorSelection.range(anchor, options.head ?? anchor), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(!!options.readOnly), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, toc: options.toc ?? true, strictMode: !!options.strict })] })
}
function result(doc: string, position: number): EditorState {
  const state = create(doc, position)
  const edit = insertTableOfContents(state)
  if (!edit) throw new Error('Expected insertion')
  return state.update(edit).state
}

describe('insert table of contents', () => {
  it('does not append a TOC into an unclosed HTML comment or raw block', () => {
    for (const source of ['正文\n\n<!-- 未闭合', '正文\n\n<script>\nlet x = 1', '正文\n\n<style>\nbody {}']) {
      const state = create(source, source.length - 1)
      expect(insertTableOfContents(state)).toBeNull()
      expect(state.doc.toString()).toBe(source)
    }
  })
  it('inserts directly into an empty document or blank line', () => {
    const empty = result('', 0)
    expect(empty.doc.toString()).toBe('[toc]')
    expect(empty.selection.main.head).toBe(5)
    expect(result('前文\n\n后文', 3).doc.toString()).toBe('前文\n\n[toc]\n\n后文')
    expect(result('前文\n  \n后文', 4).doc.toString()).toBe('前文\n\n[toc]\n  \n后文')
  })
  it('inserts outside ordinary paragraphs and adjacent blocks', () => {
    const source = '前文\n续行\n# 标题'
    expect(result(source, 2).doc.toString()).toBe('前文\n续行\n\n[toc]\n\n# 标题')
    expect(result('# 标题', 2).doc.toString()).toBe('# 标题\n\n[toc]')
  })
  it('inserts outside whole code, math and YAML blocks', () => {
    const code = '```js\n\n```\n\n正文'
    expect(result(code, code.indexOf('\n') + 1).doc.toString()).toBe('```js\n\n```\n\n[toc]\n\n正文')
    const yaml = '---\ntitle: A\n---\n\n正文'
    expect(result(yaml, yaml.indexOf('title')).doc.toString()).toBe('---\ntitle: A\n---\n\n[toc]\n\n正文')
    const math = '$$\nx+y\n$$\n\n正文'
    expect(result(math, math.indexOf('x')).doc.toString()).toBe('$$\nx+y\n$$\n\n[toc]\n\n正文')
  })
  it('keeps the entire list together and leaves following content unchanged', () => {
    const source = '- 父项\n  - 子项\n- 兄弟\n\n正文'
    expect(result(source, source.indexOf('子项')).doc.toString()).toBe('- 父项\n  - 子项\n- 兄弟\n\n[toc]\n\n正文')
  })
  it('rejects disabled features, read-only documents, selections and oversized documents', () => {
    expect(insertTableOfContents(create('x', 0, { readOnly: true }))).toBeNull()
    expect(insertTableOfContents(create('x', 0, { toc: false }))).toBeNull()
    expect(insertTableOfContents(create('x', 0, { strict: true }))).toBeNull()
    expect(insertTableOfContents(create('xx', 0, { head: 2 }))).toBeNull()
    expect(insertTableOfContents(create('x'.repeat(200001), 0))).toBeNull()
  })
  it('refuses unclosed fences and blank lines inside a list', () => {
    const fence = '```js\ncode'
    expect(insertTableOfContents(create(fence, fence.length))).toBeNull()
    const list = '- parent\n  \n  - child'
    expect(insertTableOfContents(create(list, list.indexOf('  \n') + 1))).toBeNull()
  })
  it('undoes the insertion in a single step', () => {
    const original = '# 标题\n\n正文'
    let state = result(original, 2)
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
})
