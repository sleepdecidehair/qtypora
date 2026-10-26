import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'
import { markdownDefinitions } from './markdown-references'
import { markdownCompletionSource } from './markdown-completion'
import { liveBlocks } from './live-blocks'
import { inlinePreviewSpans } from './live-inline'
import { resolveFootnote } from '../hooks/outline'

const state = (doc: string, anchor = doc.length, emoji = true) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, emoji })] })

describe('reference and footnote editing', () => {
  it('retains exact multiline definition ranges while excluding fenced and YAML examples', () => {
    const source = '---\ntitle: "[^no]: hidden"\n---\n\nUse[^n] and [site][REF].\n\n[^n]: First\n\n    Second **line**\n\n[Ref]: https://example.com "Example"\n\n```\n[^fake]: code\n```\n'
    const current = state(source)
    expect(markdownDefinitions(markdownDocumentModel(current).environment)).toEqual([
      { kind: 'footnote', label: 'n', line: 7, endLine: 10 },
      { kind: 'reference', label: 'Ref', line: 11, endLine: 11 },
    ])
    const footnote = liveBlocks(current).find(block => block.kind === 'footnote')
    expect(footnote?.source).toBe('[^n]: First\n\n    Second **line**\n')
    expect(footnote?.html).toContain('<strong>line</strong>')
    expect(footnote?.html).toContain('href="#fnref1"')
    expect(resolveFootnote(source, '#fn1')).toBe(7)
    expect(resolveFootnote(source, '#fnref1')).toBe(5)
    expect(inlinePreviewSpans(current).find(span => span.href === '#fn1')?.replacement).toBe('[1]')
    expect(inlinePreviewSpans(current).some(span => span.href === 'https://example.com')).toBe(true)
  })
  it('provides emoji and existing reference completion without changing source or including code', () => {
    const doc = '[Link]: https://example.com\n\n[^note]: Footnote\n\n:smi'
    const current = state(doc)
    const suggestions = markdownCompletionSource(new CompletionContext(current, current.doc.length, false))
    expect(suggestions?.options.find(option => option.label === ':smile:')).toMatchObject({ detail: '😄', apply: ':smile:' })
    expect(current.doc.toString()).toBe(doc)
    expect(markdownCompletionSource(new CompletionContext(state(':smi', 4, false), 4, false))).toBeNull()
    const reference = state('[Label]: https://example.com\n\n[text][La')
    expect(markdownCompletionSource(new CompletionContext(reference, reference.doc.length, false))?.options.map(option => option.label)).toContain('[Label]')
    const footnote = state('[^note]: Content\n\n[^no')
    expect(markdownCompletionSource(new CompletionContext(footnote, footnote.doc.length, false))?.options.map(option => option.label)).toContain('[^note]')
    for (const source of ['```\n:smi', '` :smi `', '---\ntitle: :smi\n---']) {
      const position = source.indexOf(':smi') + 4
      expect(markdownCompletionSource(new CompletionContext(state(source, position), position, false))).toBeNull()
    }
  })
  it('maps repeated footnotes back to the selected source reference without matching literal examples', () => {
    const source = '`[^n]`\n\nFirst[^n]\nsecond[^n]\n\n[^n]: note'
    expect(resolveFootnote(source, '#fnref1')).toBe(3)
    expect(resolveFootnote(source, '#fnref1:1')).toBe(4)
    expect(resolveFootnote(source, '#fn9')).toBeNull()
    expect(resolveFootnote(source, '#fn1', { ...DEFAULT_MARKDOWN_OPTIONS, footnotes: false })).toBeNull()
  })
})
