import { describe, expect, it, vi } from 'vitest'
import { createNativeTab } from './native-tabs'

function windowStub() {
  let destroyed = false
  return {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
    show: vi.fn(),
    addTabbedWindow: vi.fn(),
  }
}

describe('macOS native tabs', () => {
  it('attaches and shows only a newly created tab in an eligible parent', async () => {
    const parent = windowStub(), child = windowStub(), create = vi.fn(async () => child)
    await createNativeTab('darwin', parent, () => true, create)
    expect(parent.addTabbedWindow).toHaveBeenCalledWith(child)
    expect(child.show).toHaveBeenCalledOnce()
    expect(child.destroy).not.toHaveBeenCalled()
  })
  it('destroys the new window when the parent closes during creation', async () => {
    const parent = windowStub(), child = windowStub()
    await expect(createNativeTab('darwin', parent, () => true, async () => { parent.destroy(); return child })).rejects.toThrow('窗口已关闭')
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(child.show).not.toHaveBeenCalled()
    expect(parent.addTabbedWindow).not.toHaveBeenCalled()
  })
  it('cleans up the new window if tab attachment fails', async () => {
    const parent = windowStub(), child = windowStub()
    parent.addTabbedWindow.mockImplementation(() => { throw new Error('attachment failed') })
    await expect(createNativeTab('darwin', parent, () => true, async () => child)).rejects.toThrow('attachment failed')
    expect(child.destroy).toHaveBeenCalledOnce()
  })
  it('does not create a window on unsupported platforms or when closing', async () => {
    const parent = windowStub(), create = vi.fn(async () => windowStub())
    await expect(createNativeTab('win32', parent, () => true, create)).rejects.toThrow('仅在 macOS')
    await expect(createNativeTab('darwin', parent, () => false, create)).rejects.toThrow('正在关闭')
    await expect(createNativeTab('darwin', parent, () => true, async () => { throw new Error('creation failed') })).rejects.toThrow('creation failed')
    expect(create).not.toHaveBeenCalled()
  })
})
