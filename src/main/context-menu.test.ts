import { EventEmitter } from 'node:events'
import type { Menu, PopupOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuRequest } from '../shared/contracts'
import { contextMenuTemplate, NativeContextMenus, validateContextMenu } from './context-menu'
import type { DesktopMenuItem } from './menu'

const request = (extra: Partial<ContextMenuRequest> = {}): ContextMenuRequest => ({ kind: 'editor', readOnly: false, hasSelection: true, availableActions: ['copy', 'paste', 'bold'], ...extra })
const ids = (template: DesktopMenuItem[]): string[] => template.flatMap((item) => item.id ? [item.id] : item.submenu ? ids(item.submenu) : [])
function popupWindow() {
  return Object.assign(new EventEmitter(), { id: 9, isDestroyed: () => false })
}

describe('Context menus', () => {
  it('only accepts fixed kinds/actions and filters selection, undo, read-only and local capabilities', () => {
    expect(() => validateContextMenu({ ...request(), kind: 'constructor' })).toThrow()
    expect(() => validateContextMenu({ ...request(), availableActions: ['execute-script'] })).toThrow()
    expect(ids(contextMenuTemplate(request({ readOnly: true }), () => undefined))).toEqual(['copy'])
    expect(ids(contextMenuTemplate(request({ hasSelection: false, availableActions: ['copy', 'paste', 'undo', 'redo'], canUndo: true }), () => undefined))).toEqual(['undo', 'paste'])
    expect(ids(contextMenuTemplate(request({ kind: 'image', availableActions: ['image-delete', 'image-remove', 'image-copy-path'], hasLocalResource: false }), () => undefined))).toEqual(['image-copy-path', 'image-remove'])
    expect(ids(contextMenuTemplate(request({ kind: 'folder', availableActions: ['file-open', 'file-duplicate', 'bold'] }), () => undefined))).toEqual(['file-open'])
    expect(contextMenuTemplate(request(), () => undefined).find((item) => item.label === '格式')?.submenu?.[0].id).toBe('bold')
  })

  it('resolves selected actions once when the native menu later closes', async () => {
    let selected: DesktopMenuItem[] = []
    let callback: (() => void) | undefined
    const manager = new NativeContextMenus((template) => {
      selected = template
      return { popup: (options: PopupOptions) => { callback = options.callback }, closePopup: () => undefined }
    })
    const window = popupWindow()
    const result = manager.show(window, request())
    selected.find((item) => item.id === 'copy')?.click?.()
    callback?.()
    expect(await result).toBe('copy')
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('replacement, cancellation and destroyed windows do not leave pending IPC', async () => {
    const callbacks: Array<(() => void) | undefined> = []
    const close = vi.fn()
    const manager = new NativeContextMenus(() => ({ popup: (options: PopupOptions) => { callbacks.push(options.callback) }, closePopup: close }))
    const window = popupWindow()
    const first = manager.show(window, request())
    const second = manager.show(window, request())
    expect(await first).toBeNull()
    expect(close).toHaveBeenCalledOnce()
    callbacks[0]?.()
    window.emit('closed')
    expect(await second).toBeNull()
    expect(window.listenerCount('closed')).toBe(0)
    expect(await manager.show({ id: window.id, isDestroyed: () => true, once: () => undefined, removeListener: () => undefined }, request())).toBeNull()
  })

  it('native popup failure rejects and empty menus settle without a popup', async () => {
    const create = vi.fn((): Pick<Menu, 'popup' | 'closePopup'> => ({ popup: () => { throw new Error('Unavailable') }, closePopup: () => undefined }))
    const manager = new NativeContextMenus(create)
    const window = popupWindow()
    await expect(manager.show(window, request())).rejects.toThrow('Unavailable')
    expect(window.listenerCount('closed')).toBe(0)
    expect(await manager.show(window, request({ availableActions: [] }))).toBeNull()
    expect(create).toHaveBeenCalledOnce()
  })
})
