import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dataImageInfo } from '../shared/data-image'
import { DesktopError } from './errors'
import { validateImportArchive } from './import-archive'
import { markdownImageSources } from './image-paths'
import { PANDOC_IMPORT_MEDIA_FILTER } from './pandoc-import-filter'

const PACKAGED_DOCUMENTS = new Set(['docx', 'odt', 'epub'])

export async function withEmbeddedImportMedia(from: string, input: Uint8Array, convert: (filterPath: string | undefined) => Promise<Buffer>): Promise<Buffer> {
  if (!PACKAGED_DOCUMENTS.has(from)) return convert(undefined)
  await validateImportArchive(input)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-import-media-'))
  try {
    const filterPath = path.join(directory, 'embed-package-images.lua')
    await fs.writeFile(filterPath, PANDOC_IMPORT_MEDIA_FILTER, { mode: 0o600 })
    const result = await convert(filterPath)
    const sources = markdownImageSources(result.toString('utf8')).filter(source => /^data:/i.test(source))
    let total = 0
    if (sources.length > 20) throw new DesktopError('UNSUPPORTED', '文档内嵌图片超过 20 张。')
    for (const source of sources) {
      const info = dataImageInfo(source)
      if (!info) throw new DesktopError('UNSUPPORTED', '文档中存在不安全、损坏或超过 10 MB 的内嵌图片。')
      total += info.byteLength
    }
    if (total > 32 * 1024 * 1024) throw new DesktopError('UNSUPPORTED', '文档内嵌图片总大小超过 32 MB。')
    return result
  } finally {
    // This unique directory contains only our fixed filter; no document paths are extracted here.
    await fs.rm(directory, { recursive: true, force: true })
  }
}
