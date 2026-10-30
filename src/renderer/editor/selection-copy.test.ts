import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { createSelectionCopy, type SelectionCopyContext } from './selection-copy'
import { queueClipboardWrite } from './clipboard-write'

describe('clipboard write queue', () => {
  it('orders requests across callers and continues after an error', async () => {
    const events: string[] = []
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const api: SelectionCopyContext['desktopApi'] = { writeClipboard: async content => { events.push(content.text); if (content.text === 'first') await held; return { ok: true, data: undefined } } }
    const first = queueClipboardWrite(api, { text: 'first' })
    const failed = queueClipboardWrite(api, { text: 'stale' }, () => { throw new Error('stale') })
    const third = queueClipboardWrite(api, { text: 'third' })
    await Promise.resolve(); await Promise.resolve()
    expect(events).toEqual(['first'])
    release()
    await first
    await expect(failed).rejects.toThrow('stale')
    await third
    expect(events).toEqual(['first', 'third'])
  })
})

describe('selection copy snapshot', () => {
  it('preserves the selected Markdown and skips empty selections', async () => {
    const written: string[] = []
    const view = { state: EditorState.create({ doc: 'a **bold** z', selection: { anchor: 2, head: 10 } }), dom: { isConnected: true } } as unknown as EditorView
    const context: SelectionCopyContext = { documentId: 'one', revision: 1, mode: 'source', markdownOptions: DEFAULT_MARKDOWN_OPTIONS, desktopApi: { writeClipboard: async content => { written.push(content.text); return { ok: true, data: undefined } } } }
    const copy = createSelectionCopy(view, () => context)
    expect(await copy('copy-markdown')).toBe(true)
    expect(written).toEqual(['**bold**'])
    const emptyView = { state: EditorState.create({ doc: 'abc' }), dom: { isConnected: true } } as unknown as EditorView
    expect(await createSelectionCopy(emptyView, () => context)('copy-markdown')).toBe(false)
    expect(written).toHaveLength(1)
  })
  it('rejects oversized formatted copies before rendering while allowing Markdown', async () => {
    const source = 'x'.repeat(200001)
    const written: string[] = []
    const view = { state: EditorState.create({ doc: source, selection: { anchor: 0, head: source.length } }), dom: { isConnected: true } } as unknown as EditorView
    const context: SelectionCopyContext = { documentId: 'one', revision: 1, mode: 'source', markdownOptions: DEFAULT_MARKDOWN_OPTIONS, desktopApi: { writeClipboard: async content => { written.push(content.text); return { ok: true, data: undefined } } } }
    const copy = createSelectionCopy(view, () => context)
    await expect(copy('copy-plain')).rejects.toThrow('选区过大')
    await expect(copy('copy-html')).rejects.toThrow('选区过大')
    expect(written).toEqual([])
    await expect(copy('copy-markdown')).resolves.toBe(true)
    expect(written).toEqual([source])
  })
  it('rejects a queued stale document without writing its captured selection', async () => {
    const written: string[] = []
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let revision = 1
    const view = { state: EditorState.create({ doc: 'alpha', selection: { anchor: 0, head: 5 } }), dom: { isConnected: true } } as unknown as EditorView
    const api: SelectionCopyContext['desktopApi'] = { writeClipboard: async content => { written.push(content.text); await held; return { ok: true, data: undefined } } }
    const copy = createSelectionCopy(view, () => ({ documentId: 'one', revision, mode: 'source', markdownOptions: DEFAULT_MARKDOWN_OPTIONS, desktopApi: api }))
    const first = copy('copy-markdown')
    const second = copy('copy-markdown')
    await Promise.resolve(); await Promise.resolve()
    revision = 2
    release()
    await expect(first).resolves.toBe(true)
    await expect(second).rejects.toThrow('文档已变化')
    expect(written).toEqual(['alpha'])
  })
})
