import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { canFormatInlineSelection } from './inline-format-guard'

function state(doc: string, anchor: number, head = anchor) {
  return EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage })] })
}

describe('inline formatting protects block structures', () => {
  it('rejects code fence, code body and cross-block selections', () => {
    const doc = 'text\n\n```js\nconst value = 1\n```\n\nafter'
    expect(canFormatInlineSelection(state(doc, 0, doc.length))).toBe(false)
    expect(canFormatInlineSelection(state(doc, doc.indexOf('const')))).toBe(false)
    expect(canFormatInlineSelection(state(doc, doc.indexOf('```'), doc.indexOf('```') + 3))).toBe(false)
    expect(canFormatInlineSelection(state(doc, 0, 4))).toBe(true)
    expect(canFormatInlineSelection(state(doc, doc.length))).toBe(true)
  })
  it('permits an individual table cell but refuses a selection spanning cells', () => {
    const doc = '| first | second |\n| --- | --- |\n| a | b |'
    const first = doc.indexOf('first'), second = doc.indexOf('second')
    expect(canFormatInlineSelection(state(doc, first, first + 5))).toBe(true)
    expect(canFormatInlineSelection(state(doc, first, second + 6))).toBe(false)
  })
  it('rejects HTML, references, YAML and math blocks', () => {
    for (const doc of ['<div>\ntext\n</div>', '[ref]: /target', '---\nkey: value\n---', '$$\nformula\n$$']) expect(canFormatInlineSelection(state(doc, 0, doc.length))).toBe(false)
  })
})
