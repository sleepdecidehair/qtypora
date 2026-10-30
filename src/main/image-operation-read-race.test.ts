import { it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'

let victim = '', outside = '', armed = false
vi.mock('node:fs/promises', async load => {
  const actual = await load<typeof import('node:fs/promises')>()
  return { ...actual, open: async (filename: string, flags: string | number, mode?: number) => {
    if (armed && filename === victim && typeof flags === 'number' && (flags & constants.O_NOFOLLOW)) {
      armed = false
      await actual.unlink(victim)
      await actual.symlink(outside, victim)
      try { return await actual.open(filename, flags, mode) }
      finally { await actual.unlink(victim); await actual.writeFile(victim, 'image') }
    }
    return actual.open(filename, flags, mode)
  } }
})
import { DocumentSession } from './documents'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import { operateImage } from './image-operations'

it.skipIf(!constants.O_NOFOLLOW)('refuses a symlink substituted after authorization before opening an image', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-image-race-')))
  const folder = path.join(root, 'allowed'); await fs.mkdir(folder)
  const document = path.join(folder, 'note.md'); victim = path.join(folder, 'pic.png'); outside = path.join(root, 'outside.txt')
  await fs.writeFile(document, '![x](pic.png)'); await fs.writeFile(victim, 'image'); await fs.writeFile(outside, 'outside')
  const store = new LocalStore(path.join(root, 'user')); await store.load()
  const session = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => {})
  try {
    const record = await session.open(document, true)
    const registry = new ResourceRegistry(), localPath = registry.localPath.bind(registry)
    let calls = 0
    registry.localPath = async (...args) => { const result = await localPath(...args); if (++calls === 2) armed = true; return result }
    const destination = path.join(folder, 'copy.png')
    await expect(operateImage({ id: record.id, content: record.content, revision: 0, source: 'pic.png', action: 'copy' }, session, registry, 1, { destination: async () => destination, confirm: async () => true, trash: async () => {} })).rejects.toThrow()
    expect(armed).toBe(false)
    await expect(fs.access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { armed = false; session.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})
