import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession, type DocumentDialogs, validateSnapshot } from './documents'
import { LocalStore, validatePreferences } from './preferences'
import { canonicalPath, MAX_DOCUMENT_BYTES } from './files'
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
  it('preserves the draft and both files when CRLF and BOM exceed the encoded size limit', async () => {
    const filename = path.join(directory, 'size-original.md'), destination = path.join(directory, 'size-copy.md')
    const original = Buffer.from('\ufefforiginal\r\n'), priorCopy = Buffer.from('existing copy')
    await fs.writeFile(filename, original)
    await fs.writeFile(destination, priorCopy)
    const session = makeSession({ chooseSave: async () => destination }), document = await session.open(filename, true)
    const content = '\n'.repeat(Math.floor(MAX_DOCUMENT_BYTES / 2) + 1)
    const snapshot = { id: document.id, content, revision: 1 }
    await expect(session.save(snapshot)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(session.save({ ...snapshot, saveAs: true })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(await fs.readFile(filename)).toEqual(original)
    expect(await fs.readFile(destination)).toEqual(priorCopy)
    expect(store.drafts.get(document.id)?.content).toBe(content)
    const freshStore = new LocalStore(path.join(directory, 'user'))
    await freshStore.load()
    expect(freshStore.drafts.get(document.id)?.content).toBe(content)
  })

  it('retains the previous session and draft when reload cannot delete the draft', async () => {
    const filename = path.join(directory, 'reload-failure.md')
    await fs.writeFile(filename, 'disk before')
    const session = makeSession(), document = await session.open(filename, true)
    const snapshot = { id: document.id, content: 'local draft', revision: 1 }
    await session.sync(snapshot)
    await fs.writeFile(filename, 'disk changed')
    vi.spyOn(store, 'discardDraft').mockRejectedValueOnce(new Error('draft removal failed'))
    await expect(session.reload(document.id)).rejects.toThrow('draft removal failed')
    expect(session.records()[0]).toMatchObject({ content: 'local draft', version: document.version })
    expect(store.drafts.get(document.id)?.content).toBe('local draft')
    expect(await fs.readFile(filename, 'utf8')).toBe('disk changed')
    const restored = new LocalStore(path.join(directory, 'user')); await restored.load()
    expect(restored.drafts.get(document.id)?.content).toBe('local draft')
  })

  it('retains an in-memory and on-disk draft when actual draft removal fails and allows retry', async () => {
    const filename = path.join(directory, 'reload-unlink-failure.md')
    await fs.writeFile(filename, 'disk before')
    const session = makeSession(), document = await session.open(filename, true)
    await session.sync({ id: document.id, content: 'protected local draft', revision: 1 })
    await fs.writeFile(filename, 'disk changed')
    const draftPath = path.join(directory, 'user', 'drafts', `${document.id}.json`), backup = draftPath + '.backup'
    await fs.rename(draftPath, backup); await fs.mkdir(draftPath)
    await expect(session.reload(document.id)).rejects.toThrow()
    expect(session.records()[0]).toMatchObject({ content: 'protected local draft', version: document.version })
    expect(store.drafts.get(document.id)?.content).toBe('protected local draft')
    expect(JSON.parse(await fs.readFile(backup, 'utf8')).content).toBe('protected local draft')
    await fs.rmdir(draftPath); await fs.rename(backup, draftPath)
    expect((await session.reload(document.id)).content).toBe('disk changed')
    expect(store.drafts.has(document.id)).toBe(false)
  })

  it('preserves a sync queued while reload is removing the previous draft', async () => {
    const filename = path.join(directory, 'reload-late-sync.md')
    await fs.writeFile(filename, 'disk before')
    const session = makeSession(), document = await session.open(filename, true)
    await session.sync({ id: document.id, content: 'initial draft', revision: 1 })
    await fs.writeFile(filename, 'disk changed')
    const original = store.discardDraft.bind(store)
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const waiting = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(store, 'discardDraft').mockImplementationOnce(async id => { entered(); await gate; await original(id) })
    const loading = session.reload(document.id)
    await waiting
    const late = session.sync({ id: document.id, content: 'late input', revision: 2 })
    release()
    expect((await loading).content).toBe('disk changed')
    await late
    expect(session.records()[0]).toMatchObject({ content: 'late input' })
    expect(store.drafts.get(document.id)?.content).toBe('late input')
  })
  it('persists a line-ending-only edit, prompts on close, and writes explicit conversion', async () => {
    const filename = path.join(directory, 'line-endings.md')
    await fs.writeFile(filename, Buffer.from('\ufefffirst\r\nsecond\nthird'))
    let prompts = 0
    const session = makeSession({ confirmClose: async () => { prompts++; return 'cancel' } })
    const document = await session.open(filename, true)
    const snapshot = { id: document.id, content: document.content, revision: 1, pendingLineEnding: 'CRLF' as const }
    await session.sync(snapshot)
    expect(store.drafts.get(document.id)).toMatchObject({ pendingLineEnding: 'CRLF', baseVersion: document.version, encoding: 'utf8-bom' })
    expect(await session.close(snapshot)).toBe(false)
    expect(prompts).toBe(1)
    expect(await fs.readFile(filename)).toEqual(Buffer.from('\ufefffirst\r\nsecond\nthird'))
    await session.save(snapshot)
    expect(await fs.readFile(filename)).toEqual(Buffer.from('\ufefffirst\r\nsecond\r\nthird'))
    expect(session.records()[0].pendingLineEnding).toBeNull()
    expect(store.drafts.has(document.id)).toBe(false)
  })

  it('recovers an explicit conversion only against its original disk version', async () => {
    const filename = path.join(directory, 'conversion-recovery.md')
    await fs.writeFile(filename, Buffer.from('\ufefffirst\r\nsecond'))
    const session = makeSession(), document = await session.open(filename, true)
    await session.sync({ id: document.id, content: document.content, revision: 1, pendingLineEnding: 'LF' })
    const reloaded = new LocalStore(path.join(directory, 'user')); await reloaded.load()
    const fresh = new DocumentSession(reloaded, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
    sessions.push(fresh)
    await fs.writeFile(filename, 'external change')
    await expect(fresh.recover(document.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(reloaded.drafts.get(document.id)?.pendingLineEnding).toBe('LF')
    expect(await fs.readFile(filename, 'utf8')).toBe('external change')
    await fs.writeFile(filename, Buffer.from('\ufefffirst\r\nsecond'))
    const recovered = await fresh.recover(document.id)
    expect(recovered).toMatchObject({ content: document.content, pendingLineEnding: 'LF', encoding: 'utf8-bom' })
    await fresh.save({ id: recovered.id, content: recovered.content, revision: 0, pendingLineEnding: 'LF' })
    expect(await fs.readFile(filename)).toEqual(Buffer.from('\ufefffirst\nsecond'))
  })

  it('retains a newer line-ending choice while an earlier save dialog is open', async () => {
    let choose!: (destination: string) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ chooseSave: async () => { entered(); return new Promise(resolve => { choose = resolve }) } })
    const document = session.create(), destination = path.join(directory, 'earlier.md')
    const saving = session.save({ id: document.id, content: 'one\ntwo', revision: 1, pendingLineEnding: 'CRLF' })
    await waiting
    await session.sync({ id: document.id, content: 'one\ntwo\nnew', revision: 2, pendingLineEnding: 'LF' })
    choose(destination)
    await saving
    expect(await fs.readFile(destination, 'utf8')).toBe('one\r\ntwo')
    expect(store.drafts.get(document.id)).toMatchObject({ content: 'one\ntwo\nnew', pendingLineEnding: 'LF' })
  })

  it('clears a fulfilled conversion but retains later text while saving', async () => {
    let choose!: (destination: string) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ chooseSave: async () => { entered(); return new Promise(resolve => { choose = resolve }) } })
    const document = session.create(), destination = path.join(directory, 'same-ending.md')
    const saving = session.save({ id: document.id, content: 'one\ntwo', revision: 1, pendingLineEnding: 'CRLF' })
    await waiting
    await session.sync({ id: document.id, content: 'one\ntwo\nnew', revision: 2, pendingLineEnding: 'CRLF' })
    choose(destination)
    const saved = await saving
    expect(saved?.savedLineEndingConversion).toBe('CRLF')
    expect(session.records()[0]).toMatchObject({ content: 'one\ntwo\nnew', pendingLineEnding: null, lineEnding: 'CRLF' })
    await session.sync({ id: document.id, content: 'one\ntwo\nnew', revision: 2, pendingLineEnding: 'CRLF' })
    expect(session.records()[0].pendingLineEnding).toBeNull()
    expect(store.drafts.get(document.id)?.content).toBe('one\ntwo\nnew')
  })

  it('accepts an in-flight snapshot of a conversion already committed at the same revision', async () => {
    const filename = path.join(directory, 'late-sync.md')
    await fs.writeFile(filename, 'first\r\nsecond')
    const session = makeSession(), document = await session.open(filename, true)
    const snapshot = { id: document.id, content: document.content, revision: 1, pendingLineEnding: 'LF' as const }
    await session.sync(snapshot)
    let late: Promise<void> | undefined
    await session.save(snapshot, () => { late = session.sync(snapshot) })
    await expect(late).resolves.toBeUndefined()
    expect(session.records()[0].pendingLineEnding).toBeNull()
    expect(store.drafts.has(document.id)).toBe(false)
    expect(await fs.readFile(filename, 'utf8')).toBe('first\nsecond')
    await expect(session.sync({ ...snapshot, pendingLineEnding: 'CRLF' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(session.sync({ ...snapshot, content: 'different' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('reports a committed conversion even when post-save draft cleanup fails', async () => {
    const filename = path.join(directory, 'conversion-cleanup-failure.md')
    await fs.writeFile(filename, 'first\r\nsecond')
    const session = makeSession(), document = await session.open(filename, true)
    const snapshot = { id: document.id, content: document.content, revision: 1, pendingLineEnding: 'LF' as const }
    await session.sync(snapshot)
    vi.spyOn(store, 'discardDraft').mockRejectedValueOnce(new Error('draft cleanup failed'))
    const committed: DocumentRecord[] = []
    await expect(session.save(snapshot, record => committed.push(record))).rejects.toThrow('draft cleanup failed')
    expect(committed[0]).toMatchObject({ lineEnding: 'LF', savedLineEndingConversion: 'LF' })
    expect(await fs.readFile(filename, 'utf8')).toBe('first\nsecond')
    expect(store.drafts.has(document.id)).toBe(true)
    await session.sync(snapshot)
    expect(store.drafts.has(document.id)).toBe(false)
  })

  it('reports a committed conversion when a later document cancels window close', async () => {
    const filename = path.join(directory, 'close-conversion.md')
    await fs.writeFile(filename, 'first\r\nsecond')
    let prompts = 0
    const session = makeSession({ confirmClose: async () => ++prompts === 1 ? 'save' : 'cancel' })
    const first = await session.open(filename, true), second = session.create()
    const snapshots = [
      { id: first.id, content: first.content, revision: 1, pendingLineEnding: 'LF' as const },
      { id: second.id, content: 'unsaved second', revision: 1 },
    ]
    const committed: DocumentRecord[] = []
    expect(await session.canCloseWindow(snapshots, async () => true, record => committed.push(record))).toBe(false)
    expect(committed[0]).toMatchObject({ savedLineEndingConversion: 'LF', lineEnding: 'LF' })
    expect(await fs.readFile(filename, 'utf8')).toBe('first\nsecond')
    expect(store.drafts.get(second.id)?.content).toBe('unsaved second')
  })

  it('rejects a stale conversion from a second window and retains its draft', async () => {
    const filename = path.join(directory, 'two-window-conversion.md')
    await fs.writeFile(filename, Buffer.from('\ufeffone\r\ntwo\nthree'))
    const first = makeSession(), second = makeSession()
    const firstDoc = await first.open(filename, true), secondDoc = await second.open(filename, true)
    const firstSnapshot = { id: firstDoc.id, content: firstDoc.content, revision: 1, pendingLineEnding: 'CRLF' as const }
    const secondSnapshot = { id: secondDoc.id, content: secondDoc.content, revision: 1, pendingLineEnding: 'LF' as const }
    await first.sync(firstSnapshot); await second.sync(secondSnapshot)
    await first.save(firstSnapshot)
    await expect(second.save(secondSnapshot)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(filename)).toEqual(Buffer.from('\ufeffone\r\ntwo\r\nthree'))
    expect(store.drafts.get(secondDoc.id)).toMatchObject({ content: secondDoc.content, pendingLineEnding: 'LF', baseVersion: secondDoc.version })
  })
  for (const failure of ['draft', 'recent'] as const) {
    it(`reports a committed save when ${failure} persistence fails during close`, async () => {
      const session = makeSession({ confirmClose: async () => 'save' })
      const document = session.create()
      const snapshot = { id: document.id, content: 'written content', revision: 1 }
      if (failure === 'draft') vi.spyOn(store, 'discardDraft').mockRejectedValueOnce(new Error('draft failure'))
      else vi.spyOn(store, 'addRecent').mockRejectedValueOnce(new Error('recent failure'))
      const committed: DocumentRecord[] = []
      await expect(session.close(snapshot, async () => true, record => committed.push(record))).rejects.toThrow(`${failure} failure`)
      expect(await fs.readFile(path.join(directory, 'saved.md'), 'utf8')).toBe(snapshot.content)
      expect(committed).toEqual([expect.objectContaining({ id: document.id, path: path.join(directory, 'saved.md'), content: snapshot.content })])
      expect(session.records()[0]).toMatchObject({ id: document.id, path: path.join(directory, 'saved.md'), content: snapshot.content })
    })
  }
  it('reports the committed snapshot and retains later edits when recent-file persistence fails', async () => {
    let choose!: (destination: string) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ chooseSave: async () => { entered(); return new Promise(resolve => { choose = resolve }) } })
    const document = session.create(), committed: DocumentRecord[] = []
    const saving = session.save({ id: document.id, content: 'saved snapshot', revision: 1 }, record => committed.push(record))
    await waiting
    await session.sync({ id: document.id, content: 'later edit', revision: 2 })
    vi.spyOn(store, 'addRecent').mockRejectedValueOnce(new Error('recent failure'))
    choose(path.join(directory, 'saved.md'))
    await expect(saving).rejects.toThrow('recent failure')
    expect(committed[0]).toMatchObject({ content: 'saved snapshot', path: path.join(directory, 'saved.md') })
    expect(await fs.readFile(path.join(directory, 'saved.md'), 'utf8')).toBe('saved snapshot')
    expect(session.records()[0].content).toBe('later edit')
    expect(store.drafts.get(document.id)?.content).toBe('later edit')
  })
  it('limits version previews to a verified document session and preserves the draft', async () => {
    const filename = path.join(directory, 'version-session.md'), historic = path.join(directory, 'historic.md')
    await fs.writeFile(filename, 'disk')
    await fs.writeFile(historic, Buffer.from('\ufeffold\r\n'))
    const provider = { list: async () => [{ identifier: 'one', modifiedAt: '2026-01-01T00:00:00.000Z', path: historic }] }
    const session = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined, provider)
    const second = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined, provider)
    sessions.push(session, second)
    const document = await session.open(filename, true), other = await second.open(filename, true)
    const snapshot = { id: document.id, content: 'unsaved draft', revision: 1 }
    const [version] = await session.listSystemVersions(snapshot)
    expect(await session.readSystemVersion(snapshot, version.token)).toEqual(Buffer.from('\ufeffold\r\n'))
    expect(await fs.readFile(filename, 'utf8')).toBe('disk')
    expect(store.drafts.get(document.id)?.content).toBe('unsaved draft')
    await expect(second.readSystemVersion({ id: other.id, content: 'disk', revision: 0 }, version.token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await session.save(snapshot)
    expect(await session.listSystemVersions(snapshot)).toHaveLength(1)
    const replacement = path.join(directory, 'replacement.md')
    await fs.writeFile(replacement, 'unsaved draft')
    await fs.rename(replacement, filename)
    await expect(session.listSystemVersions(snapshot)).rejects.toMatchObject({ code: 'CONFLICT' })
    await session.save(snapshot)
    await expect(session.listSystemVersions(snapshot)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(filename, 'utf8')).toBe('unsaved draft')
  })
  it('blocks loading and creation while window close is awaiting validation, then unblocks on cancellation', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const session = makeSession(), document = await session.open(file, true)
    let finish!: (valid: boolean) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const closing = session.canCloseWindow([{ id: document.id, content: document.content, revision: 0 }], async () => {
      entered(); return new Promise<boolean>(resolve => { finish = resolve })
    })
    await waiting
    expect(() => session.create()).toThrow()
    await expect(session.open(file, true)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(session.reload(document.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(session.recover('missing')).rejects.toMatchObject({ code: 'CONFLICT' })
    finish(false)
    expect(await closing).toBe(false)
    expect(session.create().id).toBeTruthy()
  })

  it('rejects an in-flight open when window close begins during recent-file persistence', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const session = makeSession(), original = session.create()
    let release!: () => void, entered!: () => void, finish!: (valid: boolean) => void, validating!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const validationStarted = new Promise<void>(resolve => { validating = resolve })
    const spy = vi.spyOn(store, 'addRecent').mockImplementationOnce(async () => { entered(); await pending })
    const opening = session.open(file, true)
    await started
    const closing = session.canCloseWindow([{ id: original.id, content: '', revision: 0 }], async () => {
      validating(); return new Promise<boolean>(resolve => { finish = resolve })
    })
    await validationStarted
    release()
    await expect(opening).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(session.records()).toHaveLength(1)
    finish(false); expect(await closing).toBe(false)
    spy.mockRestore()
    expect((await session.open(file, true)).content).toBe('disk')
  })

  it('rejects new operations after close approval seals the session', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const session = makeSession(), document = await session.open(file, true)
    session.sealForWindowClose()
    expect(() => session.create()).toThrow()
    await expect(session.open(file, true)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(session.reload(document.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(session.recover('missing')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('retains documents and drafts when final renderer validation fails', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = session.create()
    const snap = { id: document.id, content: 'unsaved input', revision: 1 }
    const validate = vi.fn(async () => false)
    expect(await session.close(snap, validate)).toBe(false)
    expect(store.drafts.get(document.id)?.content).toBe(snap.content)
    expect(session.records()[0].content).toBe(snap.content)
    expect(await session.canCloseWindow([snap], validate)).toBe(false)
    expect(store.drafts.get(document.id)?.content).toBe(snap.content)
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale final validation if content changes during the handshake', async () => {
    let finish!: (valid: boolean) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = session.create()
    const closing = session.canCloseWindow([{ id: document.id, content: 'old', revision: 1 }], async () => {
      entered()
      return new Promise<boolean>(resolve => { finish = resolve })
    })
    await waiting
    await session.sync({ id: document.id, content: 'new', revision: 2 })
    finish(true)
    expect(await closing).toBe(false)
    expect(store.drafts.get(document.id)?.content).toBe('new')
    expect(session.records()[0].content).toBe('new')
  })

  for (const windowClose of [false, true]) {
    it(`restores the draft if renderer validation fails after cleanup (${windowClose ? 'window' : 'document'})`, async () => {
      const session = makeSession({ confirmClose: async () => 'discard' })
      const document = session.create()
      const snap = { id: document.id, content: 'unsaved', revision: 1 }
      let count = 0
      const validate = async () => ++count === 1
      expect(await (windowClose ? session.canCloseWindow([snap], validate) : session.close(snap, validate))).toBe(false)
      expect(count).toBe(2)
      expect(session.records()[0].content).toBe('unsaved')
      expect(store.drafts.get(document.id)?.content).toBe('unsaved')
    })
  }

  it('restores the same document and persists a later edit after a successful close', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = session.create()
    const original = { id: document.id, content: 'original', revision: 1 }
    expect(await session.close(original)).toBe(true)
    const later = { id: document.id, content: 'original late edit', revision: 2 }
    await session.restoreClosedEdit(later)
    expect(session.records().find(item => item.id === document.id)?.content).toBe(later.content)
    expect(store.drafts.get(document.id)?.content).toBe(later.content)
    await expect(session.restoreClosedEdit(later)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('retains a usable session when restoring a late edit cannot persist its draft', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = session.create()
    expect(await session.close({ id: document.id, content: 'original', revision: 1 })).toBe(true)
    const later = { id: document.id, content: 'late edit', revision: 2 }
    const write = store.writeDraft.bind(store)
    let fail = true
    vi.spyOn(store, 'writeDraft').mockImplementation(async draft => {
      if (fail) { fail = false; throw new Error('injected failure') }
      return write(draft)
    })
    await expect(session.restoreClosedEdit(later)).rejects.toThrow('injected failure')
    expect(session.records().find(item => item.id === document.id)?.content).toBe('late edit')
    await session.sync(later)
    expect(store.drafts.get(document.id)?.content).toBe('late edit')
  })

  it('attempts every draft after a prevented window close and allows failed writes to retry', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const first = session.create(), second = session.create()
    const snapshots = [{ id: first.id, content: 'first unsaved', revision: 1 }, { id: second.id, content: 'second unsaved', revision: 1 }]
    expect(await session.canCloseWindow(snapshots)).toBe(true)
    session.sealForWindowClose()
    const write = store.writeDraft.bind(store)
    let fail = true
    vi.spyOn(store, 'writeDraft').mockImplementation(async draft => {
      if (draft.id === first.id && fail) { fail = false; throw new Error('injected failure') }
      return write(draft)
    })
    await expect(session.restoreAfterPreventedWindowClose()).rejects.toThrow('injected failure')
    expect(store.drafts.get(second.id)?.content).toBe('second unsaved')
    await session.sync(snapshots[0])
    expect(store.drafts.get(first.id)?.content).toBe('first unsaved')
  })

  it('attempts every draft after close cleanup fails even when another restoration fails', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const first = session.create(), second = session.create()
    const snapshots = [{ id: first.id, content: 'first unsaved', revision: 1 }, { id: second.id, content: 'second unsaved', revision: 1 }]
    const discard = store.discardDraft.bind(store), write = store.writeDraft.bind(store)
    let cleaning = false, failRestore = true
    vi.spyOn(store, 'discardDraft').mockImplementation(async id => {
      if (id === first.id) { await discard(id); cleaning = true; return }
      if (cleaning && id === second.id) throw new Error('cleanup failure')
      return discard(id)
    })
    vi.spyOn(store, 'writeDraft').mockImplementation(async draft => {
      if (cleaning && draft.id === first.id && failRestore) { failRestore = false; throw new Error('restore failure') }
      return write(draft)
    })
    await expect(session.canCloseWindow(snapshots)).rejects.toThrow('restore failure')
    expect(store.drafts.get(second.id)?.content).toBe('second unsaved')
    await session.sync(snapshots[0])
    expect(store.drafts.get(first.id)?.content).toBe('first unsaved')
  })

  it('reports an already saved document even when a later close prompt is cancelled', async () => {
    const saved: Array<{ document: DocumentRecord; revision: number }> = []
    let count = 0
    const session = makeSession({ confirmClose: async () => ++count === 1 ? 'save' : 'cancel' })
    const first = session.create(), second = session.create()
    const snapshots = [{ id: first.id, content: 'saved first', revision: 1 }, { id: second.id, content: 'keep second', revision: 1 }]
    expect(await session.canCloseWindow(snapshots, async () => true, (document, revision) => saved.push({ document, revision }))).toBe(false)
    expect(await fs.readFile(path.join(directory, 'saved.md'), 'utf8')).toBe('saved first')
    expect(saved).toContainEqual(expect.objectContaining({ revision: 1, document: expect.objectContaining({ id: first.id, path: path.join(directory, 'saved.md'), content: 'saved first' }) }))
    expect(store.drafts.get(second.id)?.content).toBe('keep second')
  })

  it('recovers late edits independently when the same path has already been reopened', async () => {
    const filename = path.join(directory, 'duplicate.md')
    await fs.writeFile(filename, 'disk', 'utf8')
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = await session.open(filename, true)
    expect(await session.close({ id: document.id, content: 'initial edit', revision: 1 })).toBe(true)
    const reopened = await session.open(filename, true)
    const restored = await session.restoreClosedEdit({ id: document.id, content: 'late edit', revision: 2 })
    expect(restored.path).toBeNull()
    expect(restored.unsaved).toBe(true)
    expect(session.records().find(item => item.id === reopened.id)?.content).toBe('disk')
    expect(store.drafts.get(document.id)?.content).toBe('late edit')
  })

  it('reports the independent restored path even if its first draft write fails', async () => {
    const filename = path.join(directory, 'duplicate-failure.md')
    await fs.writeFile(filename, 'disk')
    const session = makeSession({ confirmClose: async () => 'discard' })
    const document = await session.open(filename, true)
    expect(await session.close({ id: document.id, content: 'initial edit', revision: 1 })).toBe(true)
    const reopened = await session.open(filename, true)
    const write = store.writeDraft.bind(store)
    let fail = true
    vi.spyOn(store, 'writeDraft').mockImplementation(async draft => {
      if (draft.id === document.id && fail) { fail = false; throw new Error('injected failure') }
      return write(draft)
    })
    const later = { id: document.id, content: 'late edit', revision: 2 }
    await expect(session.restoreClosedEdit(later)).rejects.toThrow('injected failure')
    expect(session.records().find(item => item.id === document.id)).toMatchObject({ path: null, content: 'late edit', unsaved: true })
    expect(session.records().find(item => item.id === reopened.id)?.content).toBe('disk')
    await session.sync(later)
    expect(store.drafts.get(document.id)?.content).toBe('late edit')
  })
  it('uses the current interface language for new names without renaming existing documents', () => {
    const session = makeSession()
    const original = session.create()
    expect(original.name).toBe('未命名1.md')
    store.preferences = { ...store.preferences, locale: 'en-US' }
    expect(session.create().name).toBe('Untitled2.md')
    expect(session.get(original.id).record.name).toBe('未命名1.md')
  })

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

  it('writes recovered draft bytes before removing the draft, preserving BOM and CRLF', async () => {
    const filename = path.join(directory, 'recovered.md')
    const original = Buffer.from('\ufeffdisk\r\n', 'utf8')
    await fs.writeFile(filename, original)
    const id = 'aa111111-1111-4111-8111-111111111111'
    await store.writeDraft({ id, name: 'recovered.md', path: filename, content: 'draft\nnext\n', revision: 1, updatedAt: new Date().toISOString() })
    const session = makeSession()
    const recovered = await session.recover(id)
    expect(recovered.content).toBe('draft\nnext\n')
    expect(await fs.readFile(filename)).toEqual(original)
    expect(store.drafts.get(id)?.content).toBe('draft\nnext\n')
    await session.save({ id, content: recovered.content, revision: 0 })
    expect(await fs.readFile(filename)).toEqual(Buffer.from('\ufeffdraft\r\nnext\r\n', 'utf8'))
    expect(store.drafts.has(id)).toBe(false)
  })

  it('keeps recovered draft when the disk changes before saving', async () => {
    const filename = path.join(directory, 'recovered-conflict.md')
    await fs.writeFile(filename, 'original')
    const id = 'bb222222-2222-4222-8222-222222222222'
    await store.writeDraft({ id, name: 'recovered-conflict.md', path: filename, content: 'important draft', revision: 1, updatedAt: new Date().toISOString() })
    const session = makeSession()
    const recovered = await session.recover(id)
    await fs.writeFile(filename, 'external update')
    await expect(session.save({ id, content: recovered.content, revision: 0 })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(filename, 'utf8')).toBe('external update')
    expect(store.drafts.get(id)?.content).toBe('important draft')
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

  for (const answer of ['discard', 'save'] as const) {
    it(`retains newer edits when ${answer} confirmation is delayed`, async () => {
      let finish!: (choice: 'save' | 'discard' | 'cancel') => void, entered!: () => void
      const waiting = new Promise<void>(resolve => { entered = resolve })
      const session = makeSession({ confirmClose: async () => { entered(); return new Promise(resolve => { finish = resolve }) } })
      const document = session.create()
      const close = session.close({ id: document.id, content: 'before prompt', revision: 1 })
      await waiting
      await session.sync({ id: document.id, content: 'newer edit', revision: 2 })
      finish(answer)
      expect(await close).toBe(false)
      expect(session.records()[0].content).toBe('newer edit')
      expect(store.drafts.get(document.id)?.content).toBe('newer edit')
      expect(await session.reopenClosed()).toBeNull()
    })
  }

  it('retains an earlier discarded document if it changes while another window-close prompt is open', async () => {
    let count = 0, finish!: (choice: 'save' | 'discard' | 'cancel') => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ confirmClose: async () => { if (++count === 1) return 'discard'; entered(); return new Promise(resolve => { finish = resolve }) } })
    const first = session.create(), second = session.create()
    const closing = session.canCloseWindow([{ id: first.id, content: 'first', revision: 1 }, { id: second.id, content: 'second', revision: 1 }])
    await waiting
    await session.sync({ id: first.id, content: 'new first', revision: 2 })
    finish('discard')
    expect(await closing).toBe(false)
    expect(session.records()).toHaveLength(2)
    expect(store.drafts.get(first.id)?.content).toBe('new first')
    expect(store.drafts.get(second.id)?.content).toBe('second')
  })

  it('keeps new edits and the saved snapshot when close is waiting for Save As', async () => {
    let entered!: () => void, choose!: (path: string | null) => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const session = makeSession({ confirmClose: async () => 'save', chooseSave: async () => { entered(); return new Promise(resolve => { choose = resolve }) } })
    const document = session.create()
    const closing = session.close({ id: document.id, content: 'saved snapshot', revision: 1 })
    await waiting
    await session.sync({ id: document.id, content: 'later edit', revision: 2 })
    const destination = path.join(directory, 'saved-during-close.md')
    choose(destination)
    expect(await closing).toBe(false)
    expect(await fs.readFile(destination, 'utf8')).toBe('saved snapshot')
    expect(session.records()[0].content).toBe('later edit')
    expect(store.drafts.get(document.id)?.content).toBe('later edit')
  })

  it('restores a newer draft if it changes while close removes the previous draft', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' }), document = session.create()
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const discard = store.discardDraft.bind(store)
    const spy = vi.spyOn(store, 'discardDraft').mockImplementationOnce(async id => { entered(); await gate; await discard(id) })
    const closing = session.close({ id: document.id, content: 'first', revision: 1 })
    await waiting
    await session.sync({ id: document.id, content: 'newer', revision: 2 })
    release()
    expect(await closing).toBe(false)
    expect(store.drafts.get(document.id)?.content).toBe('newer')
    const reloaded = new LocalStore(path.join(directory, 'user')); await reloaded.load()
    expect(reloaded.drafts.get(document.id)?.content).toBe('newer')
    expect(session.records()[0].content).toBe('newer')
    spy.mockRestore()
  })

  it('restores all previously removed drafts if a document changes during window cleanup', async () => {
    const session = makeSession({ confirmClose: async () => 'discard' })
    const first = session.create(), second = session.create()
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const discard = store.discardDraft.bind(store)
    const spy = vi.spyOn(store, 'discardDraft').mockImplementationOnce(async id => { entered(); await gate; await discard(id) })
    const closing = session.canCloseWindow([{ id: first.id, content: 'first', revision: 1 }, { id: second.id, content: 'second', revision: 1 }])
    await waiting
    await session.sync({ id: second.id, content: 'new second', revision: 2 })
    release()
    expect(await closing).toBe(false)
    expect(store.drafts.get(first.id)?.content).toBe('first')
    expect(store.drafts.get(second.id)?.content).toBe('new second')
    const reloaded = new LocalStore(path.join(directory, 'user')); await reloaded.load()
    expect(reloaded.drafts.get(first.id)?.content).toBe('first')
    expect(reloaded.drafts.get(second.id)?.content).toBe('new second')
    expect(session.records()).toHaveLength(2)
    spy.mockRestore()
  })

  it('closing one window does not remove another window’s draft for the same file', async () => {
    const filename = path.join(directory, 'shared.md'); await fs.writeFile(filename, 'original')
    const first = makeSession({ confirmClose: async () => 'discard' }), second = makeSession()
    const a = await first.open(filename, true), b = await second.open(filename, true)
    await second.sync({ id: b.id, content: 'other window draft', revision: 1 })
    expect(await first.close({ id: a.id, content: 'discard only this', revision: 1 })).toBe(true)
    expect(second.records()[0].content).toBe('other window draft')
    expect(store.drafts.get(b.id)?.content).toBe('other window draft')
    expect(await fs.readFile(filename, 'utf8')).toBe('original')
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

  it('requires a save dialog for a removed document even if a replacement has identical bytes', async () => {
    const target = path.join(directory, 'replaced.md')
    await fs.writeFile(target, 'same bytes')
    let prompts = 0
    const session = makeSession({ chooseSave: async () => { prompts++; return null } })
    const document = await session.open(target, true)
    await fs.unlink(target)
    await session.updatePaths(target, null)
    await fs.writeFile(target, 'same bytes')
    expect(await session.save({ id: document.id, content: 'edited copy', revision: 1 })).toBeNull()
    expect(prompts).toBe(1)
    expect(await fs.readFile(target, 'utf8')).toBe('same bytes')
    expect(store.drafts.get(document.id)?.content).toBe('edited copy')
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


describe('Imported content and moved paths', () => {
  it('keeps imported content dirty and recoverable before the first save', async () => {
    const session = makeSession()
    const record = await session.createImported('# Imported\n')
    expect(record.unsaved).toBe(true)
    expect(store.drafts.get(record.id)?.content).toBe(record.content)
    expect(await session.close({ id: record.id, content: record.content, revision: 0 })).toBe(false)
    const saved = await session.save({ id: record.id, content: record.content, revision: 0 })
    expect(saved?.unsaved).toBe(false)
    expect(await fs.readFile(saved!.path!, 'utf8')).toBe(record.content)
    expect(store.drafts.has(record.id)).toBe(false)
  })

  it('does not let a save queued before a move recreate the former path', async () => {
    const source = path.join(directory, 'original.md')
    const destination = path.join(directory, 'moved.md')
    await fs.writeFile(source, 'before')
    const session = makeSession()
    const record = await session.open(source, true)
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const ready = new Promise<void>(resolve => { entered = resolve })
    const move = session.withPathLocks(source, async () => {
      entered!()
      await new Promise<void>(resolve => { release = resolve })
      await fs.rename(source, destination)
      await session.updatePaths(source, destination)
    })
    await ready
    const saving = session.save({ id: record.id, content: 'after', revision: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
    const rejection = expect(saving).rejects.toMatchObject({ code: 'CONFLICT' })
    release!()
    await move
    await rejection
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(destination, 'utf8')).toBe('before')
    expect(store.drafts.get(record.id)?.content).toBe('after')
  })
})
