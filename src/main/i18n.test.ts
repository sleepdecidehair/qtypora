import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../shared/contracts'
import { LocalStore, validatePreferences } from './preferences'
import { createMenuTemplate, type DesktopMenuItem, type MenuActions } from './menu'
import { contextMenuTemplate } from './context-menu'
import { diagnosticsText, helpText } from './app-help'

const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
function flatten(menu: DesktopMenuItem[]): DesktopMenuItem[] { return menu.flatMap(item => [item, ...flatten(item.submenu ?? [])]) }

describe('localized desktop application', () => {
  it('migrates old preferences, validates locale and persists it without changing unrelated values', async () => {
    const { locale: _locale, ...old } = DEFAULT_PREFERENCES
    expect(validatePreferences(old).locale).toBe('zh-CN')
    for (const invalid of [null, [], {}, 'en', 'en-GB', 1]) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, locale: invalid })).toThrow('界面语言')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-locale-'))
    try {
      const store = new LocalStore(directory)
      await store.load()
      await store.updatePreferences({ ...store.preferences, locale: 'en-US', fontSize: 20 })
      const reopened = new LocalStore(directory)
      await reopened.load()
      expect(reopened.preferences).toMatchObject({ locale: 'en-US', fontSize: 20 })
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('localizes fixed menus without translating recent paths or spelling candidates', () => {
    const recent = '/tmp/中文&草稿.md'
    const menu = flatten(createMenuTemplate('win32', false, [recent], actions, { locale: 'en-US' }))
    expect(menu.map(item => item.label)).toContain('File(&F)')
    expect(menu.map(item => item.label)).toContain('Save')
    const macMenu = flatten(createMenuTemplate('darwin', false, [], actions, { locale: 'en-US' }))
    expect(macMenu.find(item => item.role === 'zoom')?.label).toBe('Zoom')
    expect(macMenu.some(item => item.label === 'Minimize All')).toBe(true)
    expect(macMenu.find(item => item.role === 'front')?.label).toBe('Bring All to Front')
    expect(menu.map(item => item.label)).toContain('/tmp/中文&&草稿.md')
    const labels = menu.map(item => item.label).filter((label): label is string => Boolean(label) && label !== '/tmp/中文&&草稿.md')
    expect(labels.filter(label => /[\u4e00-\u9fff]/.test(label))).toEqual([])
    const context = flatten(contextMenuTemplate({ kind: 'editor', readOnly: false, hasSelection: true, availableActions: ['copy', 'spell-suggestion-0'], spelling: { word: 'helo', suggestions: ['中文建议'] } }, () => undefined, 'en-US'))
    expect(context.map(item => item.label)).toContain('Copy')
    expect(context.map(item => item.label)).toContain('中文建议')
    expect(helpText('darwin', 'en-US')).toContain('Writing and saving')
    expect(diagnosticsText({ applicationVersion: '1', platform: 'darwin', architecture: 'arm64', electronVersion: '1', chromiumVersion: '1', nodeVersion: '1', packaged: false, spellcheckEnabled: false, spellcheckLanguages: [] }, 'en-US')).toContain('Spellcheck: off')
  })
})
