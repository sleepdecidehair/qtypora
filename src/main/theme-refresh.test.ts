import { describe, expect, it, vi } from 'vitest'
import { ThemeRefresh } from './theme-refresh'

describe('theme refresh notifications', () => {
  it('broadcasts monotonically only after successful listings', async () => {
    const broadcast = vi.fn(), refresh = new ThemeRefresh(broadcast)
    await expect(refresh.list(async () => { throw new Error('unavailable') })).rejects.toThrow('unavailable')
    expect(broadcast).not.toHaveBeenCalled()
    expect(await refresh.list(async () => ['a'])).toEqual(['a'])
    expect(await refresh.list(async () => ['b'])).toEqual(['b'])
    expect(broadcast.mock.calls).toEqual([[1], [2]])
  })
})
