import { describe, expect, it } from 'vitest'
import { createTextEdit } from './commands'

function apply(text: string, action: Parameters<typeof createTextEdit>[0], from: number, to: number, value?: string): string {
  const edit = createTextEdit(action, text, from, to, value)
  if (!edit) throw new Error('Expected text edit')
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

describe('Markdown text transactions', () => {
  it('bold toggling changes only the selected span and preserves unrelated syntax', () => {
    const original = 'before _legacy_\n中文 text\n<!-- untouched -->'
    const start = original.indexOf('中文')
    const changed = apply(original, 'bold', start, start + 2)
    expect(changed).toBe('before _legacy_\n**中文** text\n<!-- untouched -->')
    expect(apply(changed, 'bold', start + 2, start + 4)).toBe(original)
  })
  it('line commands do not accidentally include the line after a newline selection', () => {
    expect(apply('first\nsecond\nthird', 'ordered-list', 0, 13)).toBe('1. first\n2. second\nthird')
  })
  it('replaces a heading prefix instead of stacking incompatible prefixes', () => {
    expect(apply('### Title\nunchanged', 'heading-1', 4, 9)).toBe('# Title\nunchanged')
  })
  it('uses a longer fence when selected code already contains backticks', () => {
    expect(apply('```inside```', 'code', 0, 12)).toBe('````\n```inside```\n````\n')
  })
  it('inserts the image Markdown from the native image import unchanged', () => {
    expect(apply('abc', 'image', 1, 1, '![照片](./assets/照片.png)')).toBe('a![照片](./assets/照片.png)bc')
  })
  it('paragraph commands preserve content while removing structural syntax', () => {
    expect(apply('- [ ] task\nnext', 'paragraph', 0, 0)).toBe('task\nnext')
  })
  it('a second quote command restores the paragraph and leaves neighboring lines unchanged', () => {
    const original = 'before\n正文 **粗体** 与 [链接](https://example.com)\nafter'
    const start = original.indexOf('正文')
    const edit = createTextEdit('quote', original, start + 2, start + 2)!
    const quoted = apply(original, 'quote', start + 2, start + 2)
    expect(quoted).toBe(original.replace('正文', '> 正文'))
    expect(apply(quoted, 'quote', edit.selection.anchor, edit.selection.head)).toBe(original)
  })
  it('quote toggling preserves headings, lists and blank lines across the selected range', () => {
    const original = '# 标题\n\n- [x] 事项\n下一行'
    const to = original.indexOf('下一行')
    const edit = createTextEdit('quote', original, 0, to)!
    const quoted = apply(original, 'quote', 0, to)
    expect(quoted).toBe('> # 标题\n> \n> - [x] 事项\n下一行')
    expect(apply(quoted, 'quote', edit.selection.anchor, edit.selection.head)).toBe(original)
  })
  it('a mixed selection quotes plain lines without adding a level to existing quotes', () => {
    const original = '> 已有引用\n普通段落\n> > 嵌套引用'
    expect(apply(original, 'quote', original.length, 0)).toBe('> 已有引用\n> 普通段落\n> > 嵌套引用')
  })
  it('removes one quote level and preserves indentation and markers within the content', () => {
    const original = '  > > **嵌套**\n >\t- [x] 事项\n>无空格引用'
    expect(apply(original, 'quote', 0, original.length)).toBe('  > **嵌套**\n - [x] 事项\n无空格引用')
  })
  it('unquoted blank lines inside a selected quote do not prevent cancellation', () => {
    const original = '> 第一段\n\n> 第二段'
    expect(apply(original, 'quote', 0, original.length)).toBe('第一段\n\n第二段')
  })
  it('an empty paragraph can enter and leave quote mode', () => {
    const edit = createTextEdit('quote', '', 0, 0)!
    expect(edit.insert).toBe('> ')
    expect(apply(edit.insert, 'quote', edit.selection.anchor, edit.selection.head)).toBe('')
  })
  it('an empty first line produces a valid quote transaction and leaves the following paragraph unchanged', () => {
    const original = '\n后续内容'
    const edit = createTextEdit('quote', original, 0, 0)!
    expect(edit).toEqual({ from: 0, to: 0, insert: '> ', selection: { anchor: 0, head: 2 } })
    const quoted = apply(original, 'quote', 0, 0)
    expect(quoted).toBe('> \n后续内容')
    expect(apply(quoted, 'quote', edit.selection.anchor, edit.selection.head)).toBe(original)
  })
})
