import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { validClipboardRtf } from '../../main/clipboard'
import { assertFormattedCopySize, escapeRtfText, richFragmentToRtf, richSelectionMarkdown, literalCodeSelection } from './rich-clipboard'

function fragment(markup: string): Node {
  return new DOMParser().parseFromString(`<div>${markup}</div>`, 'text/xml').documentElement as unknown as Node
}

describe('rich clipboard serialization', () => {
  it('enforces the formatted-copy budget with a localized error', () => {
    expect(() => assertFormattedCopySize(200000)).not.toThrow()
    expect(() => assertFormattedCopySize(200001)).toThrow('选区过大')
    expect(() => assertFormattedCopySize(200001, 'en-US')).toThrow('selection is too large')
  })
  it('escapes literal braces, backslashes, emoji and non-ASCII text as inert RTF', () => {
    expect(escapeRtfText('A{b}\\object 中文😀')).toBe('A\\{b\\}\\\\object \\u20013?\\u25991?\\u-10179?\\u-8704?')
    const output = richFragmentToRtf(fragment('<p>A{b}\\object 中文😀</p>'))
    expect(validClipboardRtf(output.rtf)).toBe(true)
    expect(output.rtf).toContain('\\\\object ')
    expect(output.plain).toBe('A{b}\\object 中文😀')
  })
  it('preserves basic semantic formatting, list labels, tables and image alternatives', () => {
    const output = richFragmentToRtf(fragment('<h2>Title</h2><p><strong>bold</strong> and <em>italic</em><br/>next</p><ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table><img alt="example"/>'))
    expect(validClipboardRtf(output.rtf)).toBe(true)
    expect(output.rtf).toContain('\\b bold')
    expect(output.rtf).toContain('\\i italic')
    expect(output.rtf).toContain('\\tab b')
    expect(output.plain).toContain('Title\nbold and italic\nnext\n• one\n• two')
    expect(output.plain).toContain('a\tb\nexample')
  })
  it('preserves ordered-list numbering, custom starts and nested list kinds', () => {
    const output = richFragmentToRtf(fragment('<ol start="4">\n<li>one\n<ul>\n<li>inner</li>\n</ul>\n</li>\n<li value="9">two</li>\n<li>three</li>\n</ol>\n<ul>\n<li>bullet</li>\n</ul>'))
    expect(output.plain).toBe('4. one\n• inner\n9. two\n10. three\n• bullet')
    expect(output.rtf).toContain('4. one')
    expect(output.rtf).toContain('9. two')
    expect(validClipboardRtf(output.rtf)).toBe(true)
  })
  it('includes only inert computed font and color data for theme copying', () => {
    const output = richFragmentToRtf(fragment('<p>example</p>'), 30, { fontFamily: 'A;\\object, serif', color: [15, 42, 99] })
    expect(output.rtf).toContain('\\red15\\green42\\blue99;')
    expect(output.rtf).toContain('\\fs30 ')
    expect(output.rtf).toContain('A\\\\object;')
    expect(validClipboardRtf(output.rtf)).toBe(true)
  })
  it('rejects pathological nesting before producing a partial result', () => {
    const source = '<span>'.repeat(70) + 'text' + '</span>'.repeat(70)
    expect(() => richFragmentToRtf(fragment(source))).toThrow('嵌套过深')
  })
})


describe('rich selection across code fences', () => {
  const doc = '前文\n\n```ts\nconst value = 1\n```\n\n后文'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  it('balances a partially selected code block at either boundary', () => {
    expect(richSelectionMarkdown(state, doc.indexOf('value'), doc.length)).toBe('```ts\nvalue = 1\n```\n\n后文')
    expect(richSelectionMarkdown(state, 0, doc.indexOf('value') + 5)).toBe('前文\n\n```ts\nconst value\n```')
  })
  it('preserves complete blocks and code-only selections', () => {
    expect(richSelectionMarkdown(state, 0, doc.length)).toBe(doc)
    expect(richSelectionMarkdown(state, doc.indexOf('value'), doc.indexOf('value') + 5)).toBe('```ts\nvalue\n```')
  })
})

describe('literal code selections', () => {
  it.each(['```js\n**hello**\n```', '```js\n**hello**'])('keeps Markdown punctuation literal in closed and open fences: %s', async doc => {
    const { createMarkdownParser } = await import('./markdown-parser')
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const from = doc.indexOf('**hello**')
    const copied = richSelectionMarkdown(state, from, from + 9)
    const tokens = createMarkdownParser().parse(copied, {})
    expect(tokens).toHaveLength(1)
    expect(tokens[0].type).toBe('fence')
    expect(tokens[0].content).toBe('**hello**\n')
  })
  it('chooses a fence longer than delimiters inside copied code', async () => {
    const { createMarkdownParser } = await import('./markdown-parser')
    const doc = '````js\n**hello**\n```\nworld\n````'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const from = doc.indexOf('**hello**'), to = doc.indexOf('world') + 5
    const tokens = createMarkdownParser().parse(richSelectionMarkdown(state, from, to), {})
    expect(tokens).toHaveLength(1)
    expect(tokens[0].content).toBe('**hello**\n```\nworld\n')
  })
})

describe('code inside containers', () => {
  it.each(['> ```\n> **hello**\n> ```', '- ```\n  **hello**\n  ```'])('copies the selected code literally: %s', async doc => {
    const { createMarkdownParser } = await import('./markdown-parser')
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const from = doc.indexOf('**hello**')
    const tokens = createMarkdownParser().parse(richSelectionMarkdown(state, from, from + 9), {})
    expect(tokens).toHaveLength(1)
    expect(tokens[0].type).toBe('fence')
    expect(tokens[0].content).toBe('**hello**\n')
  })
})

describe('exact code clipboard text', () => {
  it.each(['hello\n', 'hello\n\n', 'hello'])('preserves selected trailing newlines: %s', text => {
    const doc = '```\n' + text + (text.endsWith('\n') ? '' : '\n') + '```'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(literalCodeSelection(state, 4, 4 + text.length)).toBe(text)
    const output = richFragmentToRtf(fragment('<pre><code>' + text + '</code></pre>'), 24, undefined, true)
    expect(output.plain).toBe(text)
    expect((output.rtf.match(/\\line /g) || []).length).toBe((text.match(/\n/g) || []).length)
    expect(validClipboardRtf(output.rtf)).toBe(true)
  })
  it('does not treat a selection crossing the closing fence as code only', () => {
    const doc = '```\nhello\n```\n\nAfter'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(literalCodeSelection(state, 4, doc.length)).toBeNull()
  })
})

describe('container code copy mapping', () => {
  it.each([
    '> ```\n> one\n> two\n> ```',
    '- ```\n  one\n  two\n  ```',
    '> - ```\n>   one\n>   two\n>   ```',
  ])('removes only proven container prefixes: %s', doc => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(literalCodeSelection(state, doc.indexOf('one'), doc.indexOf('two') + 3)).toBe('one\ntwo')
  })
  it('rejects selections starting inside container syntax', () => {
    const doc = '> ```\n> one\n> two\n> ```'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(() => literalCodeSelection(state, doc.indexOf('> one'), doc.indexOf('two') + 3)).toThrow('无法安全复制')
  })
})

describe('partial code in container cross-block copies', () => {
  it.each([
    '> Intro\n>\n> ```\n> **hello**\n> ```\n\nAfter',
    '- Intro\n\n  ```\n  **hello**\n  ```\n\nAfter',
  ])('uses parsed code without container prefixes: %s', async doc => {
    const { createMarkdownParser } = await import('./markdown-parser')
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const end = doc.indexOf('hello') + 5
    const copied = richSelectionMarkdown(state, doc.indexOf('Intro'), end)
    const token = createMarkdownParser().parse(copied, {}).find(token => token.type === 'fence')
    expect(token?.content).toBe('**hello\n')
  })
})
