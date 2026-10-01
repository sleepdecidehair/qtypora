import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Protocol } from 'electron'
import { DesktopError, invalid } from './errors'
import { IMAGE_MIME, MAX_DOCUMENT_BYTES } from './files'
import type { DocumentSession } from './documents'

interface ResourceToken { path: string; owner: number }

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceToken>()
  private readonly paths = new Map<string, string>()

  async resolve(source: string, documentPath: string | null, documents: DocumentSession, owner: number): Promise<string> {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source)
      if (url.username || url.password) invalid('图片地址不能包含登录凭据。')
      return url.href
    }
    if (/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(source) && source.length < MAX_DOCUMENT_BYTES) return source
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
    const candidate = decoded.startsWith('file:') ? fileURLToPath(decoded) : path.resolve(documentPath ? path.dirname(documentPath) : documents.workspace ?? '.', decoded)
    if (!IMAGE_MIME[path.extname(candidate).toLowerCase()]) throw new DesktopError('UNSUPPORTED', '仅允许加载图片资源。')
    const authorized = await documents.authorize(candidate)
    const stat = await fs.stat(authorized)
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '图片不是普通文件或超过 16 MB。')
    const key = `${owner}:${authorized}`
    let token = this.paths.get(key)
    if (!token) {
      token = randomUUID()
      this.paths.set(key, token)
      this.resources.set(token, { path: authorized, owner })
    }
    return `qtypora-media://resource/${token}`
  }

  register(protocol: Pick<Protocol, 'handle'>): void {
    protocol.handle('qtypora-media', async (request) => {
      try {
        const url = new URL(request.url)
        const resource = url.hostname === 'resource' ? this.resources.get(url.pathname.slice(1)) : undefined
        if (!resource || request.method !== 'GET') return new Response('Not found', { status: 404 })
        const bytes = await fs.readFile(resource.path)
        if (bytes.length > MAX_DOCUMENT_BYTES) return new Response('Too large', { status: 413 })
        return new Response(new Uint8Array(bytes), { headers: {
          'Content-Type': IMAGE_MIME[path.extname(resource.path).toLowerCase()],
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        } })
      } catch { return new Response('Not found', { status: 404 }) }
    })
  }

  async toDataUrl(source: string, owner: number): Promise<string> {
    const url = new URL(source)
    const resource = url.hostname === 'resource' ? this.resources.get(url.pathname.slice(1)) : undefined
    if (!resource || resource.owner !== owner) throw new DesktopError('PERMISSION_DENIED', '图片资源不属于当前窗口。')
    const bytes = await fs.readFile(resource.path)
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '图片超过 16 MB。')
    return `data:${IMAGE_MIME[path.extname(resource.path).toLowerCase()]};base64,${bytes.toString('base64')}`
  }

  async localPath(source: string, documentPath: string | null, documents: DocumentSession, owner: number): Promise<string> {
    if (/^(?:https?:|data:|\/\/)/i.test(source)) throw new DesktopError('PERMISSION_DENIED', '文件操作仅支持当前文档中的已授权本地图片。')
    const resolved = await this.resolve(source, documentPath, documents, owner)
    const url = new URL(resolved)
    const token = url.pathname.slice(1)
    const resource = url.protocol === 'qtypora-media:' && url.hostname === 'resource' ? this.resources.get(token) : undefined
    if (!resource || resource.owner !== owner) throw new DesktopError('PERMISSION_DENIED', '本地图片不属于当前窗口。')
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
