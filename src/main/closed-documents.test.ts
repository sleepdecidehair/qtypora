import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession, type DocumentDialogs } from './documents'
import { canonicalPath, readClosedMarkdown } from './files'
import { LocalStore } from './preferences'

let directory: string
let store: LocalStore
const sessions: DocumentSession[] = []
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-reopen-test-')))
  store = new LocalStore(path.join(directory, 'user'))
  await store.load()
})
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose()
  await fs.rm(directory, { recursive: true, force: true })
})
function session(dialogs: Partial<DocumentDialogs> = {}): DocumentSession {
  const value = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel', ...dialogs }, () => undefined)
  sessions.push(value)
  return value
}

describe('reopen closed files', () => {
  it('reopens the latest successfully closed file and preserves BOM and CRLF', async () => {
    const file = path.join(directory, 'one.md')
    const raw = Buffer.from('\ufefffirst\r\nsecond\r\n', 'utf8')
    await fs.writeFile(file, raw)
    const docs = session(), record = await docs.open(file, true)
    expect(await docs.close({ id: record.id, content: record.content, revision: 0 })).toBe(true)
    const reopened = await docs.reopenClosed()
    expect(reopened).toMatchObject({ path: file, encoding: 'utf8-bom', lineEnding: 'CRLF', content: 'first\nsecond\n' })
    expect(await fs.readFile(file)).toEqual(raw)
    expect(await docs.reopenClosed()).toBeNull()
  })
  it('leaves cancelled and untitled closes out of the stack and scopes it to the window', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const docs = session(), other = session(), record = await docs.open(file, true)
    expect(await docs.close({ id: record.id, content: 'unsaved', revision: 1 })).toBe(false)
    expect(await docs.reopenClosed()).toBeNull()
    expect(await other.reopenClosed()).toBeNull()
    const untitled = docs.create()
    expect(await docs.close({ id: untitled.id, content: untitled.content, revision: 0 })).toBe(true)
    expect(await docs.reopenClosed()).toBeNull()
    expect(store.drafts.get(record.id)?.content).toBe('unsaved')
  })
  it('reopens the saved disk version after explicit discard, without restoring discarded draft', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const docs = session({ confirmClose: async () => 'discard' }), record = await docs.open(file, true)
    expect(await docs.close({ id: record.id, content: 'discarded', revision: 1 })).toBe(true)
    expect(store.drafts.has(record.id)).toBe(false)
    expect((await docs.reopenClosed())?.content).toBe('disk')
  })
  it('reopens the successfully saved close rather than the prior disk content', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'old')
    const docs = session({ confirmClose: async () => 'save' }), record = await docs.open(file, true)
    expect(await docs.close({ id: record.id, content: 'saved edit', revision: 1 })).toBe(true)
    expect((await docs.reopenClosed())?.content).toBe('saved edit')
    expect(await fs.readFile(file, 'utf8')).toBe('saved edit')
  })
  it('accepts a normal atomic replacement at the authorized path', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'old')
    const docs = session(), record = await docs.open(file, true)
    await docs.close({ id: record.id, content: record.content, revision: 0 })
    const replacement = path.join(directory, 'replacement.tmp'); await fs.writeFile(replacement, 'updated')
    await fs.rename(replacement, file)
    expect((await docs.reopenClosed())?.content).toBe('updated')
  })
  it('detects an in-place rewrite even when size and mtime are restored', async () => {
    const file = path.join(directory, 'one.md')
    await fs.writeFile(file, 'original')
    const time = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(file, time, time)
    const probe = await fs.open(file, 'r')
    const prototype = Object.getPrototypeOf(probe) as { read: typeof probe.read }
    const originalRead = prototype.read
    let rewritten = false
    prototype.read = (async function (this: typeof probe, buffer: Buffer, offset: number, length: number, position: number) {
      const read = originalRead as unknown as (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number, buffer: Buffer }>
      const result = await read.call(this, buffer, offset, length, position)
      if (!rewritten) {
        rewritten = true
        await fs.writeFile(file, 'modified')
        await fs.utimes(file, time, time)
      }
      return result
    }) as typeof probe.read
    try { await expect(readClosedMarkdown(file)).rejects.toMatchObject({ code: 'CONFLICT' }) }
    finally { prototype.read = originalRead; await probe.close() }
  })
  it('retains the closed entry if the file changes before watching starts', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'old')
    const docs = session(), record = await docs.open(file, true)
    await docs.close({ id: record.id, content: record.content, revision: 0 })
    let release!: () => void, entered!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const spy = vi.spyOn(store, 'addRecent').mockImplementationOnce(async () => { entered(); await pending })
    const reopen = docs.reopenClosed()
    await started
    const replacement = path.join(directory, 'replacement.tmp')
    await fs.writeFile(replacement, 'updated')
    await fs.rename(replacement, file)
    release()
    await expect(reopen).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(docs.records()).toHaveLength(0)
    spy.mockRestore()
    expect((await docs.reopenClosed())?.content).toBe('updated')
  })
  it('refuses a symlink and retains history for a later successful retry', async () => {
    const file = path.join(directory, 'one.md'), target = path.join(directory, 'target.md')
    await fs.writeFile(file, 'safe'); await fs.writeFile(target, 'other')
    const docs = session(), record = await docs.open(file, true)
    await docs.close({ id: record.id, content: record.content, revision: 0 })
    await fs.unlink(file); await fs.symlink(target, file)
    await expect(docs.reopenClosed()).rejects.toMatchObject({ code: 'CONFLICT' })
    await fs.unlink(file); await fs.writeFile(file, 'safe again')
    expect((await docs.reopenClosed())?.content).toBe('safe again')
  })
  it('returns an already-open document without replacing its dirty content', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const docs = session(), record = await docs.open(file, true)
    await docs.close({ id: record.id, content: record.content, revision: 0 })
    const open = await docs.open(file, true)
    await docs.sync({ id: open.id, content: 'unsaved', revision: 1 })
    expect(await docs.reopenClosed()).toMatchObject({ id: open.id, content: 'unsaved' })
  })
  it('does not recreate a session after the window is disposed during a reopen', async () => {
    const file = path.join(directory, 'one.md'); await fs.writeFile(file, 'disk')
    const docs = session(), record = await docs.open(file, true)
    await docs.close({ id: record.id, content: record.content, revision: 0 })
    let release!: () => void, entered!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(store, 'addRecent').mockImplementation(async () => { entered(); await pending })
    const reopen = docs.reopenClosed()
    await started
    docs.dispose()
    release()
    await expect(reopen).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(docs.records()).toHaveLength(0)
  })
  it('does not consume a newer close while reopening an older entry', async () => {
    const first = path.join(directory, 'first.md'), second = path.join(directory, 'second.md')
    await fs.writeFile(first, 'one'); await fs.writeFile(second, 'two')
    const docs = session(), a = await docs.open(first, true), b = await docs.open(second, true)
    await docs.close({ id: a.id, content: a.content, revision: 0 })
    let release!: () => void, entered!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const addRecent = vi.spyOn(store, 'addRecent').mockImplementationOnce(async () => { entered(); await pending })
    const reopen = docs.reopenClosed()
    await started
    await docs.close({ id: b.id, content: b.content, revision: 0 })
    release()
    expect((await reopen)?.content).toBe('one')
    addRecent.mockRestore()
    expect((await docs.reopenClosed())?.content).toBe('two')
  })

})
