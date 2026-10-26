import { describe, expect, it } from 'vitest'
import { normalizeAccelerator, normalizeShortcutOverrides, shortcutCommandForEvent, shortcutForCommand } from './shortcuts'
import { createMenuTemplate, type DesktopMenuItem } from '../main/menu'

describe('application shortcut configuration', () => {
  it('migrates missing settings and canonicalizes strict accelerators', () => {
    expect(normalizeShortcutOverrides(undefined)).toEqual({})
    expect(normalizeAccelerator('control + alt + s')).toBe('Ctrl+Alt+S')
    expect(normalizeAccelerator('CommandOrControl+Shift+f12')).toBe('CmdOrCtrl+Shift+F12')
    expect(normalizeAccelerator('  ')).toBe('')
    expect(normalizeShortcutOverrides({ save: 'Ctrl+Alt+S', 'open-folder': '' })).toEqual({ save: 'Ctrl+Alt+S', 'open-folder': '' })
    for (const value of [null, [], { unknown: 'Ctrl+S' }, { save: 4 }, { save: 'Ctrl+Ctrl+S' }, { save: 'S' }, { save: 'Ctrl+F25' }, { save: 'Ctrl+Alt+S\n' }, { save: 'Command+S' }]) expect(() => normalizeShortcutOverrides(value)).toThrow()
  })
  it('rejects equivalent menu keys and fixed editor/native shortcuts on the active platform', () => {
    expect(() => normalizeShortcutOverrides({ new: 'control+O' })).toThrow('冲突')
    expect(() => normalizeShortcutOverrides({ new: 'Cmd+O' }, 'darwin')).toThrow('冲突')
    for (const shortcut of ['Ctrl+B', 'Ctrl+C', 'Ctrl+Z', 'Ctrl+G', 'Ctrl+1', 'Alt+Shift+5', 'F3', 'Ctrl+Left', 'Shift+F12']) expect(() => normalizeShortcutOverrides({ new: shortcut })).toThrow('冲突')
    for (const shortcut of ['Cmd+H', 'Ctrl+P', 'Cmd+Alt+F', 'Cmd+Q']) expect(() => normalizeShortcutOverrides({ new: shortcut }, 'darwin')).toThrow('冲突')
    expect(normalizeShortcutOverrides({ 'save-all': 'Ctrl+Alt+S' })).toEqual({ 'save-all': 'Ctrl+Alt+S' })
    expect(normalizeShortcutOverrides({ replace: 'CmdOrCtrl+H' }, 'darwin')).toEqual({ replace: 'CmdOrCtrl+H' })
  })
  it('keeps renderer fallback aligned with customized and disabled menu accelerators', () => {
    const event = { key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }
    expect(shortcutCommandForEvent(event, 'win32', {})).toBe('save')
    expect(shortcutCommandForEvent(event, 'darwin', {})).toBeNull()
    const macQuickOpen = { ...event, key: 'p', code: 'KeyP', ctrlKey: false, metaKey: true }
    expect(shortcutCommandForEvent(macQuickOpen, 'darwin', {})).toBe('quick-open')
    expect(shortcutCommandForEvent(macQuickOpen, 'darwin', { 'quick-open': '' })).toBeNull()
    expect(shortcutCommandForEvent(macQuickOpen, 'darwin', { 'quick-open': 'Cmd+Alt+P' })).toBeNull()
    expect(() => normalizeShortcutOverrides({ new: 'Cmd+P' }, 'darwin')).toThrow('冲突')
    expect(shortcutCommandForEvent(event, 'win32', { save: 'Ctrl+Alt+S' })).toBeNull()
    expect(shortcutCommandForEvent({ ...event, altKey: true }, 'win32', { save: 'Ctrl+Alt+S' })).toBe('save')
    expect(shortcutCommandForEvent(event, 'win32', { save: '' })).toBeNull()
    expect(shortcutCommandForEvent({ ...event, key: 'F7', code: 'F7', ctrlKey: false }, 'win32', { statistics: 'F7' })).toBe('statistics')
    expect(shortcutForCommand('save', 'win32', { save: '' })).toBeUndefined()
    const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
    const items = flatten(createMenuTemplate('win32', true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, about: () => undefined }, { shortcuts: { save: '', 'save-all': 'Ctrl+Alt+S' } }))
    expect(items.find(item => item.label === '保存')?.accelerator).toBeUndefined()
    expect(items.find(item => item.label === '保存全部')?.accelerator).toBe('Ctrl+Alt+S')
    expect(items.find(item => item.label === '撤销')?.accelerator).toBe('CmdOrCtrl+Z')
  })
})
