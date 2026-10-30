import { describe, expect, it, vi } from 'vitest'
import { minimizeAllDocumentWindows } from './minimize-all'

function makeWindow(options: { destroyed?: boolean; visible?: boolean; minimized?: boolean; minimizable?: boolean; throws?: boolean } = {}) {
  return {
    isDestroyed: () => options.destroyed ?? false,
    isVisible: () => options.visible ?? true,
    isMinimized: () => options.minimized ?? false,
    isMinimizable: () => options.minimizable ?? true,
    minimize: vi.fn(() => { if (options.throws) throw new Error('unavailable') }),
  }
}

describe('minimize all document windows', () => {
  it('minimizes visible eligible windows only and leaves destroyed, hidden and minimized windows alone', () => {
    const first = makeWindow(), second = makeWindow(), destroyed = makeWindow({ destroyed: true }), hidden = makeWindow({ visible: false }), minimized = makeWindow({ minimized: true }), disabled = makeWindow({ minimizable: false })
    expect(minimizeAllDocumentWindows([first, second, destroyed, hidden, minimized, disabled])).toEqual({ attempted: 2, failed: 0 })
    expect(first.minimize).toHaveBeenCalledOnce()
    expect(second.minimize).toHaveBeenCalledOnce()
    for (const item of [destroyed, hidden, minimized, disabled]) expect(item.minimize).not.toHaveBeenCalled()
  })

  it('continues after an individual window fails', () => {
    const failure = makeWindow({ throws: true }), next = makeWindow()
    expect(minimizeAllDocumentWindows([failure, next])).toEqual({ attempted: 1, failed: 1 })
    expect(next.minimize).toHaveBeenCalledOnce()
  })
})
