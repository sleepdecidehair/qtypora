import { describe, expect, it, vi } from 'vitest'
import { ClipboardArbiter } from './clipboard-arbiter'
import { ClipboardWriteService } from './clipboard-service'

describe('clipboard API write service', () => {
  it('orders requests from distinct windows and retains all supported formats', async () => {
    const arbiter = new ClipboardArbiter(), writes: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const writer = vi.fn(async (content: { text: string; html?: string; rtf?: string }) => { writes.push(content.text); if (content.text === 'first') await gate })
    const service = new ClipboardWriteService(arbiter, writer)
    const first = service.writeFor(1, { text: 'first', html: '<b>first</b>', rtf: '{\\rtf1 first}' }, () => true)
    const second = service.writeFor(2, { text: 'second' }, () => true)
    await vi.waitFor(() => expect(writes).toEqual(['first']))
    release(); await first; await second
    expect(writes).toEqual(['first', 'second'])
    expect(writer.mock.calls[0][0]).toEqual({ text: 'first', html: '<b>first</b>', rtf: '{\\rtf1 first}' })
  })
  it('recovers after a failed write and rejects invalid content before queueing', async () => {
    const service = new ClipboardWriteService(new ClipboardArbiter(), async content => { if (content.text === 'fail') throw new Error('write failed') })
    const first = service.writeFor(1, { text: 'fail' }, () => true)
    const second = service.writeFor(2, { text: 'ok' }, () => true)
    await expect(first).rejects.toThrow('write failed')
    await expect(second).resolves.toBeUndefined()
    expect(() => service.writeFor(1, { text: '\0' }, () => true)).toThrow()
  })
  it('rejects a closed waiting owner without blocking another window', async () => {
    const arbiter = new ClipboardArbiter(), writes: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const service = new ClipboardWriteService(arbiter, async content => { writes.push(content.text); if (content.text === 'first') await gate })
    const first = service.writeFor(1, { text: 'first' }, () => true)
    const closed = service.writeFor(2, { text: 'closed' }, () => false)
    const next = service.writeFor(3, { text: 'next' }, () => true)
    arbiter.ownerTerminated(2)
    await expect(closed).rejects.toThrow('窗口已关闭')
    release(); await first; await next
    expect(writes).toEqual(['first', 'next'])
  })
  it('rechecks liveness when the queued write starts', async () => {
    const service = new ClipboardWriteService(new ClipboardArbiter(), vi.fn(async () => {}))
    await expect(service.writeFor(1, { text: 'x' }, () => false)).rejects.toThrow('窗口已关闭')
  })
})
