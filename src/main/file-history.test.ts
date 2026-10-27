import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileMoveHistory, type FileMoveHooks } from './file-history'
import { MAX_DOCUMENT_BYTES } from './files'
import { DocumentSession } from './documents'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import { relocateWorkspaceState } from './workspace-relocation'
import { withWorkspaceStructure } from './workspace-lock'
import { randomUUID } from 'node:crypto'

let root: string
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-moves-'))); await fs.mkdir(path.join(root, 'target')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

const createHistory = () => {
  const updatePaths = vi.fn<FileMoveHooks['updatePaths']>(async () => undefined)
  const withDocumentLocks: FileMoveHooks['withDocumentLocks'] = async (_source, operation) => operation()
  return { history: new FileMoveHistory({ updatePaths, withDocumentLocks }), updatePaths }
}

describe('file move history', () => {
  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('moves and undoes a directory while preserving open buffers, orphan drafts and resource tokens', async () => {
    const source = path.join(root, 'source'), destination = path.join(root, 'target', 'source')
    await fs.mkdir(path.join(source, 'nested'), { recursive: true })
    const documentPath = path.join(source, 'nested', 'note.md')
    await fs.writeFile(documentPath, '\ufeff# disk\r\n')
    await fs.writeFile(path.join(source, 'nested', 'image.png'), Buffer.from([137, 80, 78, 71]))
    let symlinkCreated = false
    try { await fs.symlink('note.md', path.join(source, 'nested', 'alias.md')); symlinkCreated = true }
    catch (error) { if (!(process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM')) throw error }
    const store = new LocalStore(path.join(root, 'user'))
    await store.load()
    const createSession = () => new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
    const first = createSession(), second = createSession(), sessions = [first, second]
    const resources = new ResourceRegistry()
    try {
      const a = await first.open(documentPath, true), b = await second.open(documentPath, true)
      await first.sync({ id: a.id, revision: 1, content: '# first dirty' })
      await second.sync({ id: b.id, revision: 1, content: '# second dirty' })
      const orphan = randomUUID()
      await store.writeDraft({ id: orphan, name: 'orphan.md', path: path.join(source, 'nested', 'orphan.md'), content: 'recover me', revision: 1, updatedAt: new Date().toISOString() })
      const token = await resources.resolve('image.png', documentPath, second, 12)
      const history = new FileMoveHistory({
        withDocumentLocks: (locked, operation) => withWorkspaceStructure(() => {
          const lock = (index: number): ReturnType<typeof operation> => index === sessions.length ? operation() : sessions[index].withPathLocks(locked, () => lock(index + 1))
          return lock(0)
        }),
        updatePaths: (from, to) => relocateWorkspaceState(from, to, sessions, store, resources),
      })
      await history.move(root, source, path.join(root, 'target'))
      const movedDocument = path.join(destination, 'nested', 'note.md')
      expect(first.get(a.id).record.path).toBe(movedDocument)
      expect(second.get(b.id).record.path).toBe(movedDocument)
      expect(first.get(a.id).currentContent).toBe('# first dirty')
      expect(second.get(b.id).currentContent).toBe('# second dirty')
      expect(store.drafts.get(a.id)?.path).toBe(movedDocument)
      expect(store.drafts.get(b.id)?.path).toBe(movedDocument)
      expect(store.drafts.get(orphan)?.path).toBe(path.join(destination, 'nested', 'orphan.md'))
      expect(await second.authorize(path.join(destination, 'nested', 'image.png'))).toBe(path.join(destination, 'nested', 'image.png'))
      expect(await resources.toDataUrl(token, 12)).toBe('data:image/png;base64,iVBORw==')
      expect(await fs.readFile(movedDocument, 'utf8')).toBe('\ufeff# disk\r\n')
      if (symlinkCreated) expect(await fs.readlink(path.join(destination, 'nested', 'alias.md'))).toBe('note.md')
      const freshStore = new LocalStore(path.join(root, 'user'))
      await freshStore.load()
      expect(freshStore.drafts.get(orphan)).toMatchObject({ path: path.join(destination, 'nested', 'orphan.md'), content: 'recover me' })
      await history.undo(root)
      expect(first.get(a.id).record.path).toBe(documentPath)
      expect(second.get(b.id).record.path).toBe(documentPath)
      expect(store.drafts.get(orphan)?.path).toBe(path.join(source, 'nested', 'orphan.md'))
      expect(await resources.toDataUrl(token, 12)).toBe('data:image/png;base64,iVBORw==')
      expect(await fs.readFile(documentPath, 'utf8')).toBe('\ufeff# disk\r\n')
    } finally { first.dispose(); second.dispose() }
  })

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('rejects moving a folder into itself, collision and replacement before undo', async () => {
    const { history } = createHistory()
    const source = path.join(root, 'folder'), child = path.join(source, 'child'), target = path.join(root, 'target', 'folder')
    await fs.mkdir(child, { recursive: true })
    await fs.writeFile(path.join(source, 'keep.txt'), 'original')
    await expect(history.move(root, source, child)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'keep.txt'), 'existing')
    await expect(history.move(root, source, path.join(root, 'target'))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('existing')
    await fs.rm(target, { recursive: true })
    await history.move(root, source, path.join(root, 'target'))
    await fs.rename(target, path.join(root, 'elsewhere'))
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'new.txt'), 'replacement')
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(target, 'new.txt'), 'utf8')).toBe('replacement')
    expect(await fs.readFile(path.join(root, 'elsewhere', 'keep.txt'), 'utf8')).toBe('original')
  })

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('updates every window and keeps undo available when a draft write fails after the move', async () => {
    const source = path.join(root, 'source'), destination = path.join(root, 'target', 'source')
    await fs.mkdir(source)
    const documentPath = path.join(source, 'note.md')
    await fs.writeFile(documentPath, 'disk')
    const store = new LocalStore(path.join(root, 'user'))
    await store.load()
    const createSession = () => new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
    const first = createSession(), second = createSession(), sessions = [first, second]
    try {
      const a = await first.open(documentPath, true), b = await second.open(documentPath, true)
      await first.sync({ id: a.id, revision: 1, content: 'first draft' })
      await second.sync({ id: b.id, revision: 1, content: 'second draft' })
      const history = new FileMoveHistory({
        withDocumentLocks: (locked, operation) => withWorkspaceStructure(() => {
          const lock = (index: number): ReturnType<typeof operation> => index === sessions.length ? operation() : sessions[index].withPathLocks(locked, () => lock(index + 1))
          return lock(0)
        }),
        updatePaths: (from, to) => relocateWorkspaceState(from, to, sessions, store, new ResourceRegistry()),
      })
      const write = vi.spyOn(store, 'writeDraft').mockRejectedValueOnce(new Error('disk full'))
      await expect(history.move(root, source, path.join(root, 'target'))).rejects.toMatchObject({ code: 'IO_ERROR', message: expect.stringContaining('文件位置已更新') })
      expect(first.get(a.id)).toMatchObject({ record: { path: path.join(destination, 'note.md') }, currentContent: 'first draft' })
      expect(second.get(b.id)).toMatchObject({ record: { path: path.join(destination, 'note.md') }, currentContent: 'second draft' })
      expect(await fs.readFile(path.join(destination, 'note.md'), 'utf8')).toBe('disk')
      write.mockRestore()
      await history.undo(root)
      expect(first.get(a.id).record.path).toBe(documentPath)
      expect(second.get(b.id).record.path).toBe(documentPath)
      expect(await fs.readFile(documentPath, 'utf8')).toBe('disk')
    } finally { first.dispose(); second.dispose() }
  })

  it('only undoes a newly created directory while it is empty and has the same identity', async () => {
    const { history } = createHistory()
    const created = await history.createDirectory(root, root, 'new-folder')
    await fs.writeFile(path.join(created.path, '.hidden'), 'do not remove')
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(created.path, '.hidden'), 'utf8')).toBe('do not remove')
    await fs.unlink(path.join(created.path, '.hidden'))
    await history.undo(root)
    await expect(fs.lstat(created.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes only its partial new file after write/sync failure, preserving a concurrent replacement', async () => {
    const { history } = createHistory()
    const probe = await fs.open(path.join(root, 'probe'), 'wx')
    const prototype = Object.getPrototypeOf(probe) as fs.FileHandle
    await probe.close()
    vi.spyOn(prototype, 'sync').mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }))
    await expect(history.create(root, root, 'partial.md')).rejects.toMatchObject({ code: 'ENOSPC' })
    await expect(fs.stat(path.join(root, 'partial.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await history.undo(root)).toBeNull()
    vi.restoreAllMocks()
    const destination = path.join(root, 'replacement.md')
    vi.spyOn(prototype, 'sync').mockImplementationOnce(async () => {
      await fs.rename(destination, path.join(root, 'original-inode'))
      await fs.writeFile(destination, 'external replacement')
      throw Object.assign(new Error('Write failed'), { code: 'EIO' })
    })
    await expect(history.create(root, root, 'replacement.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(await fs.readFile(destination, 'utf8')).toBe('external replacement')
    expect(await history.undo(root)).toBeNull()
  })

  it('bounds reads and refuses a source growing during the file snapshot', async () => {
    const { history } = createHistory()
    const source = path.join(root, 'growing.md')
    await fs.writeFile(source, 'small')
    const probe = await fs.open(source, 'r')
    const prototype = Object.getPrototypeOf(probe) as fs.FileHandle
    const read = prototype.read
    await probe.close()
    vi.spyOn(prototype, 'read').mockImplementationOnce(async function (this: fs.FileHandle, ...args) {
      await fs.appendFile(source, Buffer.alloc(MAX_DOCUMENT_BYTES + 1))
      return Reflect.apply(read, this, args)
    })
    await expect(history.duplicate(root, source)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await fs.readdir(root)).filter(name => name.includes('副本'))).toEqual([])
    expect(await history.undo(root)).toBeNull()
  })

  it('keeps an open dirty buffer and a recovery draft when undo removes its newly created disk file', async () => {
    const store = new LocalStore(path.join(root, 'user'))
    await store.load()
    const session = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
    const history = new FileMoveHistory({ withDocumentLocks: (source, operation) => session.withPathLocks(source, operation), updatePaths: (source, destination) => session.updatePaths(source, destination) })
    try {
      const created = await history.create(root, root, 'draft.md')
      const document = await session.open(created.path, true)
      await session.sync({ id: document.id, revision: 1, content: 'unsaved changes survive' })
      await history.undo(root)
      expect(session.records().find(item => item.id === document.id)?.content).toBe('unsaved changes survive')
      expect(store.drafts.get(document.id)?.content).toBe('unsaved changes survive')
      await expect(fs.stat(created.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await session.save({ id: document.id, revision: 1, content: 'unsaved changes survive' })).toBeNull()
      expect(store.drafts.get(document.id)?.content).toBe('unsaved changes survive')
    } finally { session.dispose() }
  })
  it('renames ordinary files exclusively and reverses the rename without changing bytes', async () => {
    const { history, updatePaths } = createHistory()
    const source = path.join(root, 'original.md'), destination = path.join(root, 'renamed.md')
    await fs.writeFile(source, '\ufeff# Source\r\n')
    await history.rename(root, source, 'renamed.md')
    expect(await fs.readFile(destination, 'utf8')).toBe('\ufeff# Source\r\n')
    await history.undo(root)
    expect(await fs.readFile(source, 'utf8')).toBe('\ufeff# Source\r\n')
    expect(updatePaths.mock.calls).toEqual([[source, destination], [destination, source]])
  })

  it('undoes creation and duplicate in order, preserving the original and notifying open buffers', async () => {
    const { history, updatePaths } = createHistory()
    const created = await history.create(root, root, 'created.md')
    await fs.writeFile(path.join(root, 'original.md'), '\ufeff# Original\r\n')
    const duplicate = await history.duplicate(root, path.join(root, 'original.md'))
    expect(await fs.readFile(duplicate.path, 'utf8')).toBe('\ufeff# Original\r\n')
    expect(await history.undo(root)).toMatchObject({ path: root, kind: 'directory' })
    await expect(fs.stat(duplicate.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await history.undo(root)
    await expect(fs.stat(created.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(root, 'original.md'), 'utf8')).toBe('\ufeff# Original\r\n')
    expect(updatePaths.mock.calls).toEqual([[duplicate.path, null], [created.path, null]])
    expect(await history.undo(root)).toBeNull()
  })

  it('refuses undoing creation after same-inode edits or replacement and never deletes unrelated files', async () => {
    const { history } = createHistory()
    const created = await history.create(root, root, 'created.md')
    await fs.writeFile(created.path, 'user saved content')
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(created.path, 'utf8')).toBe('user saved content')
    await fs.writeFile(path.join(root, 'replacement.md'), '')
    await fs.rename(path.join(root, 'replacement.md'), created.path)
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(created.path, 'utf8')).toBe('')
  })

  it('does not create or duplicate outside the workspace, overwrite names, or duplicate symbolic links', async () => {
    const { history } = createHistory()
    await expect(history.create(root, os.tmpdir(), 'outside.md')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await history.create(root, root, 'existing.md')
    await expect(history.create(root, root, 'existing.md')).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(history.create(root, root, 'run.js')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await fs.symlink(path.join(root, 'existing.md'), path.join(root, 'link.md'))
    await expect(history.duplicate(root, path.join(root, 'link.md'))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(await history.undo(root)).toMatchObject({ path: root })
    expect(await history.undo(root)).toBeNull()
  })
  it('preserves bytes and reverses a move while updating document paths within the lock', async () => {
    const source = path.join(root, 'notes.md'), destination = path.join(root, 'target', 'notes.md')
    const bytes = Buffer.from('\ufeff# Notes\r\nline\n')
    await fs.writeFile(source, bytes)
    let locked = false
    const updatePaths = vi.fn(async () => { expect(locked).toBe(true) })
    const history = new FileMoveHistory({ updatePaths, withDocumentLocks: async (_source, operation) => { locked = true; try { return await operation() } finally { locked = false } } })
    expect(await history.move(root, source, path.dirname(destination))).toMatchObject({ path: destination })
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(destination)).toEqual(bytes)
    expect(await history.undo(root)).toMatchObject({ path: source })
    expect(await fs.readFile(source)).toEqual(bytes)
    expect(updatePaths.mock.calls).toEqual([[source, destination], [destination, source]])
    expect(await history.undo(root)).toBeNull()
  })

  it('never overwrites an existing destination or recreated original during undo', async () => {
    const { history, updatePaths } = createHistory()
    const source = path.join(root, 'notes.md'), destination = path.join(root, 'target', 'notes.md')
    await fs.writeFile(source, 'original')
    await fs.writeFile(destination, 'occupied')
    await expect(history.move(root, source, path.dirname(destination))).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(source, 'utf8')).toBe('original')
    expect(await fs.readFile(destination, 'utf8')).toBe('occupied')
    expect(updatePaths).not.toHaveBeenCalled()
    await fs.unlink(destination)
    await history.move(root, source, path.dirname(destination))
    await fs.writeFile(source, 'new original')
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(source, 'utf8')).toBe('new original')
    expect(await fs.readFile(destination, 'utf8')).toBe('original')
    await fs.unlink(source)
    await history.undo(root)
    expect(await fs.readFile(source, 'utf8')).toBe('original')
  })

  it('rejects outside paths, workspace root and symbolic links without changing their targets', async () => {
    const { history } = createHistory()
    const source = path.join(root, 'notes.md')
    await fs.writeFile(source, 'original')
    await expect(history.move(root, source, os.tmpdir())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(history.move(root, root, path.join(root, 'target'))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const link = path.join(root, 'alias.md')
    try { await fs.symlink(source, link) }
    catch (error) { if (process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') return; throw error }
    await expect(history.move(root, link, path.join(root, 'target'))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(await fs.readFile(source, 'utf8')).toBe('original')
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
  })

  it('retains history on a failed undo and refuses a different file replacing the moved path', async () => {
    const { history } = createHistory()
    const source = path.join(root, 'notes.md'), destination = path.join(root, 'target', 'notes.md')
    await fs.writeFile(source, 'original')
    await history.move(root, source, path.dirname(destination))
    await expect(history.undo(path.join(root, 'target'))).rejects.toMatchObject({ code: 'CONFLICT' })
    const replacement = path.join(root, 'replacement.md')
    await fs.writeFile(replacement, 'replacement')
    await fs.rename(replacement, destination)
    await expect(history.undo(root)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(destination, 'utf8')).toBe('replacement')
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
