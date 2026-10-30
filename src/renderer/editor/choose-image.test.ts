import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { chooseAndInsertImages } from './choose-image'
import type { MarkdownEditorProps } from './types'

describe('toolbar image selection', () => {
  it('does not import files if the selection changes while the dialog is open', async () => {
    let resolve!: (value: unknown) => void
    const chooseImages = vi.fn(() => new Promise(done => { resolve = done }))
    const importImages = vi.fn()
    const props = { documentId: 'one', revision: 1, mode: 'hybrid', encoding: 'utf8', lineEnding: 'LF', readOnly: false, imageOptions: { uploadOnInsert: false }, desktopApi: { chooseImages, importImages } } as unknown as MarkdownEditorProps
    const view = { dom: { isConnected: true, ownerDocument: { activeElement: null } }, state: EditorState.create({ doc: 'hello' }), composing: false, compositionStarted: false } as unknown as EditorView
    const pending = chooseAndInsertImages(view, () => props)
    Object.assign(view, { state: view.state.update({ selection: { anchor: 4 } }).state })
    resolve({ ok: true, data: [{ name: 'x.png', bytes: new Uint8Array([1]) }] })
    await expect(pending).rejects.toThrow('文档或选区已变化')
    expect(importImages).not.toHaveBeenCalled()
  })

  it('does not import files when the dialog is canceled', async () => {
    const importImages = vi.fn()
    const props = { documentId: 'one', revision: 1, mode: 'hybrid', encoding: 'utf8', lineEnding: 'LF', readOnly: false, imageOptions: { uploadOnInsert: false }, desktopApi: { chooseImages: async () => ({ ok: true, data: null }), importImages } } as unknown as MarkdownEditorProps
    const view = { dom: { isConnected: true, ownerDocument: { activeElement: null } }, state: EditorState.create({ doc: 'hello' }), composing: false, compositionStarted: false } as unknown as EditorView
    await chooseAndInsertImages(view, () => props)
    expect(importImages).not.toHaveBeenCalled()
  })
})
