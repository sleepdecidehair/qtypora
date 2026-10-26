import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession } from './documents'
import { openLinkedFile, type LinkedFileHooks } from './linked-files'
import { LocalStore } from './preferences'

let directory: string
let workspace: string
let documents: DocumentSession
let id: string
let hooks: LinkedFileHooks

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-links-')))
  workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const store = new LocalStore(path.join(directory, 'user'))
  await store.load()
  documents = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'discard' }, () => undefined)
  const source = path.join(workspace, 'source.md')
  await fs.writeFile(source, '# Source')
  id = (await documents.open(source, true)).id
  hooks = { confirmCreate: vi.fn(async () => true), openPath: vi.fn(async () => '') }
})
afterEach(async () => { documents.dispose(); await fs.rm(directory, { recursive: true, force: true }) })

describe('authorized document links', () => {
  it('resolves encoded relative files and fragments without replacing the existing dirty document', async () => {
    const target = path.join(workspace, 'other note.md')
    await fs.writeFile(target, '# Disk')
    const opened = await documents.open(target)
    await documents.sync({ id: opened.id, revision: 1, content: '# Unsaved' })
    const result = await openLinkedFile({ id, target: 'other%20note.md#unsaved' }, documents, hooks)
    expect(result).toMatchObject({ document: { id: opened.id, content: '# Unsaved' }, fragment: 'unsaved' })
    expect(await fs.readFile(target, 'utf8')).toBe('# Disk')
    expect(hooks.confirmCreate).not.toHaveBeenCalled()
    expect(hooks.openPath).not.toHaveBeenCalled()
  })

  it('opens authorized ordinary file URLs through the operating system', async () => {
    const target = path.join(workspace, 'paper.pdf')
    await fs.writeFile(target, '%PDF-fixture')
    expect(await openLinkedFile({ id, target: pathToFileURL(target).href + '#page=2' }, documents, hooks)).toEqual({ document: null, fragment: null })
    expect(hooks.openPath).toHaveBeenCalledWith(target)
    hooks.openPath = async () => 'No application'
    await expect(openLinkedFile({ id, target }, documents, hooks)).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('rejects unapproved paths, executable extensions, protocols and disguised symbolic links', async () => {
    const outside = path.join(directory, 'outside.pdf')
    await fs.writeFile(outside, '%PDF-outside')
    await expect(openLinkedFile({ id, target: outside }, documents, hooks)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    for (const target of ['run.exe', 'run.js', 'shortcut.url', 'launch.command', 'macro.docm', 'page.html', 'javascript:alert(1)', 'https://example.com/a.pdf']) {
      await expect(openLinkedFile({ id, target }, documents, hooks)).rejects.toBeDefined()
    }
    await fs.writeFile(path.join(workspace, 'run.js'), 'unsafe')
    await fs.symlink(path.join(workspace, 'run.js'), path.join(workspace, 'disguise.pdf'))
    await expect(openLinkedFile({ id, target: 'disguise.pdf' }, documents, hooks)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(hooks.openPath).not.toHaveBeenCalled()
  })

  it('creates an empty missing Markdown only after confirmation and never overwrites a competing file', async () => {
    const target = path.join(workspace, 'created.md')
    hooks.confirmCreate = vi.fn(async () => false)
    expect(await openLinkedFile({ id, target: 'created.md#heading' }, documents, hooks)).toBeNull()
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    hooks.confirmCreate = vi.fn(async () => true)
    const created = await openLinkedFile({ id, target: 'created.md#heading' }, documents, hooks)
    expect(created).toMatchObject({ document: { path: target, content: '' }, fragment: 'heading' })
    expect(await fs.readFile(target, 'utf8')).toBe('')
    hooks.confirmCreate = async file => { await fs.writeFile(file, 'competing writer'); return true }
    await expect(openLinkedFile({ id, target: 'race.md' }, documents, hooks)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(path.join(workspace, 'race.md'), 'utf8')).toBe('competing writer')
  })

  it('does not create outside an authorized folder or after the source document closes', async () => {
    await expect(openLinkedFile({ id, target: '../outside.md' }, documents, hooks)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(hooks.confirmCreate).not.toHaveBeenCalled()
    hooks.confirmCreate = async () => {
      await documents.close({ id, revision: 0, content: '# Source' })
      return true
    }
    await expect(openLinkedFile({ id, target: 'closed.md' }, documents, hooks)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(fs.stat(path.join(workspace, 'closed.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
