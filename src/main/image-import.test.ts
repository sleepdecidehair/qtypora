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
import { MAX_DOCUMENT_BYTES } from '../shared/document-size'

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
  it('checks the final collision name and encoding budget before writing a clipboard image', async () => {
    await fs.mkdir(path.join(directory, 'assets'))
    await fs.writeFile(path.join(directory, 'assets', 'x.png'), 'existing')
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES - 19)
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: content.length, to: content.length, table: false, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    expect(await fs.readdir(path.join(directory, 'assets'))).toEqual(['x.png'])
    expect(await fs.readFile(path.join(directory, 'assets', 'x.png'), 'utf8')).toBe('existing')
  })

  it('rejects stale budgets and accepts a size-reducing replacement', async () => {
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES)
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: 0, to: 100, table: false, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages({ ...request, pasteBudget: { ...request.pasteBudget, encoding: 'utf8-bom' } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('编码')
    const result = await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.markdown).toBe('![x](assets/x.png)')
    expect(await fs.readFile(result!.paths[0])).toEqual(png)
    expect(() => validateImageImport({ ...request, pasteBudget: { ...request.pasteBudget, to: content.length + 1 } })).toThrow()
  })

  it('counts BOM and CRLF and rejects a changed newline target before writing', async () => {
    const filename = path.join(directory, 'encoded.md')
    await fs.writeFile(filename, Buffer.from('\ufefffirst\r\nsecond', 'utf8'))
    record = await documents.open(filename, true)
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES - 22) + '\n'
    const budget = { from: content.length, to: content.length, table: false, encoding: 'utf8-bom' as const, lineEnding: 'CRLF' as const }
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: budget }
    await expect(importImages({ ...request, pasteBudget: { ...budget, lineEnding: 'LF' } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('换行')
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    await expect(fs.access(path.join(directory, 'assets', 'x.png'))).rejects.toThrow()
  })

  it('counts the blank lines added around a keyboard image before creating it', async () => {
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES - 18)
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: content.length, to: content.length, table: false, block: true, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    await expect(fs.access(path.join(directory, 'assets', 'x.png'))).rejects.toThrow()
    await expect(fs.access(path.join(directory, 'assets'))).rejects.toThrow()
    await expect(importImages(request, documents, { ...DEFAULT_IMAGE_OPTIONS, directory: 'media/images' }, async () => null)).rejects.toThrow('16 MB')
    await expect(fs.access(path.join(directory, 'media'))).rejects.toThrow()
  })

  it('rejects symlink directories during budget planning', async () => {
    await fs.mkdir(path.join(directory, 'assets'))
    await fs.symlink(path.join(directory, 'user'), path.join(directory, 'assets', 'link'), 'dir')
    const request = { ...snapshot(), images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: 0, to: 0, table: false, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, { ...DEFAULT_IMAGE_OPTIONS, directory: 'assets/link' }, async () => null)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(fs.access(path.join(directory, 'user', 'x.png'))).rejects.toThrow()
  })

  it('plans all image names before rejecting an oversized combined insertion', async () => {
    await fs.mkdir(path.join(directory, 'assets'))
    await fs.writeFile(path.join(directory, 'assets', 'x.png'), 'existing')
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES - 30)
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }, { name: 'x.png', bytes: png }], pasteBudget: { from: content.length, to: content.length, table: false, block: true, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    expect(await fs.readdir(path.join(directory, 'assets'))).toEqual(['x.png'])
    expect(await fs.readFile(path.join(directory, 'assets', 'x.png'), 'utf8')).toBe('existing')
    const replacement = await importImages({ ...request, pasteBudget: { ...request.pasteBudget, from: content.length - 100 } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(new Set(replacement?.paths).size).toBe(2)
    expect(replacement?.markdown.split('\n\n')).toHaveLength(2)
    expect(await fs.readFile(path.join(directory, 'assets', 'x.png'), 'utf8')).toBe('existing')
  })

  it('budgets the escaped table-cell representation before writing images', async () => {
    const content = 'a'.repeat(MAX_DOCUMENT_BYTES - 46) + '\n| x |'
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }, { name: 'y.png', bytes: png }], pasteBudget: { from: content.length, to: content.length, table: true, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    await expect(fs.access(path.join(directory, 'assets'))).rejects.toThrow()
  })

  it('validates a virtual table cell and budgets its computed prefix and suffix', async () => {
    const table = '| A | B | C |\n| --- | --- | --- |\n| only |'
    const at = table.length
    const budget = { from: at, to: at, table: true, virtualCell: { tableFrom: 0, tableTo: at, row: 1, column: 2 }, encoding: 'utf8' as const, lineEnding: record.lineEnding }
    const request = { id: record.id, content: table, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: budget }
    await fs.mkdir(path.join(directory, 'assets'))
    await fs.writeFile(path.join(directory, 'assets', 'x.png'), 'existing')
    const result = await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.markdown).toMatch(/^!\[x\]\(assets\/x-[a-f0-9]{8}\.png\)$/)
    expect(await fs.readFile(path.join(directory, 'assets', 'x.png'), 'utf8')).toBe('existing')
    await expect(importImages({ ...request, pasteBudget: { ...budget, virtualCell: { ...budget.virtualCell, row: 0 } } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow()
  })

  it('includes virtual-cell syntax in the byte budget before creating a directory', async () => {
    const table = '| A | B | C |\n| --- | --- | --- |\n| only |'
    const head = 'a'.repeat(MAX_DOCUMENT_BYTES - table.length - 2 - 18) + '\n\n'
    const content = head + table
    const at = content.length
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: at, to: at, table: true, virtualCell: { tableFrom: head.length, tableTo: at, row: 1, column: 2 }, encoding: 'utf8' as const, lineEnding: record.lineEnding } }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('16 MB')
    await expect(fs.access(path.join(directory, 'assets'))).rejects.toThrow()
  }, 30000)

  it('accepts an independently verified virtual cell in a BOM and CRLF document', async () => {
    const table = '| A | B |\n| --- | --- |\n| only |'
    const filename = path.join(directory, 'virtual-crlf.md')
    await fs.writeFile(filename, Buffer.from('\ufeff' + table.replaceAll('\n', '\r\n'), 'utf8'))
    record = await documents.open(filename, true)
    const at = table.length
    const request = { id: record.id, content: table, revision: 0, images: [{ name: 'x.png', bytes: png }], pasteBudget: { from: at, to: at, table: true, virtualCell: { tableFrom: 0, tableTo: at, row: 1, column: 1 }, encoding: 'utf8-bom' as const, lineEnding: 'CRLF' as const } }
    const result = await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.markdown).toBe('![x](assets/x.png)')
  })

  it('independently verifies existing empty cell identity before writing', async () => {
    const table = '| A | B |\n| --- | --- |\n|  | x |'
    const at = table.lastIndexOf('|  |') + 2
    const budget = { from: at, to: at, table: true, emptyCell: { tableFrom: 0, tableTo: table.length, row: 1, column: 0 }, encoding: 'utf8' as const, lineEnding: record.lineEnding }
    const request = { id: record.id, content: table, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: budget }
    await expect(importImages({ ...request, pasteBudget: { ...budget, emptyCell: { ...budget.emptyCell, column: 1 } } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('单元格')
    expect((await importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null))?.markdown).toBe('![x](assets/x.png)')
  })

  it('refuses either half of a table escape before creating image files', async () => {
    const content = '| A | B |\n| --- | --- |\n| a\\|b | x |'
    const at = content.indexOf('\\|')
    const budget = { from: at, to: at + 1, table: true, encoding: 'utf8' as const, lineEnding: record.lineEnding }
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: budget }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('转义')
    await expect(importImages({ ...request, pasteBudget: { ...budget, from: at + 1, to: at + 2 } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('转义')
    await expect(fs.access(path.join(directory, 'assets'))).rejects.toThrow()
    const result = await importImages({ ...request, pasteBudget: { ...budget, to: at + 2 } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.markdown).toBe('![x](assets/x.png)')
  })

  it('rejects entity and grapheme interiors before creating image files', async () => {
    const content = '| A | B |\n| --- | --- |\n| a&amp;b👩‍💻c | x |'
    const entity = content.indexOf('&amp;'), emoji = content.indexOf('👩‍💻')
    const budget = { from: entity + 1, to: entity + 4, table: true, encoding: 'utf8' as const, lineEnding: record.lineEnding }
    const request = { id: record.id, content, revision: 1, images: [{ name: 'x.png', bytes: png }], pasteBudget: budget }
    await expect(importImages(request, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('字符或实体')
    await expect(importImages({ ...request, pasteBudget: { ...budget, from: emoji, to: emoji + 2 } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)).rejects.toThrow('字符或实体')
    await expect(fs.access(path.join(directory, 'assets'))).rejects.toThrow()
    const result = await importImages({ ...request, pasteBudget: { ...budget, from: entity, to: entity + 5 } }, documents, DEFAULT_IMAGE_OPTIONS, async () => null)
    expect(result?.markdown).toBe('![x](assets/x.png)')
  })
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
