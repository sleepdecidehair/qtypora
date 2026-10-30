import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { inlinePreviewSpans } from './live-inline'

const state = (doc: string, anchor = doc.length) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] })

describe('multiline highlight preview', () => {
  it.each(['==foo\\\nbar==', '==foo\nbar=='])('renders one parsed paragraph without modifying source: %s', doc => {
    const current = state(doc)
    const spans = inlinePreviewSpans(current)
    expect(spans).toContainEqual({ from: 0, to: doc.length, className: 'cm-live-highlight' })
    expect(spans).toContainEqual({ from: 0, to: 2, hidden: true })
    expect(spans).toContainEqual({ from: doc.length - 2, to: doc.length, hidden: true })
    expect(current.doc.toString()).toBe(doc)
    const editing = inlinePreviewSpans(state(doc, 3))
    expect(editing.some(span => span.hidden && span.from === 0)).toBe(false)
  })
  it.each(['```\n==foo\nbar==\n```', '==foo\n\nbar==', '==foo `code`\nbar=='])('conservatively skips unsafe structures: %s', doc => {
    expect(inlinePreviewSpans(state(doc)).some(span => span.className === 'cm-live-highlight')).toBe(false)
  })
  it('does not style an unparsed late paragraph', () => {
    const prefix = 'text\n\n'.repeat(1800)
    const doc = prefix + '==foo\nbar=='
    expect(inlinePreviewSpans(state(doc)).some(span => span.from >= prefix.length && span.className === 'cm-live-highlight')).toBe(false)
  })
})

describe('container multiline highlights', () => {
  it.each(['> ==foo\n> bar==', '- ==foo\n  bar==', '> - ==foo\\\n>   bar=='])('maps parsed container content to source: %s', doc => {
    const current = state(doc)
    const from = doc.indexOf('=='), to = doc.lastIndexOf('==') + 2
    const spans = inlinePreviewSpans(current)
    expect(spans).toContainEqual({ from, to, className: 'cm-live-highlight' })
    expect(spans).toContainEqual({ from, to: from + 2, hidden: true })
    expect(spans).toContainEqual({ from: to - 2, to, hidden: true })
    expect(current.doc.toString()).toBe(doc)
    expect(inlinePreviewSpans(state(doc, from + 3)).some(span => span.hidden && span.from === from)).toBe(false)
  })
  it.each(['- ==foo\n- bar==', '> ==foo `code`\n> bar==', '- ==foo\n\n  bar=='])('does not join separate blocks or code: %s', doc => {
    expect(inlinePreviewSpans(state(doc)).some(span => span.className === 'cm-live-highlight')).toBe(false)
  })
})
