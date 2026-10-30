import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { htmlPasteContext } from './html-paste-context'

const parser = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parser.incomplete ? null : actual.ensureSyntaxTree(...args) }
})
const state = (doc: string, from: number, to = from) => EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [markdown({ base: markdownLanguage })] })

describe('HTML paste target classification', () => {
  beforeEach(() => { parser.incomplete = false })
  it('uses literal text in a fenced body and normal conversion outside it', () => {
    const doc = '```js\nfirst\nlast\n```\n\nAfter'
    expect(htmlPasteContext(state(doc, doc.indexOf('last')), 'value\n')).toMatchObject({ kind: 'code' })
    expect(htmlPasteContext(state(doc, doc.indexOf('After')), 'value')).toEqual({ kind: 'normal' })
    const unclosed = '```js\nunfinished'
    expect(htmlPasteContext(state(unclosed, unclosed.length), 'more')).toMatchObject({ kind: 'code' })
  })
  it('refuses text that could close the enclosing fence or cross it', () => {
    const doc = '```js\nfirst\nlast\n```\n\nAfter'
    expect(htmlPasteContext(state(doc, doc.indexOf('last')), '```\n')).toEqual({ kind: 'unsafe' })
    expect(htmlPasteContext(state(doc, doc.indexOf('last'), doc.indexOf('After') + 2), 'value')).toEqual({ kind: 'unsafe' })
    expect(htmlPasteContext(state(doc, 2), 'value')).toEqual({ kind: 'unsafe' })
  })
  it('handles inline code safely and conservatively refuses nested fences', () => {
    expect(htmlPasteContext(state('`abc`', 2), 'new')).toMatchObject({ kind: 'code' })
    expect(htmlPasteContext(state('`abc`', 2), '`')).toEqual({ kind: 'unsafe' })
    expect(htmlPasteContext(state('`abc`', 2), '\n')).toEqual({ kind: 'unsafe' })
    const doc = '> ```\n> abc\n> ```'
    expect(htmlPasteContext(state(doc, doc.indexOf('abc') + 1), 'new')).toEqual({ kind: 'code', text: 'new' })
  })
  it.each([
    ['> ```js\n> first\n> last\n> ```', '> '],
    ['- ```js\n  first\n  last\n  ```', '  '],
    ['> - ```js\n>   first\n>   last\n>   ```', '>   '],
  ])('retains a proven nested container prefix: %s', (doc, prefix) => {
    const position = doc.indexOf('last')
    expect(htmlPasteContext(state(doc, position), 'value\n')).toEqual({ kind: 'code', text: `value\n${prefix}` })
    expect(htmlPasteContext(state(doc, position), '```\n')).toEqual({ kind: 'unsafe' })
    expect(htmlPasteContext(state(doc, position - prefix.length), 'value')).toEqual({ kind: 'unsafe' })
  })
  it('supports an empty nested body, selections and leading/trailing newlines', () => {
    const empty = '> ```\n> \n> ```'
    expect(htmlPasteContext(state(empty, empty.indexOf('> \n') + 2), '\na\n')).toEqual({ kind: 'code', text: '\n> a\n> ' })
    const doc = '> ```\n> first\n> last\n> ```'
    const first = doc.indexOf('first')
    expect(htmlPasteContext(state(doc, first, first + 5), 'A\nB')).toEqual({ kind: 'code', text: 'A\n> B' })
    expect(htmlPasteContext(state(doc, first, doc.indexOf('last') + 2), 'x')).toEqual({ kind: 'unsafe' })
  })
  it('refuses incomplete fences and unverified nested prefixes', () => {
    const unclosed = '> ```\n> abc'
    expect(htmlPasteContext(state(unclosed, unclosed.length), 'x')).toEqual({ kind: 'unsafe' })
    const inconsistent = '> ```\n>first\n> last\n> ```'
    expect(htmlPasteContext(state(inconsistent, inconsistent.indexOf('last')), 'x')).toEqual({ kind: 'unsafe' })
  })
  it('protects the indentation of each indented code line while allowing body edits', () => {
    const doc = '    first\n    last\n\nAfter'
    for (const position of [0, 1, 2, 3, 10, 11, 12, 13]) expect(htmlPasteContext(state(doc, position), 'X')).toEqual({ kind: 'unsafe' })
    for (const position of [4, 5, 14, 15]) expect(htmlPasteContext(state(doc, position), 'X')).toEqual({ kind: 'code', text: 'X' })
    expect(htmlPasteContext(state(doc, 14, 16), 'X')).toEqual({ kind: 'code', text: 'X' })
    expect(htmlPasteContext(state(doc, 12, 16), 'X')).toEqual({ kind: 'unsafe' })
    expect(htmlPasteContext(state(doc, 14), 'X\n')).toEqual({ kind: 'unsafe' })
  })
  it('refuses the operation if parsing cannot finish', () => {
    parser.incomplete = true
    expect(htmlPasteContext(state('plain', 2), 'text')).toEqual({ kind: 'unsafe' })
  })
})
