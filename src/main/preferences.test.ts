import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../shared/contracts'
import * as files from './files'
import { LocalStore, validatePreferences } from './preferences'

let directory: string
let store: LocalStore
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-preferences-'))
  store = new LocalStore(directory)
  await store.load()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

function signal() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('preference persistence transactions', () => {
  it('defaults paragraph indentation off and persists explicit changes', async () => {
    const { indentFirstLine: _indent, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).indentFirstLine).toBe(false)
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, indentFirstLine: 'true' })).toThrow('段落首行缩进')
    await store.updatePreferences(validatePreferences({ ...DEFAULT_PREFERENCES, indentFirstLine: true }))
    const reopened = new LocalStore(directory)
    await reopened.load()
    expect(reopened.preferences.indentFirstLine).toBe(true)
  })
  it('defaults legacy outlines to collapsible and persists flat mode', async () => {
    const { outlineFlat: _flat, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).outlineFlat).toBe(false)
    for (const value of [null, 1, 'true']) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, outlineFlat: value })).toThrow('大纲视图')
    await store.updatePreferences(validatePreferences({ ...DEFAULT_PREFERENCES, outlineFlat: true }))
    const reopened = new LocalStore(directory)
    await reopened.load()
    expect(reopened.preferences.outlineFlat).toBe(true)
  })
  it('defaults legacy status bar to visible and persists an explicit choice', async () => {
    const { showStatusBar: _statusBar, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).showStatusBar).toBe(true)
    for (const value of [null, 1, 'false']) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, showStatusBar: value })).toThrow('状态栏')
    await store.updatePreferences(validatePreferences({ ...DEFAULT_PREFERENCES, showStatusBar: false }))
    const reloaded = new LocalStore(directory)
    await reloaded.load()
    expect(reloaded.preferences.showStatusBar).toBe(false)
  })
  it('migrates old theme settings while validating and persisting theme identifiers', async () => {
    const { typoraThemeId: _theme, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).typoraThemeId).toBe('')
    for (const value of [null, 3, '../outside', 'theme/user', 'base.user', 'CON']) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, typoraThemeId: value })).toThrow('主题名称')
    const next = validatePreferences({ ...DEFAULT_PREFERENCES, typoraThemeId: '纸白' })
    await store.updatePreferences(next)
    const reopened = new LocalStore(directory)
    await reopened.load()
    expect(reopened.preferences.typoraThemeId).toBe('纸白')
    expect(reopened.preferences.lightTheme).toBe(DEFAULT_PREFERENCES.lightTheme)
  })

  it('defaults legacy native tab preference off and validates its type', () => {
    const { macNativeTabs: _tabs, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).macNativeTabs).toBe(false)
    expect(validatePreferences({ ...DEFAULT_PREFERENCES, macNativeTabs: true }).macNativeTabs).toBe(true)
    for (const value of [null, 'true', 1]) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, macNativeTabs: value })).toThrow('原生标签')
  })

  it('migrates old statistics settings and persists the chosen unit across store restarts', async () => {
    const { statisticsUnit: _unit, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy).statisticsUnit).toBe('words')
    for (const invalid of [null, [], ['characters'], {}, 'lines', 1]) expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, statisticsUnit: invalid })).toThrow('统计单位')
    await store.updatePreferences({ ...store.preferences, statisticsUnit: 'characters' })
    const reopened = new LocalStore(directory)
    await reopened.load()
    expect(reopened.preferences.statisticsUnit).toBe('characters')
  })

  it('retains confirmed preferences after a real filesystem failure and a later recent-file save', async () => {
    const destination = path.join(directory, 'settings.json')
    await fs.mkdir(destination)
    await expect(store.updatePreferences({ ...DEFAULT_PREFERENCES, fontSize: 24 })).rejects.toThrow()
    expect(store.preferences.fontSize).toBe(DEFAULT_PREFERENCES.fontSize)
    await fs.rmdir(destination)
    const recent = path.join(directory, 'note.md')
    await store.addRecent(recent)
    const saved = JSON.parse(await fs.readFile(destination, 'utf8'))
    expect(saved.preferences.fontSize).toBe(DEFAULT_PREFERENCES.fontSize)
    expect(saved.recentFiles).toEqual([recent])
  })

  it('does not expose or persist rejected settings through concurrent recent-file and folder updates', async () => {
    await store.updatePreferences({ ...DEFAULT_PREFERENCES, fontSize: 20 })
    const entered = signal(), finish = signal()
    vi.spyOn(files, 'atomicWrite').mockImplementationOnce(async () => {
      entered.release()
      await finish.promise
      throw new Error('disk full')
    })
    const rejected = expect(store.updatePreferences({ ...store.preferences, fontSize: 28 })).rejects.toThrow('disk full')
    await entered.promise
    expect(store.preferences.fontSize).toBe(20)
    const recent = path.join(directory, 'concurrent.md')
    const fileWrite = store.addRecent(recent)
    const folderWrite = store.addRecentFolder(directory)
    finish.release()
    await Promise.all([rejected, fileWrite, folderWrite])
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))
    expect(store.preferences.fontSize).toBe(20)
    expect(saved.preferences.fontSize).toBe(20)
    expect(saved.recentFiles).toEqual([recent])
    expect(saved.recentFolders).toEqual([directory])
    await store.updatePreferences({ ...store.preferences, fontSize: 22 })
    expect(store.preferences.fontSize).toBe(22)
  })

  it('commits settings only after the write and keeps them when queued recent-file updates finish', async () => {
    const entered = signal(), finish = signal()
    const atomicWrite = files.atomicWrite
    vi.spyOn(files, 'atomicWrite').mockImplementationOnce(async (...args) => {
      entered.release()
      await finish.promise
      await atomicWrite(...args)
    })
    const preferenceWrite = store.updatePreferences({ ...DEFAULT_PREFERENCES, fontSize: 23 })
    await entered.promise
    const recent = path.join(directory, 'success.md')
    const fileWrite = store.addRecent(recent)
    expect(store.preferences.fontSize).toBe(DEFAULT_PREFERENCES.fontSize)
    finish.release()
    await Promise.all([preferenceWrite, fileWrite])
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))
    expect(store.preferences.fontSize).toBe(23)
    expect(saved.preferences.fontSize).toBe(23)
    expect(saved.recentFiles).toEqual([recent])
  })
})
