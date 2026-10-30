import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { focusedParagraphLines } from './focus-paragraph'

function state(doc: string, position: number) {
  return EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })] })
}

describe('focus mode paragraph range', () => {
  it('keeps both source lines of a plain paragraph focused', () => {
    const doc = 'first **bold**\nsecond\n\nother'
    expect(focusedParagraphLines(state(doc, 5))).toEqual({ first: 1, last: 2 })
    expect(focusedParagraphLines(state(doc, doc.indexOf('second') + 2))).toEqual({ first: 1, last: 2 })
    expect(focusedParagraphLines(state(doc, doc.indexOf('other')))).toEqual({ first: 4, last: 4 })
  })
  it('follows a parsed quote or list paragraph without including sibling items', () => {
    const quote = '> first\n> second\n\n> other'
    expect(focusedParagraphLines(state(quote, 3))).toEqual({ first: 1, last: 2 })
    const list = '- first\n  second\n- sibling\n  more'
    expect(focusedParagraphLines(state(list, 3))).toEqual({ first: 1, last: 2 })
    expect(focusedParagraphLines(state(list, list.indexOf('sibling') + 1))).toEqual({ first: 3, last: 4 })
  })
  it('does not widen focus inside code', () => {
    expect(focusedParagraphLines(state('```\nfirst\nsecond\n```', 5))).toEqual({ first: 2, last: 2 })
  })
  it('focuses a whole task without including sibling tasks or nested code', () => {
    const doc = '- [ ] first\n  second\n- [x] sibling\n  more\n  ```\n  code\n  other\n  ```'
    expect(focusedParagraphLines(state(doc, doc.indexOf('first')))).toEqual({ first: 1, last: 2 })
    expect(focusedParagraphLines(state(doc, doc.indexOf('second')))).toEqual({ first: 1, last: 2 })
    expect(focusedParagraphLines(state(doc, doc.indexOf('sibling')))).toEqual({ first: 3, last: 4 })
    expect(focusedParagraphLines(state(doc, doc.indexOf('code')))).toEqual({ first: 6, last: 6 })
  })
})
