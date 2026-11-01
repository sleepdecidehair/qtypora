import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { encodedDocumentByteLength, MAX_DOCUMENT_BYTES } from '../../shared/document-size'
import { DEFAULT_IMAGE_OPTIONS } from '../../shared/image-options'
import { clipboardImportExtension, type ClipboardImportContext } from './clipboard-import'

function pasteUploadedImage(doc: string, markdown: string) {
  let state = EditorState.create({ doc, selection: { anchor: doc.length } })
  const onError = vi.fn(), finish = vi.fn(), preventDefault = vi.fn()
  const context = {
    closeCoordinator: { start: () => finish },
    snapshot: { id: 'one', revision: 1, content: doc },
    mode: 'hybrid',
    encoding: 'utf8-bom',
    lineEnding: 'CRLF',
    readOnly: false,
    imageOptions: { ...DEFAULT_IMAGE_OPTIONS, uploadOnInsert: true },
    importImages: vi.fn(async () => ({ ok: true as const, data: { markdown, paths: ['image.png'] } })),
    readClipboardText: vi.fn(),
    onError,
  } as unknown as ClipboardImportContext
  const ownerDocument = { activeElement: null, hasFocus: () => false }
  const view = {
    get state() { return state },
    dom: { isConnected: true, ownerDocument },
    hasFocus: false,
    dispatch(spec: Transaction | TransactionSpec) { state = 'state' in spec ? spec.state : state.update(spec).state },
  } as unknown as EditorView
  const extension = clipboardImportExtension(() => context) as unknown as [{}, { domEventHandlers: { paste(event: unknown, view: EditorView): boolean } }]
  const file = { name: 'image.png', type: 'image/png', size: 8, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer } as File
  const handled = extension[1].domEventHandlers.paste({ clipboardData: { files: [file] }, preventDefault }, view)
  return { get state() { return state }, context, onError, finish, preventDefault, handled }
}

describe('uploaded clipboard image budget', () => {
  it('keeps a below-limit document unchanged when the actual uploaded URL crosses the encoded limit', async () => {
    const doc = 'x'.repeat(MAX_DOCUMENT_BYTES - 20)
    const markdown = `![image](https://example.com/${'a'.repeat(256)})`
    expect(encodedDocumentByteLength(doc, 'utf8-bom', 'CRLF')).toBeLessThan(MAX_DOCUMENT_BYTES)
    expect(encodedDocumentByteLength(`${doc}\n\n${markdown}`, 'utf8-bom', 'CRLF')).toBeGreaterThan(MAX_DOCUMENT_BYTES)
    const result = pasteUploadedImage(doc, markdown)
    await vi.waitFor(() => expect(result.finish).toHaveBeenCalledOnce())
    expect(result.handled).toBe(true)
    expect(result.preventDefault).toHaveBeenCalledOnce()
    expect(result.context.importImages).toHaveBeenCalledOnce()
    expect(result.context.importImages).toHaveBeenCalledWith(expect.not.objectContaining({ pasteBudget: expect.anything() }))
    expect(result.onError).toHaveBeenCalledWith('插入后的文件将超过 16 MB，未插入图片。')
    expect(result.state.doc.toString()).toBe(doc)
  })
  it('still inserts an uploaded image when the encoded result remains within budget', async () => {
    const result = pasteUploadedImage('Before', '![image](https://example.com/image.png)')
    await vi.waitFor(() => expect(result.finish).toHaveBeenCalledOnce())
    expect(result.onError).not.toHaveBeenCalled()
    expect(result.state.doc.toString()).toBe('Before\n\n![image](https://example.com/image.png)')
  })
})
