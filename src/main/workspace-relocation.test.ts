import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentSession } from './documents'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import { assertDestinationUnoccupied, assertSourcePathsUnambiguous, relocateWorkspaceState } from './workspace-relocation'

let root: string
let store: LocalStore
let session: DocumentSession
const resources = new ResourceRegistry()
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-relocation-')))
  store = new LocalStore(path.join(root, 'user'))
  await store.load()
  session = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
})
afterEach(async () => { session.dispose(); await fs.rm(root, { recursive: true, force: true }) })

describe('workspace relocation safety', () => {
  it('does not remap a different case-sensitive sibling document or draft', async () => {
    const upper = path.join(root, 'Foo'), lower = path.join(root, 'foo'), destination = path.join(root, 'target', 'Foo')
    const first = session.create(), second = session.create()
    session.get(first.id).record.path = path.join(upper, 'note.md')
    session.get(second.id).record.path = path.join(lower, 'note.md')
    await store.writeDraft({ id: second.id, name: 'note.md', path: path.join(lower, 'note.md'), content: 'lower draft', revision: 1, updatedAt: new Date().toISOString() })
    await relocateWorkspaceState(upper, destination, [session], store, resources)
    expect(session.get(first.id).record.path).toBe(path.join(destination, 'note.md'))
    expect(session.get(second.id).record.path).toBe(path.join(lower, 'note.md'))
    expect(store.drafts.get(second.id)?.path).toBe(path.join(lower, 'note.md'))
  })

  it('rejects a destination occupied by a missing open document and by a recovery draft', async () => {
    const destination = path.join(root, 'target', 'folder')
    const record = session.create()
    session.get(record.id).record.path = path.join(destination, 'note.md')
    expect(() => assertDestinationUnoccupied(destination, [session], store, resources)).toThrowError(/目标路径被打开的文档/)
    session.get(record.id).record.path = null
    await store.writeDraft({ id: record.id, name: 'note.md', path: path.join(destination, 'note.md'), content: 'recovery', revision: 1, updatedAt: new Date().toISOString() })
    expect(() => assertDestinationUnoccupied(destination, [session], store, resources)).toThrowError(/恢复草稿/)
    expect(() => assertDestinationUnoccupied(destination.toUpperCase(), [session], store, resources)).toThrowError(/恢复草稿/)
  })

  it('rejects unresolved case aliases instead of guessing whether they belong to the source', async () => {
    const source = path.join(root, 'Foo')
    const record = session.create()
    session.get(record.id).record.path = path.join(root, 'foo', 'missing.md')
    await expect(assertSourcePathsUnambiguous(source, [session], store, resources)).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
