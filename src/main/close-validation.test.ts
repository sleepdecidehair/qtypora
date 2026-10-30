import { describe, expect, it, vi } from 'vitest'
import { CloseValidation } from './close-validation'

describe('window close validation', () => {
  it('accepts only the matching request once and isolates windows', async () => {
    let id = ''
    const first = new CloseValidation(value => { id = value })
    const second = new CloseValidation(() => {})
    const pending = first.request([{ id: 'doc', content: 'text', revision: 2 }])
    second.resolve(id, true)
    first.resolve('wrong', true)
    expect(await first.request([])).toBe(false)
    first.resolve(id, false)
    first.resolve(id, true)
    expect(await pending).toBe(false)
    first.dispose(); second.dispose()
  })

  it('fails closed on timeout, disposal, and send failure', async () => {
    vi.useFakeTimers()
    try {
      const broker = new CloseValidation(() => {}, 100)
      const timeout = broker.request([])
      await vi.advanceTimersByTimeAsync(100)
      expect(await timeout).toBe(false)
      const disposed = broker.request([])
      broker.dispose()
      expect(await disposed).toBe(false)
      expect(await broker.request([])).toBe(false)
      expect(await new CloseValidation(() => { throw new Error('closed') }).request([])).toBe(false)
    } finally { vi.useRealTimers() }
  })
})
