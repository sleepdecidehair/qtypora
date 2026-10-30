import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'
import { DEFAULT_IMAGE_OPTIONS } from '../../shared/image-options'
import { MAX_DOCUMENT_BYTES } from '../../shared/document-size'
import { clipboardImportExtension, type ClipboardImportContext } from './clipboard-import'

function run(doc: string, plain: string, options: { bom?: boolean; crlf?: boolean; selectAll?: boolean; partial?: boolean; mode?: 'hybrid' | 'source'; smartPaste?: boolean; html?: boolean } = {}) {
  const onError = vi.fn(), preventDefault = vi.fn()
  const context = { snapshot: { id: 'one' }, mode: options.mode ?? 'hybrid', readOnly: false, encoding: options.bom ? 'utf8-bom' : 'utf8', lineEnding: options.crlf ? 'CRLF' : 'LF', imageOptions: { ...DEFAULT_IMAGE_OPTIONS, smartPaste: options.smartPaste ?? true }, onError } as unknown as ClipboardImportContext
  const extension = clipboardImportExtension(() => context)
  const state = EditorState.create({ doc, selection: options.selectAll ? { anchor: 0, head: doc.length } : options.partial ? { anchor: 0, head: 5 } : { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), extension] })
  const plugin = (extension as unknown as [{}, { domEventHandlers: { paste(event: unknown, view: EditorView): boolean } }])[1]
  const event = { clipboardData: { files: [], getData: (type: string) => type === 'text/html' && options.html ? 'x'.repeat(MAX_DOCUMENT_BYTES + 1) : type === 'text/plain' ? plain : '' }, preventDefault }
  const handled = plugin.domEventHandlers.paste(event, { state } as unknown as EditorView)
  const transaction = state.update(state.replaceSelection(plain), { userEvent: 'input.paste' })
  return { handled, onError, preventDefault, state, transaction }
}

describe('native plain-text paste size', () => {
  it.each([false, true])('rejects over-limit native paste (HTML fallback %s)', async html => {
    const result = run('Before', 'x'.repeat(MAX_DOCUMENT_BYTES), { html })
    expect(result.handled).toBe(false)
    expect(result.transaction.docChanged).toBe(false)
    await vi.waitFor(() => expect(result.onError).toHaveBeenCalledWith('粘贴后的文件将超过 16 MB，未执行粘贴。'))
    expect(result.state.doc.toString()).toBe('Before')
  })
  it('includes BOM and CRLF in the final size', async () => {
    const result = run('Before\n', 'x'.repeat(MAX_DOCUMENT_BYTES - 10), { bom: true, crlf: true })
    expect(result.transaction.docChanged).toBe(false)
    await vi.waitFor(() => expect(result.onError).toHaveBeenCalledOnce())
  })
  it.each([{ mode: 'source' as const }, { smartPaste: false }])('retains normal native paste with options %o', options => {
    const result = run('Before', 'small', options)
    expect(result.handled).toBe(false)
    expect(result.transaction.newDoc.toString()).toBe('Beforesmall')
    expect(result.onError).not.toHaveBeenCalled()
  })
  it('allows a replacement that shrinks an already oversized document', () => {
    const result = run('x'.repeat(MAX_DOCUMENT_BYTES + 10), 'short', { selectAll: true, mode: 'source' })
    expect(result.transaction.newDoc.toString()).toBe('short')
    expect(result.onError).not.toHaveBeenCalled()
  })
  it('allows partial reduction even when the document remains oversized', () => {
    const result = run('x'.repeat(MAX_DOCUMENT_BYTES + 10), 'y', { partial: true, mode: 'source' })
    expect(result.transaction.newDoc.length).toBe(MAX_DOCUMENT_BYTES + 6)
    expect(result.onError).not.toHaveBeenCalled()
  })
  it('leaves composing and ordinary typing transactions untouched even at the limit', () => {
    const result = run('x'.repeat(MAX_DOCUMENT_BYTES), 'small', { mode: 'source' })
    for (const userEvent of ['input.type.compose', 'input.type']) {
      const transaction = result.state.update({ changes: { from: 0, insert: '!' }, userEvent })
      expect(transaction.newDoc.length).toBe(MAX_DOCUMENT_BYTES + 1)
    }
  })
  it('uses the actual multi-selection changes instead of duplicating the clipboard', () => {
    const onError = vi.fn()
    const context = { snapshot: { id: 'one' }, mode: 'source', readOnly: false, encoding: 'utf8', lineEnding: 'LF', imageOptions: DEFAULT_IMAGE_OPTIONS, onError } as unknown as ClipboardImportContext
    const extension = clipboardImportExtension(() => context)
    const state = EditorState.create({ doc: 'x'.repeat(MAX_DOCUMENT_BYTES - 2), selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(1)]), extensions: [EditorState.allowMultipleSelections.of(true), extension] })
    const plugin = (extension as unknown as [{}, { domEventHandlers: { paste(event: unknown, view: EditorView): boolean } }])[1]
    plugin.domEventHandlers.paste({ clipboardData: { files: [], getData: () => '' } }, { state } as EditorView)
    const changes = state.changeByRange(range => ({ changes: { from: range.from, insert: 'a' }, range }))
    expect(state.update(changes, { userEvent: 'input.paste' }).newDoc.length).toBe(MAX_DOCUMENT_BYTES)
    expect(onError).not.toHaveBeenCalled()
  })
  it('checks an actual linewise insertion including its added newline', async () => {
    const onError = vi.fn()
    const context = { snapshot: { id: 'one' }, mode: 'source', readOnly: false, encoding: 'utf8', lineEnding: 'LF', imageOptions: DEFAULT_IMAGE_OPTIONS, onError } as unknown as ClipboardImportContext
    const extension = clipboardImportExtension(() => context)
    const state = EditorState.create({ doc: 'x'.repeat(MAX_DOCUMENT_BYTES - 3), selection: { anchor: 1 }, extensions: [extension] })
    const plugin = (extension as unknown as [{}, { domEventHandlers: { paste(event: unknown, view: EditorView): boolean } }])[1]
    plugin.domEventHandlers.paste({ clipboardData: { files: [], getData: () => '' } }, { state } as EditorView)
    const transaction = state.update({ changes: { from: 0, insert: 'abc\n' }, userEvent: 'input.paste' })
    expect(transaction.docChanged).toBe(false)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
  })

})
