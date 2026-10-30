import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { createMarkdownParser } from './markdown-parser'
import { richClipboardExtension, richSelectionMarkdown } from './rich-clipboard'
import { createSelectionCopy, type SelectionCopyContext } from './selection-copy'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})
const prefix = 'text\n\n'.repeat(1800)
const suffix = '```js\nconst value = 1\n```\n\nAfter'
const doc = prefix + suffix
const from = doc.indexOf('value')
const create = (reverse = false) => EditorState.create({ doc, selection: EditorSelection.range(reverse ? doc.length : from, reverse ? from : doc.length), extensions: [markdown({ base: markdownLanguage })] })

describe('rich copy with incremental parsing', () => {
  it('keeps following paragraphs outside a partially selected late code fence', () => {
    for (const reverse of [false, true]) {
      const state = create(reverse)
      const selection = state.selection.main
      const text = richSelectionMarkdown(state, selection.from, selection.to)
      expect(text).toBe('```js\nvalue = 1\n```\n\nAfter')
      expect(createMarkdownParser().parse(text, {}).map(token => token.type)).toEqual(['fence', 'paragraph_open', 'inline', 'paragraph_close'])
      expect(state.doc.toString()).toBe(doc)
    }
  })
  it('rejects formatted copies without changing the clipboard when parsing cannot finish; Markdown copy still works', async () => {
    const state = create(), writes: string[] = []
    const view = { state, dom: { isConnected: true } } as unknown as EditorView
    const context: SelectionCopyContext = { documentId: 'one', revision: 0, mode: 'hybrid', markdownOptions: DEFAULT_MARKDOWN_OPTIONS, desktopApi: { writeClipboard: async content => { writes.push(content.text); return { ok: true, data: undefined } } } }
    const copy = createSelectionCopy(view, () => context)
    parserControl.incomplete = true
    try {
      await expect(copy('copy-html')).rejects.toThrow('无法安全复制')
      await expect(copy('copy-plain')).rejects.toThrow('无法安全复制')
      expect(writes).toEqual([])
      await expect(copy('copy-markdown')).resolves.toBe(true)
      expect(writes).toEqual([doc.slice(from)])
      expect(state.doc.toString()).toBe(doc)
    } finally { parserControl.incomplete = false }
  })
  it('prevents native rich-copy fallback and leaves clipboard untouched when parsing times out', () => {
    class FakeElement { closest() { return null } }
    vi.stubGlobal('Element', FakeElement)
    const write = vi.fn(), onError = vi.fn(), preventDefault = vi.fn()
    const view = { state: create(), contentDOM: { contains: () => true } } as unknown as EditorView
    const extension = richClipboardExtension(() => ({ mode: 'hybrid', api: { writeClipboard: write } as never, onError })) as unknown as { domEventHandlers: { copy(event: unknown, view: EditorView): boolean } }
    parserControl.incomplete = true
    try {
      const event = { target: new FakeElement(), defaultPrevented: false, preventDefault }
      expect(extension.domEventHandlers.copy(event, view)).toBe(true)
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('无法安全复制'))
      expect(write).not.toHaveBeenCalled()
    } finally { parserControl.incomplete = false; vi.unstubAllGlobals() }
  })
})
