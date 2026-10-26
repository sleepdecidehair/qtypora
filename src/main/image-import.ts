import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { DocumentSnapshot } from '../shared/contracts'
import { normalizeImageOptions, type ImageOptions, type ImageImportRequest, type ImageImportResult, type ImportedImage, type UploadImagesRequest, type UploadImagesResult } from '../shared/image-options'
import { DocumentSession, validateSnapshot } from './documents'
import { DesktopError, invalid, object, string } from './errors'
import { atomicWriteNew, canonicalPath, hashBytes, insidePath, MAX_DOCUMENT_BYTES, serialized } from './files'
import { checkedImage, readImageFile } from './image-bytes'
import { normalizedImageSource, runImageUploader, validateUploadImages } from './image-uploader'
import { metadataImageDirectory } from './image-metadata'
import { markdownImageSources } from './image-paths'
import type { ResourceRegistry } from './resources'
import { downloadRemoteImage } from './image-download'
import { dataImageInfo, isSafeDataImage } from '../shared/data-image'

const MAX_IMAGES = 20
const MAX_BATCH_BYTES = 32 * 1024 * 1024

export function validateImageImport(input: unknown): ImageImportRequest {
  const value = object(input)
  const snapshot = validateSnapshot(value)
  if (!Array.isArray(value.images) || !value.images.length || value.images.length > MAX_IMAGES) invalid('每次可插入 1 至 20 张图片。')
  let total = 0
  const images = value.images.map(item => {
    const image = object(item)
    const name = string(image.name, '图片名称', 250)
    if (!(image.bytes instanceof Uint8Array)) invalid('图片数据无效。')
    total += image.bytes.byteLength
    if (total > MAX_BATCH_BYTES) invalid('单次插入图片总大小不能超过 32 MB。')
    return checkedImage({ name, bytes: image.bytes })
  })
  return { ...snapshot, images }
}

async function destinationDirectory(root: string, relative: string): Promise<string> {
  let current = root
  for (const part of relative.split('/')) {
    const next = path.join(current, part)
    try { await fs.mkdir(next) }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error }
    const stat = await fs.lstat(next)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DesktopError('PERMISSION_DENIED', '图片目录不能包含符号链接或普通文件。')
    current = await canonicalPath(next)
    if (!insidePath(current, root)) throw new DesktopError('PERMISSION_DENIED', '图片目录位于文档目录之外。')
  }
  return current
}

async function documentImageDirectory(documentPath: string, content: string, documents: DocumentSession, options: ImageOptions): Promise<string> {
  const desired = metadataImageDirectory(content, documentPath, options.directory)
  for (const allowed of documents.allowedRoots) {
    const root = await canonicalPath(allowed)
    if (!insidePath(desired, root)) continue
    const relative = path.relative(root, desired).split(path.sep).join('/')
    if (!relative) return root
    normalizeImageOptions({ directory: relative })
    return destinationDirectory(root, relative)
  }
  throw new DesktopError('PERMISSION_DENIED', 'YAML 图片目录尚未授权，请先打开其所在文件夹。')
}

function documentImageSource(filename: string, documentPath: string | null, options: ImageOptions): string {
  const relative = documentPath && options.useRelativePath ? path.relative(path.dirname(documentPath), filename) : null
  return relative !== null && !path.isAbsolute(relative) ? relative.split(path.sep).map(encodeURIComponent).join('/') : pathToFileURL(filename).href
}

export async function importImages(request: ImageImportRequest, documents: DocumentSession, preferences: ImageOptions, chooseDirectory: () => Promise<string | null>): Promise<ImageImportResult | null> {
  const options = normalizeImageOptions(preferences)
  const checked = validateImageImport(request)
  await documents.sync(checked)
  const originalPath = documents.get(checked.id).record.path
  const unchanged = (): void => {
    let current
    try { current = documents.get(checked.id) }
    catch { throw new DesktopError('CONFLICT', '文档已关闭，未插入图片。') }
    if (current.record.readOnly) throw new DesktopError('READ_ONLY', '只读文档不能插入图片。')
    if (current.revision !== checked.revision || current.currentContent !== checked.content || current.record.path !== originalPath) throw new DesktopError('CONFLICT', '文档在图片导入期间发生变化，请重新插入。')
  }
  unchanged()
  const selected = originalPath ? path.dirname(originalPath) : await chooseDirectory()
  if (!selected) return null
  unchanged()
  const root = await canonicalPath(selected)
  if (!(await fs.stat(root)).isDirectory()) invalid('请选择图片保存文件夹。')
  return serialized(`image-import:${root}`, async () => {
    unchanged()
    const directory = originalPath ? await documentImageDirectory(originalPath, checked.content, documents, options) : root
    const created: { path: string; hash: string }[] = []
    try {
      for (const image of checked.images) {
        unchanged()
        let destination = path.join(directory, image.name)
        try { await atomicWriteNew(destination, image.bytes) }
        catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
          destination = path.join(directory, `${path.parse(image.name).name}-${randomUUID().slice(0, 8)}${path.extname(image.name)}`)
          await atomicWriteNew(destination, image.bytes)
        }
        created.push({ path: destination, hash: hashBytes(image.bytes) })
      }
      unchanged()
      const uploaded = options.uploadOnInsert ? await runImageUploader(created.map(entry => entry.path), options) : null
      unchanged()
      documents.allowedRoots.add(directory)
      const markdown = created.map((entry, index) => {
        const source = uploaded?.[index] ?? documentImageSource(entry.path, originalPath, options)
        const alt = path.parse(checked.images[index].name).name.replace(/[\\[\]]/g, '\\$&')
        return `![${alt}](${source.replace(/[()]/g, character => character === '(' ? '%28' : '%29')})`
      }).join('\n\n')
      return { markdown, paths: created.map(entry => entry.path) }
    } catch (error) {
      for (const entry of created) {
        try {
          const stat = await fs.lstat(entry.path)
          if (stat.isFile() && !stat.isSymbolicLink() && hashBytes(await readImageFile(entry.path)) === entry.hash) await fs.unlink(entry.path)
        } catch { /* Preserve a file if another process changed or removed it. */ }
      }
      throw error
    }
  })
}

export async function organizeImages(request: UploadImagesRequest, documents: DocumentSession, registry: ResourceRegistry, owner: number, preferences: ImageOptions, chooseDirectory: () => Promise<string | null>): Promise<UploadImagesResult | null> {
  const checked = validateUploadImages(request), options = normalizeImageOptions(preferences)
  await documents.sync(checked)
  const originalPath = documents.get(checked.id).record.path
  const unchanged = () => {
    const document = documents.get(checked.id)
    if (document.record.readOnly) throw new DesktopError('READ_ONLY', '只读文档不能整理图片。')
    if (document.revision !== checked.revision || document.currentContent !== checked.content || document.record.path !== originalPath) throw new DesktopError('CONFLICT', '整理期间文档已改变，未替换图片引用。')
  }
  unchanged()
  const actual = new Set(markdownImageSources(checked.content).map(normalizedImageSource))
  if (checked.sources.some(source => !actual.has(normalizedImageSource(source)))) throw new DesktopError('PERMISSION_DENIED', '只能整理当前文档实际引用的本地图片。')
  const originals = await Promise.all(checked.sources.map(source => /^https?:\/\//i.test(source) || isSafeDataImage(source) ? source : registry.localPath(source, originalPath, documents, owner)))
  const selected = originalPath ? null : await chooseDirectory()
  if (!originalPath && !selected) return null
  unchanged()
  const directory = originalPath ? await documentImageDirectory(originalPath, checked.content, documents, options) : await canonicalPath(selected!)
  const unique = [...new Set(originals.filter(filename => /^https?:\/\//i.test(filename) || isSafeDataImage(filename) || path.dirname(filename) !== directory))]
  let copied: string[] = []
  if (unique.length) {
    const images: ImportedImage[] = []
    let total = 0
    for (const source of unique) {
      unchanged()
      const embedded = dataImageInfo(source)
      const image = embedded ? checkedImage({ name: `embedded-image-${images.length + 1}.${embedded.mime === 'image/jpeg' ? 'jpg' : embedded.mime.slice('image/'.length)}`, bytes: Buffer.from(source.slice(source.indexOf(',') + 1), 'base64') }) : /^https?:\/\//i.test(source) ? await downloadRemoteImage(source) : { name: path.basename(source), bytes: await readImageFile(source) }
      total += image.bytes.byteLength
      if (total > MAX_BATCH_BYTES) invalid('单次整理图片总大小不能超过 32 MB。')
      images.push(image)
    }
    unchanged()
    const result = await importImages({ ...checked, images }, documents, { ...options, uploadOnInsert: false }, async () => selected)
    if (!result) return null
    copied = result.paths
  }
  unchanged()
  const destinations = new Map(unique.map((filename, index) => [filename, copied[index]]))
  return { replacements: checked.sources.map((source, index) => ({ source, url: documentImageSource(destinations.get(originals[index]) ?? originals[index], originalPath, options) })) }
}

// Paths must originate in a native chooser or the authorized resource registry, never renderer input.
export async function importImageFiles(snapshot: DocumentSnapshot, paths: string[], documents: DocumentSession, options: ImageOptions, chooseDirectory: () => Promise<string | null>): Promise<ImageImportResult | null> {
  if (!paths.length) return null
  if (paths.length > MAX_IMAGES) invalid('每次最多插入 20 张图片。')
  const images: ImportedImage[] = []
  let total = 0
  for (const filename of paths) {
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) invalid('图片必须是小于 16 MB 的普通文件。')
    total += stat.size
    if (total > MAX_BATCH_BYTES) invalid('单次插入图片总大小不能超过 32 MB。')
    images.push({ name: path.basename(filename), bytes: await readImageFile(filename) })
  }
  return importImages({ ...snapshot, images }, documents, options, chooseDirectory)
}
