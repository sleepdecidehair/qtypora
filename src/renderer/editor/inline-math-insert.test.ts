import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { getMarkdownParser } from './markdown-parser'
import { toggleInlineMath } from './inline-math-insert'

function create(doc: string, from: number, to = from, options = DEFAULT_MARKDOWN_OPTIONS, readOnly = false): EditorState {
  return EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(options), EditorState.readOnly.of(readOnly), history()] })
}

describe('inline math formatting', () => {
  it('wraps a complete selected TeX expression and undoes in one step', () => {
    const original = '计算 \\alpha + x^2 完成'
    const from = original.indexOf('\\alpha'), to = original.indexOf(' 完成')
    let state = create(original, from, to)
    state = state.update(toggleInlineMath(state)!).state
    expect(state.doc.toString()).toBe('计算 $\\alpha + x^2$ 完成')
    expect(state.doc.sliceString(state.selection.main.from, state.selection.main.to)).toBe('\\alpha + x^2')
    expect(getMarkdownParser(DEFAULT_MARKDOWN_OPTIONS).render(state.doc.toString())).toContain('data-math="inline"')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
  })
  it('removes the delimiters only for a complete selected expression', () => {
    for (const [from, to] of [[2, 7], [3, 6]] as const) {
      const state = create('前 $x+1$ 后', from, to)
      expect(state.update(toggleInlineMath(state)!).state.doc.toString()).toBe('前 x+1 后')
    }
    expect(toggleInlineMath(create('前 $x+1$ 后', 4, 5))).toBeNull()
    expect(toggleInlineMath(create('前 $x+1$ 后', 4))).toBeNull()
  })
  it('does not change disabled, strict, read-only or empty selections', () => {
    expect(toggleInlineMath(create('x', 0))).toBeNull()
    expect(toggleInlineMath(create('x', 0, 1, { ...DEFAULT_MARKDOWN_OPTIONS, inlineMath: false }))).toBeNull()
    expect(toggleInlineMath(create('x', 0, 1, { ...DEFAULT_MARKDOWN_OPTIONS, strictMode: true }))).toBeNull()
    expect(toggleInlineMath(create('x', 0, 1, DEFAULT_MARKDOWN_OPTIONS, true))).toBeNull()
  })
  it('refuses unsafe markdown, unsupported delimiter boundaries and partial graphemes', () => {
    for (const [text, from, to] of [['`code`', 1, 5], ['[x](url)', 1, 2], ['&amp;', 1, 4], ['==x==', 2, 3], ['a\nb', 0, 3], ['x2', 0, 1], ['e\u0301', 0, 1], ['👩‍💻', 0, 2], [' x ', 0, 3]] as const) {
      expect(toggleInlineMath(create(text, from, to))).toBeNull()
    }
    expect(toggleInlineMath(create('e\u0301', 0, 2))).not.toBeNull()
  })
})
