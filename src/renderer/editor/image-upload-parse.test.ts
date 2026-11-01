import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { history, undo } from '@codemirror/commands'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { CloseCoordinator } from './close-coordinator'
import { imageAddressRanges, organizeDocumentImages, uploadDocumentImages } from './image-upload'
import type { MarkdownEditorProps } from './types'
import { encodedDocumentByteLength, MAX_DOCUMENT_BYTES } from '../../shared/document-size'

const parserControl = vi.hoisted(() => ({ incomplete: false, tree: undefined as { iterate(spec: { enter(node: unknown): unknown }): void } | undefined }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : parserControl.tree ?? actual.ensureSyntaxTree(...args) }
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
  it.each(['upload', 'organize'] as const)('rejects %s replacements that cross the encoded document limit', async operation => {
    const source = 'photo.png', prefix = '![photo](', suffix = ')'
    const content = prefix + source + suffix + 'x'.repeat(MAX_DOCUMENT_BYTES - 100 - prefix.length - source.length - suffix.length)
    const url = `https://example.com/${'a'.repeat(512)}`
    expect(encodedDocumentByteLength(content, 'utf8', 'LF')).toBe(MAX_DOCUMENT_BYTES - 100)
    expect(encodedDocumentByteLength(content.replace(source, url), 'utf8', 'LF')).toBeGreaterThan(MAX_DOCUMENT_BYTES)
    parserControl.tree = { iterate({ enter }) { enter({ name: 'Image', from: 0, to: prefix.length + source.length + suffix.length, node: { getChild: (name: string) => name === 'URL' ? { from: prefix.length, to: prefix.length + source.length } : null } }) } }
    try {
      const state = EditorState.create({ doc: content })
      const coordinator = new CloseCoordinator(), dispatch = vi.fn()
      const replacement = { source, url }
      const props = { closeCoordinator: coordinator, documentId: 'one', revision: 0, encoding: 'utf8', lineEnding: 'LF', readOnly: false, desktopApi: { uploadImages: vi.fn(async () => ({ ok: true as const, data: { replacements: [replacement] } })), organizeImages: vi.fn(async () => ({ ok: true as const, data: { replacements: [replacement] } })) } } as unknown as MarkdownEditorProps
      const view = { state, dom: { isConnected: true }, dispatch } as unknown as EditorView
      const task = operation === 'upload' ? uploadDocumentImages(view, () => props) : organizeDocumentImages(view, () => props)
      await expect(task).rejects.toThrow(`${operation === 'upload' ? '上传' : '整理'}后的文件将超过 16 MB`)
      expect(dispatch).not.toHaveBeenCalled()
      expect(state.doc.toString()).toBe(content)
      expect(coordinator.pending).toBe(0)
    } finally { parserControl.tree = undefined }
  })
})
