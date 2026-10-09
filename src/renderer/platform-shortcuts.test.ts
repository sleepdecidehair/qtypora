import { describe, expect, it } from 'vitest'
import { openFolderShortcut, primaryShortcut, quickOpenShortcut, redoShortcut } from './platform-shortcuts'

describe('platform shortcut labels', () => {
  it('uses Command and the native quick-open shortcut on macOS', () => {
    expect(primaryShortcut('darwin', 'Shift+L')).toBe('Command+Shift+L')
    expect(quickOpenShortcut('darwin')).toBe('Command+Shift+O')
    expect(openFolderShortcut('darwin')).toBeNull()
    expect(redoShortcut('darwin')).toBe('Command+Shift+Z')
  })

  it('keeps the existing Windows shortcuts', () => {
    expect(primaryShortcut('win32', 'Shift+L')).toBe('Ctrl+Shift+L')
    expect(quickOpenShortcut('win32')).toBe('Ctrl+P')
    expect(openFolderShortcut('win32')).toBe('Ctrl+Shift+O')
    expect(redoShortcut('win32')).toBe('Ctrl+Y')
  })
})
