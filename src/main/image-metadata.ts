import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { DesktopError } from './errors'
import { insidePath } from './files'

export interface ImageMetadata { rootUrl?: string; copyImagesTo?: string }

export function readImageMetadata(content: string): ImageMetadata {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)
  if (!match || match[1].length > 65536) return {}
  try {
    const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true })
    if (document.errors.length) return {}
    const value: unknown = document.toJS({ maxAliasCount: 0 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const data = value as Record<string, unknown>
    const result: ImageMetadata = {}
    for (const [key, name] of [['typora-root-url', 'rootUrl'], ['typora-copy-images-to', 'copyImagesTo']] as const) {
      const item = data[key]
      if (typeof item === 'string' && item.trim() && item.length <= 4096 && !/[\x00-\x1f\x7f]/.test(item)) result[name] = item.trim()
    }
    return result
  } catch { return {} }
}

/** Resolves a site-root reference only; callers still authorize the resulting local path. */
export function resolveRootImagePath(decodedSource: string, documentPath: string | null, content: string): string | null {
  if (!documentPath || !decodedSource.startsWith('/') || decodedSource.startsWith('//')) return null
  const { rootUrl } = readImageMetadata(content)
  if (!rootUrl) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(rootUrl) && !/^file:/i.test(rootUrl) && !/^[a-z]:[\\/]/i.test(rootUrl)) throw new DesktopError('INVALID_INPUT', '图片根目录必须是本地目录。')
  const root = /^file:/i.test(rootUrl) ? fileURLToPath(rootUrl) : path.resolve(path.dirname(documentPath), rootUrl)
  const candidate = path.resolve(root, '.' + decodedSource)
  if (!insidePath(candidate, root)) throw new DesktopError('PERMISSION_DENIED', '图片地址不能越过 YAML 配置的图片根目录。')
  return candidate
}

export function metadataImageDirectory(content: string, documentPath: string, fallback: string): string {
  const value = readImageMetadata(content).copyImagesTo
  // A document never opts itself into invoking an external uploader.
  const selected = !value || value === 'upload' || value === 'ipic' ? fallback : value
  if (/^[a-z][a-z\d+.-]*:/i.test(selected) && !/^[a-z]:[\\/]/i.test(selected)) throw new DesktopError('INVALID_INPUT', '图片复制目录必须是本地路径。')
  return path.resolve(path.dirname(documentPath), selected.replaceAll('${filename}', path.parse(documentPath).name))
}
