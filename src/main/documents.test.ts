import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentSession, type DocumentDialogs, validateSnapshot } from './documents'
import { LocalStore, validatePreferences } from './preferences'
import { canonicalPath } from './files'
import { DEFAULT_PREFERENCES, type DesktopEvent, type DocumentRecord } from '../shared/contracts'

let directory: string
let store: LocalStore
const sessions: DocumentSession[] = []
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-documents-')))
  store = new LocalStore(path.join(directory, 'user'))
  await store.load()
})
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose()
  await fs.rm(directory, { recursive: true, force: true })
})

function makeSession(dialogs: Partial<DocumentDialogs> = {}, events: DesktopEvent[] = []): DocumentSession {
  const session = new DocumentSession(store, { chooseSave: async () => path.join(directory, 'saved.md'), confirmClose: async () => 'cancel', ...dialogs }, (event) => events.push(event))
  sessions.push(session)
  return session
}

describe('Document sessions and independent drafts', () => {
  it('persists an edited draft and recovers it in a fresh session', async () => {
    const session = makeSession()
    const document = session.create()
    await session.sync({ id: document.id, content: '# 恢复中文\n', revision: 1 })
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.drafts.get(document.id)?.content).toBe('# 恢复中文\n')
    const recovered = new DocumentSession(freshStore, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
    sessions.push(recovered)
    expect((await recovered.recover(document.id)).content).toBe('# 恢复中文\n')
    expect(await recovered.close({ id: document.id, content: '# 恢复中文\n', revision: 0 })).toBe(false)
    expect(freshStore.drafts.has(document.id)).toBe(true)
  })

  it('retains newer edits when a save dialog completes with an earlier snapshot', async () => {
    let choose: ((value: string | null) => void) | undefined
    let entered: (() => void) | undefined
    const dialogEntered = new Promise<void>((resolve) => { entered = resolve })
    const session = makeSession({ chooseSave: async () => { entered?.(); return new Promise<string | null>((resolve) => { choose = resolve }) } })
    const document = session.create()
    const saving = session.save({ id: document.id, content: 'saved snapshot', revision: 1 })
    await dialogEntered
    await session.sync({ id: document.id, content: 'newer unsaved edit', revision: 2 })
    choose?.(path.join(directory, 'saved.md'))
    const saved = await saving
    expect(saved?.content).toBe('saved snapshot')
    expect(await fs.readFile(path.join(directory, 'saved.md'), 'utf8')).toBe('saved snapshot')
    expect(session.records()[0].content).toBe('newer unsaved edit')
    expect(store.drafts.get(document.id)?.content).toBe('newer unsaved edit')
    expect(await session.close({ id: document.id, content: 'newer unsaved edit', revision: 2 })).toBe(false)
  })

  it('keeps all documents and drafts when the last close-window confirmation is cancelled', async () => {
    let confirmations = 0
    const session = makeSession({ confirmClose: async () => ++confirmations === 1 ? 'discard' : 'cancel' })
    const first = session.create()
    const second = session.create()
    const snapshots = [{ id: first.id, content: 'first unsaved', revision: 1 }, { id: second.id, content: 'second unsaved', revision: 1 }]
    expect(await session.canCloseWindow(snapshots)).toBe(false)
    expect(session.records()).toHaveLength(2)
    expect(store.drafts.has(first.id)).toBe(true)
    expect(store.drafts.has(second.id)).toBe(true)
  })

  it('rejects a repeated close request while the native confirmation is pending', async () => {
    let finish: ((value: 'save' | 'discard' | 'cancel') => void) | undefined
    let entered: (() => void) | undefined
    let prompts = 0
    const promptEntered = new Promise<void>((resolve) => { entered = resolve })
    const session = makeSession({ confirmClose: async () => {
      prompts++
      entered?.()
      return new Promise((resolve) => { finish = resolve })
    } })
    const document = session.create()
    const snapshots = [{ id: document.id, content: 'unsaved', revision: 1 }]
    const first = session.canCloseWindow(snapshots)
    await promptEntered
    expect(await session.canCloseWindow(snapshots)).toBe(false)
    expect(prompts).toBe(1)
    finish?.('cancel')
    expect(await first).toBe(false)
    expect(session.records()).toHaveLength(1)
  })

  it('keeps single-document and window-close confirmations mutually exclusive', async () => {
    let finish: ((value: 'save' | 'discard' | 'cancel') => void) | undefined
    let entered: (() => void) | undefined
    let prompts = 0
    const promptEntered = new Promise<void>((resolve) => { entered = resolve })
    const session = makeSession({ confirmClose: async () => {
      prompts++
      entered?.()
      return new Promise((resolve) => { finish = resolve })
    } })
    const document = session.create()
    const snapshot = { id: document.id, content: 'keep this draft', revision: 1 }
    const closing = session.close(snapshot)
    await promptEntered
    expect(await session.close(snapshot)).toBe(false)
    expect(await session.canCloseWindow([snapshot])).toBe(false)
    expect(prompts).toBe(1)
    finish?.('cancel')
    expect(await closing).toBe(false)
    expect(store.drafts.get(document.id)?.content).toBe('keep this draft')
    expect(session.records()).toHaveLength(1)
  })

  it('does not accept incomplete window snapshots or same-revision different content', async () => {
    const session = makeSession()
    const document = session.create()
    await expect(session.canCloseWindow([])).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await session.sync({ id: document.id, content: 'latest', revision: 2 })
    await expect(session.sync({ id: document.id, content: 'different', revision: 2 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await session.sync({ id: document.id, content: 'stale', revision: 1 })
    expect(session.records()[0].content).toBe('latest')
  })

  it('preserves a dirty draft when the disk file conflicts at save time', async () => {
    const target = path.join(directory, 'existing.md')
    await fs.writeFile(target, 'initial')
    const session = makeSession()
    const document = await session.open(target, true)
    await fs.writeFile(target, 'external')
    await expect(session.save({ id: document.id, content: 'editor', revision: 1 })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(store.drafts.get(document.id)?.content).toBe('editor')
    expect(await fs.readFile(target, 'utf8')).toBe('external')
  })

  it('sends rename metadata without replacing unsaved content', async () => {
    const oldPath = path.join(directory, 'old.md')
    const newPath = path.join(directory, 'new.md')
    await fs.writeFile(oldPath, 'initial')
    const events: DesktopEvent[] = []
    const session = makeSession({}, events)
    const document = await session.open(oldPath, true)
    await session.sync({ id: document.id, content: 'dirty editor', revision: 1 })
    await fs.rename(oldPath, newPath)
    await session.updatePaths(oldPath, newPath)
    expect(events).toContainEqual({ type: 'document-renamed', id: document.id, name: 'new.md', path: newPath })
    expect(session.records()[0].content).toBe('dirty editor')
    expect(store.drafts.get(document.id)?.path).toBe(newPath)
  })

  it('protects the only in-memory copy when a clean disk document is removed', async () => {
    const target = path.join(directory, 'removed.md')
    await fs.writeFile(target, 'only remaining copy')
    const session = makeSession()
    const document = await session.open(target, true)
    await fs.unlink(target)
    await session.updatePaths(target, null)
    expect(store.drafts.get(document.id)?.content).toBe('only remaining copy')
    expect(await session.close({ id: document.id, content: document.content, revision: 0 })).toBe(false)
    expect(session.records()).toHaveLength(1)
    expect(store.drafts.has(document.id)).toBe(true)
  })

  it('keeps a new welcome document clean until the user changes it', async () => {
    const session = makeSession()
    const document = session.create('# 欢迎')
    expect(await session.canCloseWindow([{ id: document.id, content: '# 欢迎', revision: 0 }])).toBe(true)
  })

  it('rejects malformed snapshots and out-of-range preferences', () => {
    expect(() => validateSnapshot({ id: 'doc', content: 'text', revision: -1 })).toThrow()
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, autoSaveSeconds: 0 })).toThrow()
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, autoSave: 'true' })).toThrow()
  })

  it('restores preferences and recent files from the user configuration', async () => {
    await store.updatePreferences({ ...DEFAULT_PREFERENCES, theme: 'dark', autoSave: true, autoSaveSeconds: 10 })
    await store.addRecent(path.join(directory, '一.md'))
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.preferences.theme).toBe('dark')
    expect(freshStore.preferences.autoSaveSeconds).toBe(10)
    expect(freshStore.recentFiles).toEqual([path.join(directory, '一.md')])
  })

  it('migrates legacy settings by defaulting only the missing readingMode field', async () => {
    const legacyPreferences: Record<string, unknown> = {
      ...DEFAULT_PREFERENCES, theme: 'dark', fontSize: 22, contentWidth: 960, wrapLines: false,
    }
    delete legacyPreferences.readingMode
    const recent = path.join(directory, '旧配置.md')
    await fs.writeFile(path.join(directory, 'user', 'settings.json'), JSON.stringify({ preferences: legacyPreferences, recentFiles: [recent] }))
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.preferences).toMatchObject({ readingMode: false, theme: 'dark', fontSize: 22, contentWidth: 960, wrapLines: false })
    expect(freshStore.recentFiles).toEqual([recent])
  })

  it('validates explicit readingMode values instead of coercing a malformed setting', () => {
    expect(validatePreferences({ ...DEFAULT_PREFERENCES, readingMode: true }).readingMode).toBe(false)
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, readingMode: 'false' })).toThrow()
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, readingMode: null })).toThrow()
  })
  it('migrates the legacy default width to fluid layout while retaining customized widths', () => {
    const { contentWidthMode: _mode, ...legacy } = DEFAULT_PREFERENCES
    expect(validatePreferences(legacy)).toMatchObject({ contentWidth: 800, contentWidthMode: 'auto' })
    expect(validatePreferences({ ...legacy, contentWidth: 960 })).toMatchObject({ contentWidth: 960, contentWidthMode: 'fixed' })
    expect(validatePreferences({ ...legacy, contentWidth: 800, contentWidthMode: 'fixed' }).contentWidthMode).toBe('fixed')
    expect(() => validatePreferences({ ...legacy, contentWidthMode: null })).toThrow()
    expect(() => validatePreferences({ ...legacy, contentWidthMode: 'wide' })).toThrow()
  })
  it('persists fluid layout and the retained fixed width across reloads', async () => {
    await store.updatePreferences({ ...DEFAULT_PREFERENCES, contentWidth: 1200, contentWidthMode: 'auto' })
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.preferences).toMatchObject({ contentWidth: 1200, contentWidthMode: 'auto' })
  })

  it('retires legacy readingMode while preserving an explicitly selected source mode and theme', async () => {
    await fs.writeFile(path.join(directory, 'user', 'settings.json'), JSON.stringify({ preferences: {
      ...DEFAULT_PREFERENCES, readingMode: true, sourceMode: true, theme: 'dark', fontSize: 20,
    }, recentFiles: [] }))
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.preferences).toMatchObject({ readingMode: false, sourceMode: true, theme: 'dark', fontSize: 20 })
  })

  it('preserves unknown future configuration fields when known preferences or recent files change', async () => {
    const settingsPath = path.join(directory, 'user', 'settings.json')
    await fs.writeFile(settingsPath, JSON.stringify({ preferences: {
      ...DEFAULT_PREFERENCES, futureEditorOption: { enabled: true },
    }, recentFiles: [], futureSchema: 2, futureExportProfiles: [{ name: 'User Profile' }] }))
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    await freshStore.updatePreferences({ ...freshStore.preferences, theme: 'dark' })
    await freshStore.addRecent(path.join(directory, 'future.md'))
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>
    expect(settings).toMatchObject({ futureSchema: 2, futureExportProfiles: [{ name: 'User Profile' }],
      preferences: { theme: 'dark', futureEditorOption: { enabled: true } },
    })
  })

  it('rejects an older save after a newer snapshot has been committed', async () => {
    const pending: ((destination: string | null) => void)[] = []
    const session = makeSession({ chooseSave: async (_record: DocumentRecord) => new Promise((resolve) => pending.push(resolve)) })
    const document = session.create()
    const oldSave = session.save({ id: document.id, content: 'older snapshot', revision: 1 })
    while (pending.length < 1) await new Promise((resolve) => setTimeout(resolve, 5))
    const newSave = session.save({ id: document.id, content: 'newest snapshot', revision: 2 })
    while (pending.length < 2) await new Promise((resolve) => setTimeout(resolve, 5))
    pending[1](path.join(directory, 'newest.md'))
    await newSave
    pending[0](path.join(directory, 'older.md'))
    await expect(oldSave).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(directory, 'newest.md'), 'utf8')).toBe('newest snapshot')
    await expect(fs.stat(path.join(directory, 'older.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
