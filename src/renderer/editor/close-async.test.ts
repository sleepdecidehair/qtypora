import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { CloseCoordinator } from './close-coordinator'
import { uploadDocumentImages } from './image-upload'
import type { MarkdownEditorProps } from './types'

describe('close coordination for image work', () => {
  it('holds the close gate until a failing image upload has settled', async () => {
    const coordinator = new CloseCoordinator()
    const view = { state: EditorState.create({ doc: '![photo](assets/photo.png)', extensions: [markdown({ base: markdownLanguage })] }), dom: { isConnected: true } } as unknown as EditorView
    let resolve!: (result: { ok: false; error: { code: 'IO_ERROR'; message: string } }) => void
    const delayed = new Promise<{ ok: false; error: { code: 'IO_ERROR'; message: string } }>(done => { resolve = done })
    const props = { closeCoordinator: coordinator, documentId: '1', revision: 0, readOnly: false, desktopApi: { uploadImages: () => delayed } } as unknown as MarkdownEditorProps
    const pending = uploadDocumentImages(view, () => props)
    expect(coordinator.pending).toBe(1)
    expect(coordinator.begin()).toBe(false)
    resolve({ ok: false, error: { code: 'IO_ERROR', message: 'failed' } })
    await expect(pending).rejects.toThrow('failed')
    expect(coordinator.pending).toBe(0)
    expect(coordinator.begin()).toBe(true)
  })
  it('rejects a new upload once close has begun', async () => {
    const coordinator = new CloseCoordinator()
    expect(coordinator.begin()).toBe(true)
    const view = { state: EditorState.create({ doc: '![photo](assets/photo.png)', extensions: [markdown({ base: markdownLanguage })] }) } as unknown as EditorView
    const props = { closeCoordinator: coordinator, readOnly: false } as MarkdownEditorProps
    await expect(uploadDocumentImages(view, () => props)).rejects.toThrow('文档正在关闭')
    expect(coordinator.pending).toBe(0)
  })
})
