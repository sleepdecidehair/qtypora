import { describe, expect, it, vi } from 'vitest'
import type { JumpListCategory } from 'electron'
import { configureWindowsJumpList, rememberSystemDocument, windowsJumpList } from './platform-integration'
import { diagnosticsText, helpText } from './app-help'

describe('desktop integration boundaries', () => {
  it('only registers a packaged Windows launcher, leaving recent removal decisions to the OS', () => {
    const app = { setJumpList: vi.fn((_categories: JumpListCategory[] | null) => 'ok' as const) }
    expect(configureWindowsJumpList(app, 'darwin', true, '/Applications/QTypora.app')).toBe('not-applicable')
    expect(configureWindowsJumpList(app, 'win32', false, 'C:\\app\\electron.exe')).toBe('not-applicable')
    expect(app.setJumpList).not.toHaveBeenCalled()
    expect(configureWindowsJumpList(app, 'win32', true, 'C:\\Program Files\\QTypora.exe')).toBe('ok')
    const categories = app.setJumpList.mock.calls[0][0]
    if (!categories) throw new Error('Jump List was not configured')
    expect(categories).toEqual(windowsJumpList('C:\\Program Files\\QTypora.exe'))
    expect(categories[0].items?.[0].args).toBe('--new-document')
    expect(categories[1]).toEqual({ type: 'recent' })
  })
  it('does not register test documents or invalid relative paths with the operating system', () => {
    const app = { addRecentDocument: vi.fn() }
    rememberSystemDocument(app, 'darwin', false, '/tmp/test.md')
    rememberSystemDocument(app, 'linux', true, '/tmp/test.md')
    rememberSystemDocument(app, 'win32', true, 'relative.md')
    expect(app.addRecentDocument).not.toHaveBeenCalled()
    rememberSystemDocument(app, 'win32', true, 'C:\\notes\\doc.md')
    expect(app.addRecentDocument).toHaveBeenCalledWith('C:\\notes\\doc.md')
  })
  it('diagnostics contain runtime details without reading paths or environment values', () => {
    const text = diagnosticsText({ applicationVersion: '1.0', platform: 'darwin', architecture: 'arm64', electronVersion: '40', chromiumVersion: '144', nodeVersion: '24', packaged: false, spellcheckEnabled: true, spellcheckLanguages: ['en-US'] })
    expect(text).toContain('macOS 自动识别')
    expect(text).toContain('Electron：40')
    expect(helpText('win32')).toContain('Ctrl+S')
    expect(helpText('darwin')).toContain('⌘+S')
  })
})
