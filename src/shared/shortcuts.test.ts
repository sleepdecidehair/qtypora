import { describe, expect, it } from 'vitest'
import { macTyporaShortcut, normalizeAccelerator, normalizeShortcutOverrides, shortcutCommandForEvent, shortcutForCommand } from './shortcuts'
import { createMenuTemplate, type DesktopMenuItem } from '../main/menu'

describe('application shortcut configuration', () => {
  it('adds the macOS document-list shortcut without overriding an older custom binding', () => {
    const event = { key: '2', code: 'Digit2', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false }
    expect(shortcutCommandForEvent(event, 'darwin', {})).toBe('article-list')
    const overrides = normalizeShortcutOverrides({ new: 'Cmd+Ctrl+2' }, 'darwin')
    expect(shortcutCommandForEvent(event, 'darwin', overrides)).toBe('new')
    expect(shortcutForCommand('article-list', 'darwin', overrides)).toBeUndefined()
    const actions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
    const list = flatten(createMenuTemplate('darwin', false, [], actions, { shortcuts: overrides })).find(item => item.label === '文档列表')
    expect(list?.accelerator).toBeUndefined()
    expect(shortcutForCommand('article-list', 'win32', {})).toBeUndefined()
    expect(shortcutForCommand('article-list', 'darwin', { 'article-list': '' })).toBeUndefined()
  })
  it('routes macOS Typora list aliases without stealing customized shortcuts', () => {
    const optionO = { key: 'ø', code: 'KeyO', ctrlKey: false, metaKey: true, altKey: true, shiftKey: false }
    const optionU = { ...optionO, key: '¨', code: 'KeyU' }
    expect(macTyporaShortcut(optionO, 'darwin', {})).toBe('ordered-list')
    expect(macTyporaShortcut(optionU, 'darwin', {})).toBe('bullet-list')
    expect(macTyporaShortcut(optionO, 'win32', {})).toBeNull()
    expect(macTyporaShortcut({ ...optionO, shiftKey: true }, 'darwin', {})).toBeNull()
    const overrides = normalizeShortcutOverrides({ new: 'Cmd+Alt+O' }, 'darwin')
    expect(macTyporaShortcut(optionO, 'darwin', overrides)).toBe('new')
    const optionC = { ...optionO, key: 'ç', code: 'KeyC' }
    expect(macTyporaShortcut(optionC, 'darwin', {})).toBe('code')
    expect(macTyporaShortcut(optionC, 'darwin', normalizeShortcutOverrides({ new: 'Cmd+Alt+C' }, 'darwin'))).toBe('new')
  })
  it('offers Typora line selection without breaking an existing customized binding', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const event = { key: 'l', code: 'KeyL', ctrlKey: platform === 'win32', metaKey: platform === 'darwin', altKey: false, shiftKey: false }
      expect(shortcutCommandForEvent(event, platform, {})).toBe('select-line')
      const overrides = normalizeShortcutOverrides({ new: 'CmdOrCtrl+L' }, platform)
      expect(shortcutCommandForEvent(event, platform, overrides)).toBe('new')
      expect(shortcutForCommand('select-line', platform, overrides)).toBeUndefined()
      const menu = createMenuTemplate(platform, true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined })
      const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
      expect(flatten(menu).find(item => item.label === '选中当前行或句')?.accelerator).toBe('CmdOrCtrl+L')
    }
  })
  it('offers Copy as Markdown without overriding an existing custom shortcut', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const event = { key: 'C', code: 'KeyC', ctrlKey: platform === 'win32', metaKey: platform === 'darwin', altKey: false, shiftKey: true }
      expect(shortcutCommandForEvent(event, platform, {})).toBe('copy-markdown')
      const overrides = normalizeShortcutOverrides({ new: 'CmdOrCtrl+Shift+C' }, platform)
      expect(shortcutCommandForEvent(event, platform, overrides)).toBe('new')
      expect(shortcutForCommand('copy-markdown', platform, overrides)).toBeUndefined()
      const menu = createMenuTemplate(platform, true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined })
      const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
      expect(flatten(menu).find(item => item.label === '复制为 Markdown')?.accelerator).toBe('CmdOrCtrl+Shift+C')
    }
  })
  it('offers Delete Word without overriding an existing custom shortcut', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const event = { key: 'D', code: 'KeyD', ctrlKey: platform === 'win32', metaKey: platform === 'darwin', altKey: false, shiftKey: true }
      expect(shortcutCommandForEvent(event, platform, {})).toBe('delete-word')
      const overrides = normalizeShortcutOverrides({ new: 'CmdOrCtrl+Shift+D' }, platform)
      expect(shortcutCommandForEvent(event, platform, overrides)).toBe('new')
      expect(shortcutForCommand('delete-word', platform, overrides)).toBeUndefined()
      const menu = createMenuTemplate(platform, true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined })
      const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
      expect(flatten(menu).find(item => item.label === '删除当前词')?.accelerator).toBe('CmdOrCtrl+Shift+D')
    }
  })
  it('routes the Typora Delete Line shortcut on both platforms', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const event = { key: 'Backspace', code: 'Backspace', ctrlKey: platform === 'win32', metaKey: platform === 'darwin', altKey: false, shiftKey: true }
      expect(shortcutCommandForEvent(event, platform, {})).toBe('delete-line')
      expect(shortcutCommandForEvent(event, platform, { 'delete-line': '' })).toBeNull()
      const menu = createMenuTemplate(platform, true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined })
      const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
      expect(flatten(menu).find(item => item.label === '删除当前行或句')?.accelerator).toBe('CmdOrCtrl+Shift+Backspace')
    }
  })
  it('offers Jump to Selection without overriding an existing custom shortcut', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const event = { key: 'j', code: 'KeyJ', ctrlKey: platform === 'win32', metaKey: platform === 'darwin', altKey: false, shiftKey: false }
      expect(shortcutCommandForEvent(event, platform, {})).toBe('jump-selection')
      const overrides = normalizeShortcutOverrides({ new: 'CmdOrCtrl+J' }, platform)
      expect(shortcutCommandForEvent(event, platform, overrides)).toBe('new')
      expect(shortcutForCommand('jump-selection', platform, overrides)).toBeUndefined()
      const menu = createMenuTemplate(platform, true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined })
      const flatten = (items: DesktopMenuItem[]): DesktopMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
      expect(flatten(menu).find(item => item.label === '跳转到所选内容')?.accelerator).toBe('CmdOrCtrl+J')
    }
  })
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
    const items = flatten(createMenuTemplate('win32', true, [], { command: () => undefined, exit: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, about: () => undefined }, { shortcuts: { save: '', 'save-all': 'Ctrl+Alt+S' } }))
    expect(items.find(item => item.label === '保存')?.accelerator).toBeUndefined()
    expect(items.find(item => item.label === '保存全部')?.accelerator).toBe('Ctrl+Alt+S')
    expect(items.find(item => item.label === '撤销')?.accelerator).toBe('CmdOrCtrl+Z')
  })
})
