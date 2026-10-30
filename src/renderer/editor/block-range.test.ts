import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { markdownOptionsFacet } from './markdown-config'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { currentBlockRange, deleteCurrentBlock, selectCurrentBlock } from './block-range'

function create(doc: string, position: number, readOnly = false) {
  return EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
}
function selected(state: EditorState): string | null {
  const transaction = selectCurrentBlock(state)
  if (!transaction) return null
  const next = state.update(transaction).state
  return next.doc.sliceString(next.selection.main.from, next.selection.main.to)
}

describe('block selection and deletion', () => {
  it('selects an entire multiline paragraph and leaves its neighbors untouched', () => {
    const doc = '前文\n\n第一行\n第二行\n\n后文'
    const state = create(doc, doc.indexOf('第二行') + 2)
    expect(selected(state)).toBe('第一行\n第二行')
    const deleted = state.update(deleteCurrentBlock(state)!).state
    expect(deleted.doc.toString()).toBe('前文\n\n\n\n后文')
  })
  it('selects and deletes the whole fence, including delimiters', () => {
    const doc = '前文\n\n```js\na()\nb()\n```\n\n后文'
    const state = create(doc, doc.indexOf('b()'))
    expect(selected(state)).toBe('```js\na()\nb()\n```')
    expect(state.update(deleteCurrentBlock(state)!).state.doc.toString()).toBe('前文\n\n\n\n后文')
  })
  it('handles an empty line within a code fence as part of the block', () => {
    const doc = '```js\n\n```\n\n后文'
    const state = create(doc, doc.indexOf('\n') + 1)
    expect(selected(state)).toBe('```js\n\n```')
    expect(state.update(deleteCurrentBlock(state)!).state.doc.toString()).toBe('\n\n后文')
  })
  it('selects and deletes a complete table from a body cell', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后文'
    const state = create(doc, doc.indexOf('2'))
    expect(selected(state)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(state.update(deleteCurrentBlock(state)!).state.doc.toString()).toBe('\n\n后文')
  })
  it('selects and deletes only the nearest list item including its nested children', () => {
    const doc = '- 第一项\n- 第二项\n  - 子项一\n  - 子项二\n- 第三项'
    const parent = create(doc, doc.indexOf('第二项'))
    expect(selected(parent)).toBe('- 第二项\n  - 子项一\n  - 子项二')
    expect(parent.update(deleteCurrentBlock(parent)!).state.doc.toString()).toBe('- 第一项\n- 第三项')
    const child = create(doc, doc.indexOf('子项一'))
    expect(selected(child)).toBe('  - 子项一')
    const deleted = child.update(deleteCurrentBlock(child)!).state
    expect(deleted.doc.toString()).toBe('- 第一项\n- 第二项\n  - 子项二\n- 第三项')
    let restored = deleted
    const target = { get state() { return restored }, dispatch(spec: Parameters<typeof restored.update>[0]) { restored = restored.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(restored.doc.toString()).toBe(doc)
  })
  it('deletes one list item inside an alert and supports undo', () => {
    const doc = '> [!NOTE]\n> - 一\n> - 二'
    let state = EditorState.create({ doc, selection: { anchor: doc.indexOf('一') }, extensions: [markdown({ base: markdownLanguage }), history(), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, alerts: true })] })
    expect(selected(state)).toBe('> - 一')
    state = state.update(deleteCurrentBlock(state)!).state
    expect(state.doc.toString()).toBe('> [!NOTE]\n> - 二')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(doc)
  })
  it('selects and deletes complete front matter and display math', () => {
    const yaml = '---\ntitle: 示例\nauthor: A\n---\n\n正文'
    const yamlState = create(yaml, yaml.indexOf('title'))
    expect(selected(yamlState)).toBe('---\ntitle: 示例\nauthor: A\n---')
    expect(yamlState.update(deleteCurrentBlock(yamlState)!).state.doc.toString()).toBe('\n\n正文')
    const math = '$$\nx + y\n$$\n\n正文'
    const mathState = create(math, math.indexOf('x'))
    expect(selected(mathState)).toBe('$$\nx + y\n$$')
    expect(mathState.update(deleteCurrentBlock(mathState)!).state.doc.toString()).toBe('\n\n正文')
  })
  it('deletes first, middle, and last tight list items without making the list loose', () => {
    const doc = '- one\n- two\n- three'
    for (const [word, expected] of [['one', '- two\n- three'], ['two', '- one\n- three'], ['three', '- one\n- two']]) {
      let state = create(doc, doc.indexOf(word))
      state = state.update(deleteCurrentBlock(state)!).state
      expect(state.doc.toString()).toBe(expected)
      const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(state.doc.toString()).toBe(doc)
    }
  })
  it('keeps adjacent text blocks separated when deleting a heading', () => {
    const state = create('first\n# heading\nnext', 9)
    expect(state.update(deleteCurrentBlock(state)!).state.doc.toString()).toBe('first\n\nnext')
  })
  it('allows selecting in read-only mode, rejects deletion, and ignores empty lines', () => {
    const readonly = create('# title', 4, true)
    expect(selected(readonly)).toBe('# title')
    expect(deleteCurrentBlock(readonly)).toBeNull()
    const blank = create('before\n\nend', 7)
    expect(currentBlockRange(blank)).toBeNull()
    expect(selectCurrentBlock(blank)).toBeNull()
    expect(deleteCurrentBlock(blank)).toBeNull()
  })
  it('refuses a block operation when source exceeds the preview parser budget', () => {
    const source = '---\ntitle: test\n---\n' + 'a'.repeat(200001)
    const state = create(source, 5)
    expect(selectCurrentBlock(state)).toBeNull()
    expect(deleteCurrentBlock(state)).toBeNull()
  })
  it('restores the original source with a single undo', () => {
    const doc = '```\ncode\n```\n\n后文'
    let state = create(doc, 5)
    state = state.update(deleteCurrentBlock(state)!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(doc)
  })
})
