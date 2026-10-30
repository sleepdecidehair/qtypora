import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { CloseCoordinator } from './close-coordinator'
import { richClipboardExtension } from './rich-clipboard'

class ElementStub { closest() { return null } }
function fixture(write: (content: { text: string }) => Promise<{ ok: true; data: undefined } | { ok: false; error: { code: 'IO_ERROR'; message: string } }>, empty = false) {
  let state = EditorState.create({ doc: 'first second', selection: empty ? { anchor: 0 } : EditorSelection.range(6, 12) })
  const errors: string[] = [], coordinator = new CloseCoordinator()
  const view = { get state() { return state }, dom: { isConnected: true }, contentDOM: { contains: () => true }, composing: false, compositionStarted: false, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } } as unknown as EditorView
  const context = { documentId: 'one', revision: 1, mode: 'source' as const, api: { writeClipboard: write } as never, closeCoordinator: coordinator, onError: (error: string) => errors.push(error) }
  const handlers = richClipboardExtension(() => context) as unknown as { domEventHandlers: { cut(event: unknown, view: EditorView): boolean } }
  return { view, context, errors, coordinator, handlers, get state() { return state } }
}
describe('selected text cut', () => {
  it('waits for successful clipboard writing before deleting', async () => {
    vi.stubGlobal('Element', ElementStub)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = fixture(async () => { await gate; return { ok: true, data: undefined } })
    const preventDefault = vi.fn()
    expect(f.handlers.domEventHandlers.cut({ target: new ElementStub(), defaultPrevented: false, preventDefault }, f.view)).toBe(true)
    expect(f.state.doc.toString()).toBe('first second')
    expect(f.coordinator.pending).toBe(1)
    release(); await vi.waitFor(() => expect(f.state.doc.toString()).toBe('first '))
    await vi.waitFor(() => expect(f.coordinator.pending).toBe(0))
    vi.unstubAllGlobals()
  })
  it('never deletes after failed or stale writes and keeps empty selection native', async () => {
    vi.stubGlobal('Element', ElementStub)
    const failed = fixture(async () => ({ ok: false, error: { code: 'IO_ERROR', message: 'failure' } }))
    failed.handlers.domEventHandlers.cut({ target: new ElementStub(), defaultPrevented: false, preventDefault() {} }, failed.view)
    await vi.waitFor(() => expect(failed.errors).toContain('failure'))
    expect(failed.state.doc.toString()).toBe('first second')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const stale = fixture(async () => { await gate; return { ok: true, data: undefined } })
    stale.handlers.domEventHandlers.cut({ target: new ElementStub(), defaultPrevented: false, preventDefault() {} }, stale.view)
    stale.view.dispatch({ selection: { anchor: 0 } }); release()
    await vi.waitFor(() => expect(stale.errors).toHaveLength(1))
    expect(stale.state.doc.toString()).toBe('first second')
    const empty = fixture(async () => ({ ok: true, data: undefined }), true)
    expect(empty.handlers.domEventHandlers.cut({ target: new ElementStub(), defaultPrevented: false, preventDefault() {} }, empty.view)).toBe(false)
    vi.unstubAllGlobals()
  })
})
