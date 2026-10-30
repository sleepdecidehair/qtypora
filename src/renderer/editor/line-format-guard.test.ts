import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { canFormatSelectedLines } from './line-format-guard'

function state(doc: string, anchor: number, head = anchor, readOnly = false) {
  return EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(readOnly)] })
}

describe('line formatting protects code blocks', () => {
  const source = 'before\n\n```js\n# keep\n- item\n```\n\nafter'
  it('rejects code body, fence, and a selection spanning code', () => {
    for (const position of [source.indexOf('```'), source.indexOf('# keep'), source.lastIndexOf('```')]) expect(canFormatSelectedLines(state(source, position))).toBe(false)
    expect(canFormatSelectedLines(state(source, 0, source.length))).toBe(false)
    expect(canFormatSelectedLines(state(source, source.length, 0))).toBe(false)
  })
  it('allows surrounding paragraphs, lists and quotes', () => {
    expect(canFormatSelectedLines(state(source, 0))).toBe(true)
    expect(canFormatSelectedLines(state(source, source.indexOf('after')))).toBe(true)
    expect(canFormatSelectedLines(state('- item\n> quote', 0, 14))).toBe(true)
    expect(canFormatSelectedLines(state('text', 0, 0, true))).toBe(false)
  })
  it('rejects indented and unclosed fenced code', () => {
    expect(canFormatSelectedLines(state('    code', 2))).toBe(false)
    expect(canFormatSelectedLines(state('```\ncode', 5))).toBe(false)
  })
  it('rejects tables, HTML blocks and link definitions without rejecting neighboring text', () => {
    for (const block of ['| a | b |\n|---|---|\n| c | d |', '<div>\n# keep\n</div>', '[ref]: /target']) {
      const document = `before\n\n${block}\n\nafter`
      expect(canFormatSelectedLines(state(document, 0, document.length))).toBe(false)
      expect(canFormatSelectedLines(state(document, document.indexOf(block)))).toBe(false)
      expect(canFormatSelectedLines(state(document, 0))).toBe(true)
      expect(canFormatSelectedLines(state(document, document.indexOf('after')))).toBe(true)
    }
  })
  it('uses the application parser to protect YAML and block math while allowing neighbors', () => {
    const doc = '---\n- key: value\n---\n\nbefore\n\n$$\n# keep\n$$\n\nafter'
    expect(canFormatSelectedLines(state(doc, doc.indexOf('key')))).toBe(false)
    expect(canFormatSelectedLines(state(doc, doc.indexOf('# keep')))).toBe(false)
    expect(canFormatSelectedLines(state(doc, doc.indexOf('before')))).toBe(true)
    expect(canFormatSelectedLines(state(doc, doc.indexOf('after')))).toBe(true)
    expect(canFormatSelectedLines(state(doc, 0, doc.length))).toBe(false)
    const unclosed = `$$\n${'formula\n'.repeat(250)}text`
    expect(canFormatSelectedLines(state(unclosed, unclosed.length))).toBe(false)
    const codeThenParagraph = '```\n$$\n```\n\nplain'
    expect(canFormatSelectedLines(state(codeThenParagraph, codeThenParagraph.length))).toBe(true)
  })
  it('bounds semantic parsing for large documents that may contain extended blocks', () => {
    const text = `${'a'.repeat(200001)}\n\n$$\nx\n$$`
    const parsedText = state(text, 0)
    expect(ensureSyntaxTree(parsedText, text.length, 10000)?.length).toBe(text.length)
    expect(canFormatSelectedLines(parsedText)).toBe(true)
    expect(canFormatSelectedLines(state(text, text.lastIndexOf('x')))).toBe(false)
    const distant = `$$\nx\n$$\n${'line\n'.repeat(300)}${'a'.repeat(200001)}`
    expect(canFormatSelectedLines(state(distant, distant.length))).toBe(false)
    const dollar = `${'a'.repeat(200001)} $5`
    const parsedDollar = state(dollar, 0)
    expect(ensureSyntaxTree(parsedDollar, dollar.length, 10000)?.length).toBe(dollar.length)
    expect(canFormatSelectedLines(parsedDollar)).toBe(true)
  })
})
