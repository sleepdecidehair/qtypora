import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { validClipboardRtf } from '../../main/clipboard'
import { escapeRtfText, richFragmentToRtf, richSelectionMarkdown } from './rich-clipboard'

function fragment(markup: string): Node {
  return new DOMParser().parseFromString(`<div>${markup}</div>`, 'text/xml').documentElement as unknown as Node
}

describe('rich clipboard serialization', () => {
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
    expect(richSelectionMarkdown(state, doc.indexOf('value'), doc.indexOf('value') + 5)).toBe('value')
  })
})
