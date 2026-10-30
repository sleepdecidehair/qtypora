import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashBytes, MAX_DOCUMENT_BYTES } from './files'
import { SystemVersionHistory, type NativeVersionProvider, type VersionDocumentContext } from './system-version-history'

let directory: string, currentPath: string, historyPath: string, context: VersionDocumentContext
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-history-'))
  currentPath = path.join(directory, 'current.md')
  historyPath = path.join(directory, 'version.md')
  await fs.writeFile(currentPath, 'current')
  await fs.writeFile(historyPath, Buffer.from('\ufeffold\r\nline\n', 'utf8'))
  const stat = await fs.stat(currentPath)
  context = { id: 'doc', path: currentPath, version: hashBytes(Buffer.from('current')), revision: 2, content: 'draft', fileMissing: false, identity: { dev: stat.dev, ino: stat.ino } }
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

function fixture(provider?: NativeVersionProvider) {
  const entry = { identifier: 'version-1', modifiedAt: '2026-01-01T00:00:00.000Z', path: historyPath }
  const backend = provider ?? { list: async () => [entry] }
  return { entry, service: new SystemVersionHistory(id => { if (id !== context.id) throw new Error('unknown document'); return context }, backend) }
}

describe('read-only system version history', () => {
  it('returns opaque document-scoped tokens and preserves historical bytes', async () => {
    const { service } = fixture()
    const versions = await service.list('doc')
    expect(versions).toHaveLength(1)
    expect(JSON.stringify(versions)).not.toContain(historyPath)
    expect(await service.read('doc', versions[0].token)).toEqual(Buffer.from('\ufeffold\r\nline\n', 'utf8'))
    await expect(service.read('other', versions[0].token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    service.dispose()
    await expect(service.read('doc', versions[0].token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects changed revision, disk bytes, and replacement with identical bytes', async () => {
    const { service } = fixture()
    let [{ token }] = await service.list('doc')
    context = { ...context, revision: 3, content: 'newer draft' }
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'CONFLICT' })
    ;[{ token }] = await service.list('doc')
    await fs.writeFile(currentPath, 'external change')
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'CONFLICT' })
    await fs.writeFile(currentPath, 'current')
    ;[{ token }] = await service.list('doc')
    const replacement = path.join(directory, 'replacement')
    await fs.writeFile(replacement, 'current')
    await fs.rename(replacement, currentPath)
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects stale entries, symlinks, invalid UTF-8 and oversized historical files', async () => {
    const { entry, service } = fixture({ list: async () => [entry] })
    const [{ token }] = await service.list('doc')
    entry.identifier = 'different'
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'CONFLICT' })
    entry.identifier = 'version-1'
    await fs.writeFile(historyPath, Buffer.from([0xff]))
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await fs.writeFile(historyPath, Buffer.alloc(MAX_DOCUMENT_BYTES + 1))
    await expect(service.read('doc', token)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await fs.unlink(historyPath)
    await fs.symlink(currentPath, historyPath)
    await expect(service.read('doc', token)).rejects.toThrow()
  })

  it('rejects a document change while the provider is enumerating', async () => {
    const { service } = fixture({ list: async () => { context = { ...context, revision: context.revision + 1 }; return [] } })
    await expect(service.list('doc')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses identical-byte replacement even before enumeration begins', async () => {
    const { service } = fixture()
    const replacement = path.join(directory, 'replacement')
    await fs.writeFile(replacement, 'current')
    await fs.rename(replacement, currentPath)
    await expect(service.list('doc')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
