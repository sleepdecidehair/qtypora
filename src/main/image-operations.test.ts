import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRecord, ImageOperationRequest } from '../shared/contracts'
import { DocumentSession } from './documents'
import { canonicalPath } from './files'
import { type ImageDialogs, operateImage, validateImageOperation } from './image-operations'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'

let directory: string
let documents: DocumentSession
let registry: ResourceRegistry
let record: DocumentRecord
let source: string
let dialogs: ImageDialogs
const picture = Buffer.from([137, 80, 78, 71])
function request(action: ImageOperationRequest['action'], extra: Partial<ImageOperationRequest> = {}): ImageOperationRequest {
  return { id: record.id, content: record.content, revision: 0, source: 'picture.png', action, ...extra }
}
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-image-actions-')))
  const store = new LocalStore(path.join(directory, 'user'))
  await store.load()
  documents = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'discard' }, () => undefined)
  await fs.writeFile(path.join(directory, 'note.md'), '![图片](picture.png)')
  source = path.join(directory, 'picture.png')
  await fs.writeFile(source, picture)
  record = await documents.open(path.join(directory, 'note.md'), true)
  registry = new ResourceRegistry()
  dialogs = { destination: async () => path.join(directory, 'new picture.png'), confirm: async () => true, trash: async (file) => fs.unlink(file) }
})
afterEach(async () => { documents.dispose(); await fs.rm(directory, { recursive: true, force: true }) })

describe('Authorized image operations', () => {
  it('copies bytes and returns an encoded new source without touching the original or document', async () => {
    expect(await operateImage(request('copy'), documents, registry, 1, dialogs)).toEqual({ source: 'new%20picture.png' })
    expect(await fs.readFile(source)).toEqual(picture)
    expect(await fs.readFile(path.join(directory, 'new picture.png'))).toEqual(picture)
    expect(documents.get(record.id).currentContent).toBe(record.content)
  })

  it('moves with native confirmation, updates source and invalidates the old resource token', async () => {
    const token = await registry.resolve('picture.png', record.path, documents, 1)
    const confirm = vi.fn(dialogs.confirm)
    expect(await operateImage(request('move'), documents, registry, 1, { ...dialogs, confirm })).toEqual({ source: 'new%20picture.png' })
    expect(confirm).toHaveBeenCalledWith(source, 'move', path.join(directory, 'new picture.png'))
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(registry.toDataUrl(token, 1)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('distinguishes successful delete from cancel and keeps originals on every canceled dialog', async () => {
    expect(await operateImage(request('delete'), documents, registry, 1, { ...dialogs, confirm: async () => false })).toBeNull()
    expect(await fs.readFile(source)).toEqual(picture)
    expect(await operateImage(request('move'), documents, registry, 1, { ...dialogs, destination: async () => null })).toBeNull()
    expect(await operateImage(request('delete'), documents, registry, 1, dialogs)).toEqual({ source: null })
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('save-as copies original bytes and keeps the original reference, while existing targets are never overwritten', async () => {
    expect(await operateImage(request('save-as'), documents, registry, 1, dialogs)).toEqual({ source: 'picture.png' })
    await fs.writeFile(path.join(directory, 'new picture.png'), 'other-owner')
    await expect(operateImage(request('copy'), documents, registry, 1, dialogs)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(path.join(directory, 'new picture.png'), 'utf8')).toBe('other-owner')
    expect(await fs.readFile(source)).toEqual(picture)
  })

  it('accepts the latest snapshot before checking a just-inserted actual reference', async () => {
    await fs.writeFile(path.join(directory, 'second.png'), picture)
    const content = record.content + '\n![新图](second.png)'
    expect(await operateImage(request('copy', { content, revision: 1, source: 'second.png' }), documents, registry, 1, dialogs)).toEqual({ source: 'new%20picture.png' })
    expect(documents.get(record.id).currentContent).toBe(content)
  })

  it('rejects unrelated local files, remote images, other-window tokens and malformed snapshots', async () => {
    await fs.writeFile(path.join(directory, 'unreferenced.png'), picture)
    await expect(operateImage(request('delete', { source: 'unreferenced.png' }), documents, registry, 1, dialogs)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(operateImage(request('delete', { source: 'https://example.com/p.png' }), documents, registry, 1, dialogs)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const token = await registry.resolve('picture.png', record.path, documents, 2)
    await expect(operateImage(request('delete', { source: token }), documents, registry, 1, dialogs)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(() => validateImageOperation({ id: record.id, source: 'picture.png', action: 'delete' })).toThrow()
  })

  it('rejects a changed or closed document after the native dialog before modifying originals', async () => {
    await expect(operateImage(request('move'), documents, registry, 1, { ...dialogs, confirm: async () => {
      await documents.sync({ id: record.id, content: record.content + '\nnew edit', revision: 1 })
      return true
    } })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(source)).toEqual(picture)
    await expect(fs.access(path.join(directory, 'new picture.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    const current = documents.get(record.id)
    await expect(operateImage(request('delete', { content: current.currentContent, revision: 1 }), documents, registry, 1, { ...dialogs, confirm: async () => {
      await documents.close({ id: record.id, content: current.currentContent, revision: 1 })
      return true
    } })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(source)).toEqual(picture)
  })

  it('preserves an externally modified source while a destructive confirmation is open', async () => {
    await expect(operateImage(request('delete'), documents, registry, 1, { ...dialogs, confirm: async () => {
      await fs.writeFile(source, 'external update')
      return true
    } })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(source, 'utf8')).toBe('external update')
  })
})
