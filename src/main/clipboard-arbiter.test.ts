import { describe, expect, it, vi } from 'vitest'
import { ClipboardArbiter } from './clipboard-arbiter'

describe('clipboard API arbitration across windows', () => {
  it('serializes different owners and recovers from failures', async () => {
    const arbiter = new ClipboardArbiter(), events: string[] = []
    let unblock!: () => void
    const gate = new Promise<void>(resolve => { unblock = resolve })
    const first = arbiter.run(1, async () => { events.push('first'); await gate; throw new Error('failure') })
    const second = arbiter.run(2, async () => { events.push('second') })
    await vi.waitFor(() => expect(events).toEqual(['first']))
    unblock(); await expect(first).rejects.toThrow('failure'); await second
    expect(events).toEqual(['first', 'second'])
  })
  it('cancels a closed waiting owner without interrupting a running write', async () => {
    const arbiter = new ClipboardArbiter(), events: string[] = []
    let unblock!: () => void
    const gate = new Promise<void>(resolve => { unblock = resolve })
    const first = arbiter.run(1, async () => { events.push('start'); await gate; events.push('done') })
    const canceled = arbiter.run(2, async () => { events.push('canceled') })
    const next = arbiter.run(3, async () => { events.push('next') })
    arbiter.ownerTerminated(2); arbiter.ownerTerminated(1)
    await expect(canceled).rejects.toThrow('窗口已关闭')
    await vi.waitFor(() => expect(events).toEqual(['start']))
    unblock(); await first; await next
    expect(events).toEqual(['start', 'done', 'next'])
  })
  it('allows a newly loaded owner after previous in-flight work settles', async () => {
    const arbiter = new ClipboardArbiter(), events: string[] = []
    let unblock!: () => void
    const gate = new Promise<void>(resolve => { unblock = resolve })
    const first = arbiter.run(1, async () => { events.push('old'); await gate })
    arbiter.ownerTerminated(1); arbiter.ownerActive(1)
    const next = arbiter.run(1, async () => { events.push('new') })
    await vi.waitFor(() => expect(events).toEqual(['old']))
    unblock(); await first; await next
    expect(events).toEqual(['old', 'new'])
  })
})
