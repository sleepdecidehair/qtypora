import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRecord } from '../shared/contracts'
import { DEFAULT_IMAGE_OPTIONS, normalizeImageOptions } from '../shared/image-options'
import { DocumentSession } from './documents'
import { canonicalPath } from './files'
import { importImageFiles, importImages, organizeImages, validateImageImport } from './image-import'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import { readImageFile } from './image-bytes'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
let directory: string
let documents: DocumentSession
let record: DocumentRecord
const snapshot = () => ({ id: record.id, content: record.content, revision: 0 })
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-image-import-')))
  const store = new LocalStore(path.join(directory, 'user'))
  await store.load()
  documents = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'discard' }, () => undefined)
  await fs.writeFile(path.join(directory, 'note.md'), '# image\n')
  record = await documents.open(path.join(directory, 'note.md'), true)
})
afterEach(async () => { documents.dispose(); await fs.rm(directory, { recursive: true, force: true }) })

describe('image receiving and resource policy', () => {
  it('bounds disk reads by the opened file size and refuses oversized local files', async () => {
    const filename = path.join(directory, 'bounded.png')
    await fs.writeFile(filename, png)
    expect(await readImageFile(filename)).toEqual(png)
    await fs.truncate(filename, 16 * 1024 * 1024 + 1)
    await expect(readImageFile(filename)).rejects.toThrow('16 MB')
  })
  it('uses YAML copy directory with filename substitution and rejects unauthorized destinations', async () => {
    const content = '---\ntypora-copy-images-to: media/${filename}\n---\n\n# Image'
    const result = await importImages({ id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }] }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.paths).toEqual([path.join(directory, 'media/note/x.png')])
    expect(result?.markdown).toBe('![x](media/note/x.png)')
    const unsafe = '---\ntypora-copy-images-to: ../not-authorized\n---\n'
    await expect(importImages({ id: record.id, content: unsafe, revision: 2, images: [{ name: 'x.png', bytes: png }] }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('organizes actual local images by copying, preserves originals and is idempotent', async () => {
    await fs.writeFile(path.join(directory, 'original.png'), png)
    const content = '![first](original.png) ![same](./original.png)'
    const request = { id: record.id, content, revision: 1, sources: ['original.png', './original.png'] }
    const result = await organizeImages(request, documents, new ResourceRegistry(), 1, { ...DEFAULT_IMAGE_OPTIONS, uploadOnInsert: true }, async () => null)
    expect(result).toEqual({ replacements: [{ source: 'original.png', url: 'assets/original.png' }, { source: './original.png', url: 'assets/original.png' }] })
    expect(await fs.readFile(path.join(directory, 'original.png'))).toEqual(png)
    expect(await fs.readFile(path.join(directory, 'assets/original.png'))).toEqual(png)
    const next = { id: record.id, content: '![first](assets/original.png)', revision: 2, sources: ['assets/original.png'] }
    expect(await organizeImages(next, documents, new ResourceRegistry(), 1, DEFAULT_IMAGE_OPTIONS, async () => null)).toEqual({ replacements: [{ source: 'assets/original.png', url: 'assets/original.png' }] })
    expect(await fs.readdir(path.join(directory, 'assets'))).toEqual(['original.png'])
  })
  it('extracts only actual safe embedded image references and preserves the original bytes', async () => {
    const source = `data:image/png;base64,${png.toString('base64')}`
    const content = `![embedded](${source})`
    const result = await organizeImages({ id: record.id, revision: 1, content, sources: [source] }, documents, new ResourceRegistry(), 1, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result).toEqual({ replacements: [{ source, url: 'assets/embedded-image-1.png' }] })
    expect(await fs.readFile(path.join(directory, 'assets/embedded-image-1.png'))).toEqual(png)
    await expect(organizeImages({ id: record.id, revision: 1, content, sources: ['data:text/html;base64,YQ=='] }, documents, new ResourceRegistry(), 1, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('内嵌图片')
    expect(documents.get(record.id).currentContent).toBe(content)
  })
  it('imports multiple images without overwriting and returns escaped references in source order', async () => {
    const request = { ...snapshot(), images: [{ name: '一 张.png', bytes: png }, { name: '一 张.png', bytes: png }] }
    const result = await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.paths).toHaveLength(2)
    expect(result?.paths[0]).not.toBe(result?.paths[1])
    expect(result?.markdown).toContain('assets/%E4%B8%80%20%E5%BC%A0.png')
    for (const filename of result!.paths) expect(await fs.readFile(filename)).toEqual(png)
    expect(documents.get(record.id).currentContent).toBe(record.content)
  })

  it('uses configured descendants and absolute paths when requested', async () => {
    const result = await importImages({ ...snapshot(), images: [{ name: 'x.png', bytes: png }] }, documents, { ...DEFAULT_IMAGE_OPTIONS, directory: 'media/images', useRelativePath: false }, async () => null)
    expect(result?.paths[0]).toBe(path.join(directory, 'media/images/x.png'))
    expect(result?.markdown).toMatch(/\]\(file:\/\//)
    expect(normalizeImageOptions(undefined)).toEqual(DEFAULT_IMAGE_OPTIONS)
    for (const input of [null, 'assets', [], { directory: '../outside' }, { directory: 'a//b' }, { directory: '/tmp' }, { directory: 'a\\..\\b' }, { smartPaste: 'true' }]) expect(() => normalizeImageOptions(input)).toThrow()
  })

  it('chooses a directory for an unsaved document and distinguishes cancellation', async () => {
    record = documents.create('draft')
    const cancel = vi.fn(async () => null)
    const request = { ...snapshot(), images: [{ name: 'draft.png', bytes: png }] }
    expect(await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, cancel)).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
    expect(await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => directory)).toMatchObject({ paths: [path.join(directory, 'draft.png')] })
  })

  it('rejects stale/readonly/closed snapshots before writing image data', async () => {
    const request = { ...snapshot(), images: [{ name: 'x.png', bytes: png }] }
    await documents.sync({ ...snapshot(), revision: 1, content: 'changed' })
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toMatchObject({ code: 'CONFLICT' })
    record = documents.create('draft')
    await expect(importImages({ ...snapshot(), images: request.images }, documents, DEFAULT_IMAGE_OPTIONS, async () => {
      await documents.sync({ ...snapshot(), revision: 1, content: 'new edit' }); return directory
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readdir(directory)).not.toContain('x.png')
    documents.get(record.id).record.readOnly = true
    await expect(importImages({ id: record.id, revision: 1, content: 'new edit', images: request.images }, documents, DEFAULT_IMAGE_OPTIONS, async () => directory)).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('rejects executable SVG, mismatched image bytes, excessive batches and path traversal', () => {
    expect(() => validateImageImport({ ...snapshot(), images: [{ name: 'x.png', bytes: Buffer.from('not png') }] })).toThrow()
    expect(() => validateImageImport({ ...snapshot(), images: [{ name: 'x.svg', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }] })).toThrow()
    expect(() => validateImageImport({ ...snapshot(), images: Array(21).fill({ name: 'x.png', bytes: png }) })).toThrow()
    expect(() => validateImageImport({ ...snapshot(), images: [{ name: 'x.png', bytes: Array.from(png) }] })).toThrow()
  })

  it('rejects a symlink in the destination and only reads native-chooser paths', async () => {
    const external = path.join(directory, 'external')
    await fs.mkdir(external)
    await fs.symlink(external, path.join(directory, 'assets'), 'dir')
    await expect(importImages({ ...snapshot(), images: [{ name: 'x.png', bytes: png }] }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(await fs.readdir(external)).toEqual([])
    await fs.writeFile(path.join(directory, 'original.png'), png)
    const result = await importImageFiles(snapshot(), [path.join(directory, 'original.png')], documents, { ...DEFAULT_IMAGE_OPTIONS, directory: 'safe' }, async () => null)
    expect(result?.paths).toEqual([path.join(directory, 'safe/original.png')])
    expect(await fs.readFile(path.join(directory, 'original.png'))).toEqual(png)
  })
})
