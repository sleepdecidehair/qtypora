import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { markdownCompletionSource } from './markdown-completion'

const parser = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return {
    ...actual,
    ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) =>
      parser.incomplete ? null : actual.ensureSyntaxTree(...args),
  }
})

const state = (doc: string) => EditorState.create({
  doc,
  selection: { anchor: doc.length },
  extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(DEFAULT_MARKDOWN_OPTIONS)],
})
const complete = (current: EditorState) => markdownCompletionSource(new CompletionContext(current, current.doc.length, false))

describe('completion with delayed Markdown parsing', () => {
  beforeEach(() => { parser.incomplete = false })

  it('does not offer emoji completion in a late fenced code block', () => {
    const doc = 'text\n\n'.repeat(1800) + '```js\n:smi'
    const current = state(doc)
    expect(complete(current)).toBeNull()
    expect(current.doc.toString()).toBe(doc)
  })

  it('keeps ordinary completion available in late paragraphs', () => {
    const doc = 'text\n\n'.repeat(1800) + 'Text :smi'
    const current = state(doc)
    expect(complete(current)?.options.map(option => option.label)).toContain(':smile:')
    expect(current.doc.toString()).toBe(doc)
  })

  it('returns no candidates when parsing cannot reach the cursor without changing input', () => {
    parser.incomplete = true
    const current = state('Text :smi')
    expect(complete(current)).toBeNull()
    const next = current.update({ changes: { from: current.doc.length, insert: 'x' } }).state
    expect(next.doc.toString()).toBe('Text :smix')
  })
})
