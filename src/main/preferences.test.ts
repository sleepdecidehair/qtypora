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
