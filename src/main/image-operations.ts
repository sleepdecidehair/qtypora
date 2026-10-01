import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ImageOperationRequest, ImageOperationResult } from '../shared/contracts'
import type { DocumentSession } from './documents'
import { validateSnapshot } from './documents'
import { DesktopError, invalid, object, string } from './errors'
import { atomicWriteNew, canonicalPath, hashBytes, IMAGE_MIME, MAX_DOCUMENT_BYTES, safeName, serialized } from './files'
import { markdownImageSources } from './image-paths'
import type { ResourceRegistry } from './resources'

export interface ImageDialogs {
  destination(source: string, action: 'copy' | 'move' | 'save-as'): Promise<string | null>
  confirm(source: string, action: 'move' | 'delete', destination?: string): Promise<boolean>
  trash(source: string): Promise<void>
}

export function validateImageOperation(value: unknown): ImageOperationRequest {
  const input = object(value)
  if (!['copy', 'move', 'delete', 'save-as'].includes(String(input.action))) invalid('图片操作无效。')
  return { ...validateSnapshot(input), source: string(input.source, '图片地址', MAX_DOCUMENT_BYTES), action: input.action as ImageOperationRequest['action'] }
}

function documentSource(destination: string, documentPath: string | null): string {
  if (!documentPath) return pathToFileURL(destination).href
  const relative = path.relative(path.dirname(documentPath), destination)
  return path.isAbsolute(relative) ? pathToFileURL(destination).href : relative.split(path.sep).map(encodeURIComponent).join('/')
}

async function imageBytes(source: string): Promise<Buffer> {
  const stat = await fs.lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '图片不是普通文件或超过 16 MB。')
  const bytes = await fs.readFile(source)
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '图片超过 16 MB。')
  return bytes
}

export async function operateImage(request: ImageOperationRequest, documents: DocumentSession, registry: ResourceRegistry, owner: number, dialogs: ImageDialogs): Promise<ImageOperationResult | null> {
  await documents.sync(request)
  const documentPath = documents.get(request.id).record.path
  const current = (): void => {
    let document
    try { document = documents.get(request.id) }
    catch { throw new DesktopError('CONFLICT', '文档在图片操作期间已关闭，未修改原图片。') }
    if (document.revision !== request.revision || document.currentContent !== request.content || document.record.path !== documentPath) throw new DesktopError('CONFLICT', '文档在图片操作期间发生变化，未修改原图片。请在当前文档中重试。')
  }
  current()
  const state = documents.get(request.id)
  if (state.record.readOnly && request.action !== 'save-as') throw new DesktopError('READ_ONLY', '只读文档不能修改图片引用或原文件。')
  const source = await registry.localPath(request.source, documentPath, documents, owner)
  let referenced = false
  for (const candidate of markdownImageSources(state.currentContent)) {
    try {
      if ((await registry.localPath(candidate, documentPath, documents, owner)).toLowerCase() === source.toLowerCase()) { referenced = true; break }
    } catch { /* Broken and remote references cannot authorize a local file operation. */ }
  }
  if (!referenced) throw new DesktopError('PERMISSION_DENIED', '图片必须是当前文档的实际引用。请同步当前文档后重试。')
  return serialized(`image-operation:${source.toLowerCase()}`, async () => {
    const original = await imageBytes(source)
    const expected = hashBytes(original)
    const unchanged = async (): Promise<void> => {
      if (hashBytes(await imageBytes(source)) !== expected) throw new DesktopError('CONFLICT', '原图片已被其他程序修改，未执行移动或删除。')
    }
    if (request.action === 'delete') {
      if (!await dialogs.confirm(source, 'delete')) return null
      current()
      await unchanged()
      current()
      await dialogs.trash(source)
      registry.invalidate(source)
      return { source: null }
    }
    const selected = await dialogs.destination(source, request.action)
    if (!selected) return null
    const directory = await canonicalPath(path.dirname(selected))
    const destination = path.join(directory, safeName(path.basename(selected)))
    if (IMAGE_MIME[path.extname(destination).toLowerCase()] !== IMAGE_MIME[path.extname(source).toLowerCase()]) invalid('目标扩展名必须与原图片格式一致。')
    if (destination.toLowerCase() === source.toLowerCase()) return { source: request.source }
    if (request.action === 'move' && !await dialogs.confirm(source, 'move', destination)) return null
    current()
    await unchanged()
    current()
    await atomicWriteNew(destination, original)
    if (request.action === 'move') {
      current()
      await unchanged()
      current()
      await fs.unlink(source)
      registry.invalidate(source)
    }
    if (request.action === 'save-as') return { source: request.source }
    documents.allowedRoots.add(directory)
    return { source: documentSource(destination, documentPath) }
  })
}
