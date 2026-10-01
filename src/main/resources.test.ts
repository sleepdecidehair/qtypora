import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentSession } from './documents'
import { canonicalPath } from './files'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'

let directory: string
let session: DocumentSession
let documentPath: string
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-resources-')))
  const store = new LocalStore(path.join(directory, 'user'))
  await store.load()
  session = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'cancel' }, () => undefined)
  documentPath = path.join(directory, 'note.md')
  await fs.writeFile(documentPath, '# 图片')
  await session.open(documentPath, true)
  await fs.writeFile(path.join(directory, 'picture.png'), Buffer.from([137, 80, 78, 71]))
})
afterEach(async () => { session.dispose(); await fs.rm(directory, { recursive: true, force: true }) })

describe('Local resource privileges', () => {
  it('serves only authorized picture tokens and can inline the same bytes for export', async () => {
    const registry = new ResourceRegistry()
    const token = await registry.resolve('picture.png', documentPath, session, 11)
    expect(token).toMatch(/^qtypora-media:\/\/resource\/[a-f0-9-]+$/)
    expect(await registry.toDataUrl(token, 11)).toBe('data:image/png;base64,iVBORw==')
    await expect(registry.toDataUrl(token, 12)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    registry.dispose(11)
    await expect(registry.toDataUrl(token, 11)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('rejects scripts, non-picture local resources, and unrelated document paths', async () => {
    const registry = new ResourceRegistry()
    await expect(registry.resolve('javascript:alert(1)', documentPath, session, 11)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(registry.resolve('note.md', documentPath, session, 11)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(registry.resolve('picture.png', path.join(directory, 'unowned.md'), session, 11)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(registry.resolve('https://user:secret@example.com/a.png', documentPath, session, 11)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('restricts the protocol to registered tokens and releases them after window close', async () => {
    const registry = new ResourceRegistry()
    const token = await registry.resolve('picture.png', documentPath, session, 11)
    let serve: ((request: Request) => Response | Promise<Response>) | undefined
    registry.register({ handle: (_scheme, handler) => { serve = handler } })
    if (!serve) throw new Error('Protocol handler missing')
    const response = await serve(new Request(token))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect((await serve(new Request('qtypora-media://resource/not-a-token'))).status).toBe(404)
    registry.dispose(11)
    expect((await serve(new Request(token))).status).toBe(404)
  })
})
