import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { history, undo } from '@codemirror/commands'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { CloseCoordinator } from './close-coordinator'
import { imageAddressRanges, organizeDocumentImages, uploadDocumentImages } from './image-upload'
import type { MarkdownEditorProps } from './types'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})

const original = '![first](first.png)\n\n' + 'text\n\n'.repeat(1800) + '![last][photo]\n\n[photo]: last.png'
const create = () => EditorState.create({ doc: original, extensions: [markdown({ base: markdownLanguage }), history()] })

describe('complete image discovery before bulk operations', () => {
  it('finds inline and reference definitions throughout a long document and undoes replacements together', async () => {
    let state = create()
    expect(ensureSyntaxTree(state, state.doc.length, 10000)?.length).toBe(state.doc.length)
    expect(imageAddressRanges(state).map(range => range.source)).toEqual(['first.png', 'last.png'])
    const coordinator = new CloseCoordinator()
    const upload = vi.fn(async (_request: { sources: string[]; content: string }) => ({ ok: true as const, data: { replacements: [{ source: 'first.png', url: 'https://example.com/first.png' }, { source: 'last.png', url: 'https://example.com/last.png' }] } }))
    const props = { closeCoordinator: coordinator, documentId: 'one', revision: 0, readOnly: false, desktopApi: { uploadImages: upload } } as unknown as MarkdownEditorProps
    const view = { get state() { return state }, dom: { isConnected: true }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
    await uploadDocumentImages(view, () => props)
    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0][0]).toMatchObject({ sources: ['first.png', 'last.png'], content: original })
    expect(state.doc.toString()).toBe(original.replace('first.png', 'https://example.com/first.png').replace('last.png', 'https://example.com/last.png'))
    const target = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(original)
    expect(coordinator.pending).toBe(0)
  })
  it('fails before either external operation if parsing cannot finish', async () => {
    const state = create()
    const upload = vi.fn(), organize = vi.fn(), coordinator = new CloseCoordinator()
    const props = { closeCoordinator: coordinator, documentId: 'one', revision: 0, readOnly: false, desktopApi: { uploadImages: upload, organizeImages: organize } } as unknown as MarkdownEditorProps
    const view = { state, dom: { isConnected: true } } as unknown as EditorView
    parserControl.incomplete = true
    try {
      await expect(uploadDocumentImages(view, () => props)).rejects.toThrow('图片处理未执行')
      await expect(organizeDocumentImages(view, () => props)).rejects.toThrow('图片处理未执行')
      expect(upload).not.toHaveBeenCalled()
      expect(organize).not.toHaveBeenCalled()
      expect(state.doc.toString()).toBe(original)
      expect(coordinator.pending).toBe(0)
    } finally { parserControl.incomplete = false }
  })
})
