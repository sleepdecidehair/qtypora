import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { deleteCurrentStyle } from './style-delete'

const create = (doc: string, anchor: number, head = anchor, readOnly = false) => EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
const apply = (state: EditorState) => {
  const spec = deleteCurrentStyle(state)
  return spec ? state.update(spec).state.doc.toString() : null
}

describe('delete current formatted text', () => {
  it('removes text and both delimiters without touching neighboring content', () => {
    const doc = '前文 **粗体😀** 后文'
    expect(apply(create(doc, doc.indexOf('粗体')))).toBe('前文  后文')
    expect(apply(create('plain text', 4))).toBeNull()
  })
  it('removes a full link including its destination', () => {
    const doc = '前 [标签](https://example.com/path) 后'
    expect(apply(create(doc, doc.indexOf('标签') + 1))).toBe('前  后')
  })
  it('accepts a selection of the complete formatted content', () => {
    const doc = 'x **hello** y'
    expect(apply(create(doc, 4, 9))).toBe('x  y')
  })
  it('keeps outer formatting when removing a nested formatted node', () => {
    const doc = '**before *inner* after**'
    expect(apply(create(doc, doc.indexOf('inner') + 2))).toBe('**before  after**')
  })
  it('refuses an operation that would leave an empty formatted parent or span syntax', () => {
    const doc = '**_inner_**'
    expect(apply(create(doc, doc.indexOf('inner') + 2))).toBeNull()
    const across = 'a **bold** b'
    expect(apply(create(across, 0, across.length))).toBeNull()
  })
  it('protects image source and an outer style made empty by deleting a link', () => {
    const image = 'before ![alt](image.png) after'
    expect(apply(create(image, image.indexOf('alt') + 1))).toBeNull()
    const nested = '**[label](https://example.com)**'
    expect(apply(create(nested, nested.indexOf('label') + 1))).toBeNull()
    const code = '```md\n**not style**\n```'
    expect(apply(create(code, code.indexOf('not') + 1))).toBeNull()
  })
  it('respects read-only and supports a single undo', () => {
    const doc = 'before `code` after'
    expect(apply(create(doc, doc.indexOf('code'), doc.indexOf('code'), true))).toBeNull()
    let state = create(doc, doc.indexOf('code'))
    state = state.update(deleteCurrentStyle(state)!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(doc)
  })
})
