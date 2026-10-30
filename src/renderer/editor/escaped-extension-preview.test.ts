import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { createMarkdownParser } from './markdown-parser'
import { inlinePreviewSpans } from './live-inline'

const state = (doc: string) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage })] })

describe('escaped delimiters in inline extension preview', () => {
  it.each([
    ['==\\=\\=baz\\=\\===', 'cm-live-highlight', '<mark>==baz==</mark>'],
    ['^\\^bar\\^^', 'cm-live-superscript', '<sup>^bar^</sup>'],
    ['~\\~bar\\~~', 'cm-live-subscript', '<sub>~bar~</sub>'],
  ])('renders escaped literal delimiters within formatting: %s', (doc, className, html) => {
    const current = state(doc)
    expect(createMarkdownParser().render(doc)).toContain(html)
    expect(inlinePreviewSpans(current).some(span => span.className === className)).toBe(true)
    expect(current.doc.toString()).toBe(doc)
  })
  it('does not turn code or escaped opening markers into extension previews', () => {
    for (const doc of ['`==\\=x\\===`', '\\==foo==', '`^\\^bar\\^^`']) {
      expect(inlinePreviewSpans(state(doc)).some(span => ['cm-live-highlight', 'cm-live-superscript'].includes(span.className || ''))).toBe(false)
    }
  })
})
