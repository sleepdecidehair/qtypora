import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { inlinePreviewSpans } from './live-inline'

const prefix = 'text\n\n'.repeat(1800)
const create = (suffix: string) => EditorState.create({ doc: prefix + suffix, extensions: [markdown({ base: markdownLanguage })] })

describe('inline preview during incremental parsing', () => {
  it('never decorates unparsed code as extensions, even after parsing catches up', () => {
    const state = create('```js\n:smile: ==highlight==\n```')
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length)
    expect(inlinePreviewSpans(state).filter(span => span.from >= prefix.length)).toEqual([])
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    const parsed = state.update({}).state
    expect(inlinePreviewSpans(parsed).filter(span => span.from >= prefix.length)).toEqual([])
  })

  it('enables ordinary extensions after parsing reaches the paragraph', () => {
    const state = create(':smile: ==highlight==')
    expect(inlinePreviewSpans(state).filter(span => span.from >= prefix.length)).toEqual([])
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    const parsed = state.update({}).state
    const spans = inlinePreviewSpans(parsed).filter(span => span.from >= prefix.length)
    expect(spans.some(span => span.replacement === '😄')).toBe(true)
    expect(spans.some(span => span.className === 'cm-live-highlight')).toBe(true)
  })
})
