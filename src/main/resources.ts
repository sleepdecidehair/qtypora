import { randomUUID } from 'node:crypto'
import { isSafeDataImage } from '../shared/data-image'
import { Readable } from 'node:stream'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Protocol } from 'electron'
import { DesktopError, invalid } from './errors'
import { IMAGE_MIME, MAX_DOCUMENT_BYTES } from './files'
import type { DocumentSession } from './documents'
import { MEDIA_MIME, MAX_MEDIA_BYTES, parseByteRange } from './media-resources'
import { resolveRootImagePath } from './image-metadata'
import { isPathWithin, isPossiblyWithin, relocatedPath } from './workspace-lock'

const RESOURCE_MIME = { ...IMAGE_MIME, ...MEDIA_MIME }
const resourceLimit = (filePath: string): number => MEDIA_MIME[path.extname(filePath).toLowerCase()] ? MAX_MEDIA_BYTES : MAX_DOCUMENT_BYTES

interface ResourceToken { path: string; owner: number; documents: DocumentSession }

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceToken>()
  private readonly paths = new Map<string, string>()

  hasPathsWithin(directory: string): boolean {
    return [...this.resources.values()].some(resource => isPossiblyWithin(resource.path, directory))
  }

  registeredPaths(): string[] { return [...this.resources.values()].map(resource => resource.path) }

  /** Preserve issued per-window resource tokens when a document directory moves. */
  relocatePaths(source: string, destination: string): void {
    for (const resource of this.resources.values()) {
      if (isPathWithin(resource.path, source)) resource.path = relocatedPath(source, destination, resource.path)
    }
    this.paths.clear()
    for (const [token, resource] of this.resources) this.paths.set(`${resource.owner}:${resource.path}`, token)
  }

  async resolve(source: string, documentPath: string | null, documents: DocumentSession, owner: number): Promise<string> {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source)
      if (url.username || url.password) invalid('图片地址不能包含登录凭据。')
      return url.href
    }
    if (isSafeDataImage(source)) return source
    if (source.startsWith('qtypora-media://')) {
      const parsed = new URL(source)
      const token = parsed.pathname.slice(1)
      if (parsed.hostname !== 'resource' || this.resources.get(token)?.owner !== owner) throw new DesktopError('PERMISSION_DENIED', '图片资源不属于当前窗口。')
      return source
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source) && !source.startsWith('file:')) invalid('不支持此资源协议。')
    if (documentPath !== null && !documents.records().some((record) => record.path === documentPath)) throw new DesktopError('PERMISSION_DENIED', '图片必须属于当前窗口的文档。')
    let decoded = source
    try { decoded = decodeURIComponent(source) } catch { invalid('图片路径编码无效。') }
    const documentContent = documents.records().find(record => record.path === documentPath)?.content ?? ''
    const rootImage = resolveRootImagePath(decoded, documentPath, documentContent)
    const candidate = rootImage ?? (decoded.startsWith('file:') ? fileURLToPath(decoded) : path.resolve(documentPath ? path.dirname(documentPath) : documents.workspace ?? '.', decoded))
    if (!RESOURCE_MIME[path.extname(candidate).toLowerCase()]) throw new DesktopError('UNSUPPORTED', '仅允许加载图片、音频和视频资源。')
    const authorized = await documents.authorize(candidate)
    const stat = await fs.stat(authorized)
    if (!stat.isFile() || stat.size > resourceLimit(authorized)) throw new DesktopError('UNSUPPORTED', '资源不是普通文件或超过大小限制（图片 16 MB，音视频 128 MB）。')
    const key = `${owner}:${authorized}`
    let token = this.paths.get(key)
    if (!token) {
      token = randomUUID()
      this.paths.set(key, token)
      this.resources.set(token, { path: authorized, owner, documents })
    }
    return `qtypora-media://resource/${token}`
  }

  /** Reauthorize each read and bind it to the checked file handle. */
  private async openResource(resource: ResourceToken): Promise<{ file: fs.FileHandle; size: number }> {
    const authorized = await resource.documents.authorize(resource.path)
    if (authorized !== resource.path) throw new DesktopError('PERMISSION_DENIED', '资源路径已改变，请重新打开。')
    const file = await fs.open(resource.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = await file.stat()
      const current = await fs.lstat(resource.path)
      if (!stat.isFile() || !current.isFile() || current.isSymbolicLink() || stat.dev !== current.dev || stat.ino !== current.ino || stat.size > resourceLimit(resource.path) || await resource.documents.authorize(resource.path) !== resource.path) {
        throw new DesktopError('PERMISSION_DENIED', '资源路径已改变或文件超过大小限制。')
      }
      return { file, size: stat.size }
    } catch (error) { await file.close(); throw error }
  }

  register(protocol: Pick<Protocol, 'handle'>): void {
    protocol.handle('qtypora-media', async (request) => {
      try {
        const url = new URL(request.url)
        const resource = url.hostname === 'resource' ? this.resources.get(url.pathname.slice(1)) : undefined
        if (!resource || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 })
        const { file, size } = await this.openResource(resource)
        let streaming = false
        try {
          const headers = new Headers({
            'Content-Type': RESOURCE_MIME[path.extname(resource.path).toLowerCase()],
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes',
          })
          const range = parseByteRange(request.headers.get('range'), size)
          if (range === 'invalid') {
            headers.set('Content-Range', `bytes */${size}`)
            return new Response(null, { status: 416, headers })
          }
          const start = range?.start ?? 0
          const end = range?.end ?? size - 1
          headers.set('Content-Length', String(Math.max(0, end - start + 1)))
          if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
          if (request.method === 'HEAD' || size === 0) return new Response(null, { status: range ? 206 : 200, headers })
          // The response owns the stream; closing it also closes the file descriptor.
          const stream = file.createReadStream({ start, end, autoClose: true })
          streaming = true
          return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
        } finally {
          if (!streaming) await file.close()
        }
      } catch { return new Response('Not found', { status: 404 }) }
    })
  }

  async toDataUrl(source: string, owner: number): Promise<string> {
    const url = new URL(source)
    const resource = url.hostname === 'resource' ? this.resources.get(url.pathname.slice(1)) : undefined
    if (!resource || resource.owner !== owner) throw new DesktopError('PERMISSION_DENIED', '图片资源不属于当前窗口。')
    if (!IMAGE_MIME[path.extname(resource.path).toLowerCase()]) throw new DesktopError('UNSUPPORTED', '此操作仅支持图片。')
    const { file, size } = await this.openResource(resource)
    let bytes: Buffer
    try {
      const before = await file.stat()
      bytes = Buffer.alloc(size + 1)
      let offset = 0
      while (offset < bytes.length) {
        const result = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!result.bytesRead) break
        offset += result.bytesRead
      }
      const after = await file.stat()
      if (offset !== size || before.size !== size || after.size !== size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || await resource.documents.authorize(resource.path) !== resource.path) throw new DesktopError('CONFLICT', '图片在读取期间发生变化，请重试。')
      bytes = bytes.subarray(0, offset)
    } finally { await file.close() }
    return `data:${IMAGE_MIME[path.extname(resource.path).toLowerCase()]};base64,${bytes.toString('base64')}`
  }

  async localPath(source: string, documentPath: string | null, documents: DocumentSession, owner: number): Promise<string> {
    if (/^(?:https?:|data:|\/\/)/i.test(source)) throw new DesktopError('PERMISSION_DENIED', '文件操作仅支持当前文档中的已授权本地图片。')
    const resolved = await this.resolve(source, documentPath, documents, owner)
    const url = new URL(resolved)
    const token = url.pathname.slice(1)
    const resource = url.protocol === 'qtypora-media:' && url.hostname === 'resource' ? this.resources.get(token) : undefined
    if (!resource || resource.owner !== owner) throw new DesktopError('PERMISSION_DENIED', '本地图片不属于当前窗口。')
    if (!IMAGE_MIME[path.extname(resource.path).toLowerCase()]) throw new DesktopError('UNSUPPORTED', '文件操作仅支持图片。')
    const authorized = await documents.authorize(resource.path)
    const stat = await fs.lstat(authorized)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '图片不是普通文件或超过 16 MB。')
    return authorized
  }

  invalidate(filePath: string): void {
    for (const [token, resource] of this.resources) {
      if (resource.path.toLowerCase() === filePath.toLowerCase()) {
        this.resources.delete(token)
        this.paths.delete(`${resource.owner}:${resource.path}`)
      }
    }
  }

  dispose(owner: number): void {
    for (const [token, resource] of this.resources) {
      if (resource.owner === owner) {
        this.resources.delete(token)
        this.paths.delete(`${owner}:${resource.path}`)
      }
    }
  }
}
