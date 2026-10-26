import * as fs from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { withEmbeddedImportMedia } from './pandoc-import-media'
import { validateImportArchive } from './import-archive'
import { runPandoc } from './pandoc'
import { markdownImageSources } from './image-paths'
import { dataImageInfo } from '../shared/data-image'

function archive(name = 'note.xml', text = '<document/>', declaredSize?: number): Buffer {
  const filename = Buffer.from(name)
  const data = Buffer.from(text)
  const compressed = deflateRawSync(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize ?? data.length, 22); local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10)
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize ?? data.length, 24); central.writeUInt16LE(filename.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16)
  return Buffer.concat([local, filename, compressed, central, filename, end])
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVj8AAAAASUVORK5CYII='

describe('embedded document import', () => {
  it('checks archive expansion before conversion and removes the fixed filter after success or failure', async () => {
    let filterPath = ''
    const result = await withEmbeddedImportMedia('docx', archive(), async filter => {
      filterPath = filter!
      const script = await fs.readFile(filter!, 'utf8')
      expect(script).toContain('pandoc.mediabag.lookup(source)')
      expect(script).not.toMatch(/mediabag\.(?:fetch|fill)\(|pandoc\.(?:pipe|read)\(/)
      return Buffer.from(`![picture](${png})`)
    })
    expect(result.toString()).toContain(png)
    await expect(fs.access(filterPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(withEmbeddedImportMedia('docx', archive(), async filter => { filterPath = filter!; throw new Error('conversion failed') })).rejects.toThrow('conversion failed')
    await expect(fs.access(filterPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects declared or actual ZIP bombs, traversal, corruption and dangerous image data', async () => {
    for (const input of [Buffer.from('invalid'), archive('../outside.png'), archive('x', 'small', 33 * 1024 * 1024), archive('x', 'large'.repeat(1000), 2)]) await expect(validateImportArchive(input)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(withEmbeddedImportMedia('epub', archive(), async () => Buffer.from('<img src="data:image/svg+xml;base64,PHN2Zy8+">'))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(withEmbeddedImportMedia('epub', archive(), async () => Buffer.from('![fake](data:image/png;base64,PHNjcmlwdD4=)'))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })
  it('does not add a filter or archive policy to plain text formats', async () => {
    expect(await withEmbeddedImportMedia('html', Buffer.from('<p>body</p>'), async filter => {
      expect(filter).toBeUndefined()
      return Buffer.from('body')
    })).toEqual(Buffer.from('body'))
  })
})

const executable = process.env.QTYPORA_TEST_PANDOC

describe.runIf(Boolean(executable))('real Pandoc embedded media import', () => {
  it('preserves the actual HTML export img src through Word and back to Markdown', async () => {
    const html = `<html><head><title>Export</title></head><body><h1>Image round trip</h1><p class="md-image-paragraph"><img loading="lazy" src="${png}" alt="Pixel"></p></body></html>`
    const binary = await runPandoc(Buffer.from(html), 'html', 'docx', executable)
    const markdown = await withEmbeddedImportMedia('docx', binary, filter => runPandoc(binary, 'docx', 'gfm', executable, filter))
    expect(markdownImageSources(markdown.toString())).toEqual([png])
  })
  for (const format of ['docx', 'odt', 'epub']) it(`preserves an embedded PNG through ${format} and Markdown without external files`, async () => {
    const binary = await runPandoc(Buffer.from(`# Image round trip\n\n![Pixel](${png})\n`), 'gfm', format, executable)
    const markdown = await withEmbeddedImportMedia(format, binary, filter => runPandoc(binary, format, 'gfm', executable, filter))
    const sources = markdownImageSources(markdown.toString())
    expect(sources).toHaveLength(1)
    expect(sources[0]).toBe(png)
    expect(dataImageInfo(sources[0])?.mime).toBe('image/png')
    expect(markdown.toString()).toContain('Image round trip')
  })
})
