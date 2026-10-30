import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { MAX_DOCUMENT_BYTES } from '../../shared/document-size'
import { clipboardImportExtension, type ClipboardImportContext } from './clipboard-import'
import type { Result } from '../../shared/contracts'

function setup(doc = 'Before\n') {
  let state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [history()] })
  let resolve!: (result: Result<string>) => void
  const deferred = new Promise<Result<string>>(done => { resolve = done })
  const onError = vi.fn(), finish = vi.fn(), preventDefault = vi.fn()
  const context = { mode: 'hybrid', readOnly: false, encoding: 'utf8-bom', lineEnding: 'CRLF', snapshot: { id: 'one', revision: 1, content: doc }, closeCoordinator: { start: () => finish }, readClipboardText: () => deferred, onError } as unknown as ClipboardImportContext
  const view = { get state() { return state }, dom: { isConnected: true }, dispatch: (spec: Transaction | TransactionSpec) => { state = 'state' in spec ? spec.state : state.update(spec).state } } as unknown as EditorView
  const extension = clipboardImportExtension(() => ({ ...context })) as unknown as [{}, { domEventHandlers: { keydown(event: unknown, view: EditorView): boolean } }]
  const handled = extension[1].domEventHandlers.keydown({ ctrlKey: true, metaKey: false, shiftKey: true, key: 'v', preventDefault }, view)
  return { get state() { return state }, update: (spec: TransactionSpec) => { state = state.update(spec).state }, view, context, resolve, onError, finish, preventDefault, handled }
}

describe('asynchronous plain paste budget', () => {
  it('rejects over-limit encoded output without modifying the document', async () => {
    const test = setup()
    test.resolve({ ok: true, data: 'x'.repeat(MAX_DOCUMENT_BYTES - 10) })
    await vi.waitFor(() => expect(test.finish).toHaveBeenCalledOnce())
    expect(test.handled).toBe(true)
    expect(test.onError).toHaveBeenCalledWith('粘贴后的文件将超过 16 MB，未执行粘贴。')
    expect(test.state.doc.toString()).toBe('Before\n')
  })
  it('pastes valid text, normalizes CRLF and remains undoable', async () => {
    const test = setup()
    test.resolve({ ok: true, data: 'one\r\ntwo' })
    await vi.waitFor(() => expect(test.finish).toHaveBeenCalledOnce())
    expect(test.state.doc.toString()).toBe('Before\none\ntwo')
    expect(test.state.selection.main.head).toBe(test.state.doc.length)
    expect(undo(test.view)).toBe(true)
    expect(test.state.doc.toString()).toBe('Before\n')
    expect(test.onError).not.toHaveBeenCalled()
  })
  it.each(['document', 'mode', 'selection', 'encoding', 'lineEnding'] as const)('refuses a delayed response after %s changes', async change => {
    const test = setup()
    if (change === 'document') test.update({ changes: { from: 0, insert: 'x' } })
    if (change === 'mode') test.context.mode = 'source'
    if (change === 'selection') test.update({ selection: EditorSelection.cursor(1) })
    if (change === 'encoding') test.context.encoding = 'utf8'
    if (change === 'lineEnding') test.context.lineEnding = 'LF'
    const before = test.state.doc.toString()
    test.resolve({ ok: true, data: 'paste' })
    await vi.waitFor(() => expect(test.finish).toHaveBeenCalledOnce())
    expect(test.state.doc.toString()).toBe(before)
    expect(test.onError).toHaveBeenCalledWith('文档或选区已变化，未粘贴文本。')
  })
})
