import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { insertAdjacentParagraph } from './paragraph-insert'

function apply(source: string, position: number, side: 'before' | 'after') {
  const state = EditorState.create({ doc: source, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history()] })
  const transaction = insertAdjacentParagraph(state, side)
  if (!transaction) throw new Error('Expected insertion')
  const next = state.update(transaction).state
  const typed = next.update({ changes: { from: next.selection.main.head, insert: '新段落' }, userEvent: 'input.type' }).state
  return { state, next, typed }
}

describe('insert paragraph next to a Markdown block', () => {
  it('inserts around a multiline paragraph without modifying its source', () => {
    const source = '第一行\n第二行\n\n尾段'
    expect(apply(source, 3, 'before').typed.doc.toString()).toBe('新段落\n\n' + source)
    expect(apply(source, 3, 'after').typed.doc.toString()).toBe('第一行\n第二行\n\n新段落\n\n尾段')
  })
  it('inserts outside code fences rather than inside their contents', () => {
    const source = '前文\n\n```js\nconst x = 1\n```\n\n后文'
    const position = source.indexOf('const')
    expect(apply(source, position, 'before').typed.doc.toString()).toBe('前文\n\n新段落\n\n```js\nconst x = 1\n```\n\n后文')
    expect(apply(source, position, 'after').typed.doc.toString()).toBe('前文\n\n```js\nconst x = 1\n```\n\n新段落\n\n后文')
  })
  it('stays outside a code fence when the caret is on an empty code line', () => {
    const source = '```js\n\n```\n\n后文'
    expect(apply(source, 6, 'after').typed.doc.toString()).toBe('```js\n\n```\n\n新段落\n\n后文')
  })
  it('inserts outside tables and adjacent blocks', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后文'
    expect(apply(source, source.indexOf('1'), 'after').typed.doc.toString()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n新段落\n\n后文')
    expect(apply('前文\n# 标题', 5, 'before').typed.doc.toString()).toBe('前文\n\n新段落\n\n# 标题')
  })
  it('inserts outside front matter and display math as complete blocks', () => {
    const yaml = '---\ntitle: 示例\nauthor: A\n---\n\n正文'
    expect(apply(yaml, yaml.indexOf('title'), 'after').typed.doc.toString()).toBe('---\ntitle: 示例\nauthor: A\n---\n\n新段落\n\n正文')
    const math = '$$\nx + y\n$$\n\n正文'
    expect(apply(math, math.indexOf('x'), 'before').typed.doc.toString()).toBe('新段落\n\n$$\nx + y\n$$\n\n正文')
  })
  it('inserts adjacent to the nearest list item rather than the entire list', () => {
    const source = '- 一\n- 二\n- 三'
    expect(apply(source, source.indexOf('二'), 'before').typed.doc.toString()).toBe('- 一\n\n新段落\n\n- 二\n- 三')
    expect(apply(source, source.indexOf('二'), 'after').typed.doc.toString()).toBe('- 一\n- 二\n\n新段落\n\n- 三')
  })
  it('refuses nested list insertion that would detach siblings', () => {
    for (const source of ['- 父\n  - 子一\n  - 子二\n- 末', '> - 子一\n> - 子二']) {
      const state = EditorState.create({ doc: source, selection: { anchor: source.indexOf('子一') }, extensions: [markdown({ base: markdownLanguage })] })
      expect(insertAdjacentParagraph(state, 'after')).toBeNull()
    }
  })
  it('refuses insertion inside an unclosed fence', () => {
    const source = '```js\ncode'
    const state = EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [markdown({ base: markdownLanguage })] })
    expect(insertAdjacentParagraph(state, 'after')).toBeNull()
  })
  it('refuses unclosed HTML comments and raw blocks while allowing closed blocks', () => {
    for (const source of ['正文\n\n<!-- 未闭合', '正文\n\n<script>\nlet x = 1', '正文\n\n<style>\nbody {}']) {
      const state = EditorState.create({ doc: source, selection: { anchor: source.length - 1 }, extensions: [markdown({ base: markdownLanguage })] })
      expect(insertAdjacentParagraph(state, 'before')).toBeNull()
      expect(insertAdjacentParagraph(state, 'after')).toBeNull()
    }
    const closed = '正文\n\n<!-- 已闭合 -->'
    expect(apply(closed, closed.indexOf('已闭合'), 'after').typed.doc.toString()).toBe(closed + '\n\n新段落')
  })
  it('refuses an insertion when source exceeds the preview parser budget', () => {
    const state = EditorState.create({ doc: '---\ntitle: test\n---\n' + 'a'.repeat(200001), selection: { anchor: 5 }, extensions: [markdown({ base: markdownLanguage })] })
    expect(insertAdjacentParagraph(state, 'after')).toBeNull()
  })
  it('makes paragraph insertion independently undoable and respects read-only state', () => {
    const { state, next } = apply('原文', 1, 'after')
    let updated = next
    const target = { get state() { return updated }, dispatch(transaction: Parameters<typeof next.update>[0]) { updated = updated.update(transaction).state } }
    expect(undo(target as never)).toBe(true)
    expect(updated.doc.toString()).toBe(state.doc.toString())
    const readonly = EditorState.create({ doc: '原文', extensions: [EditorState.readOnly.of(true)] })
    expect(insertAdjacentParagraph(readonly, 'before')).toBeNull()
  })
})
