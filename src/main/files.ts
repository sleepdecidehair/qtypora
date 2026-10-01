import { createHash, randomUUID } from 'node:crypto'
import { constants, realpath } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { DocumentRecord, FileEntry, LineEnding, SearchHit, SearchRequest } from '../shared/contracts'
import { DesktopError, invalid } from './errors'

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt'])
export const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

export const normalizeContent = (content: string): string => content.replace(/\r\n?/g, '\n')
export const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export function canonicalPath(candidate: string): Promise<string> {
  // The native Windows implementation expands 8.3 names. fs.promises.realpath may retain
  // ADMINI~1, which can abort libuv's directory watcher when events report the long name.
  return new Promise((resolve, reject) => realpath.native(candidate, (error, resolved) => error ? reject(error) : resolve(resolved)))
}

export function encodedDocument(content: string, encoding: DocumentRecord['encoding'], lineEnding: LineEnding): Buffer {
  const normalized = normalizeContent(content)
  const text = lineEnding === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized
  return Buffer.from((encoding === 'utf8-bom' ? '\ufeff' : '') + text, 'utf8')
}

export async function readMarkdown(filePath: string, id: string = randomUUID()): Promise<DocumentRecord> {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new DesktopError('UNSUPPORTED', '仅支持打开 Markdown 或 UTF-8 文本文件。')
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) invalid('请选择文件。')
  if (stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '当前开发版支持最大 16 MB 的文档。')
  const bytes = await fs.readFile(filePath)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes) }
  catch { throw new DesktopError('UNSUPPORTED', '文件不是有效 UTF-8 文本，请先转换编码。') }
  if (content.includes('\0')) throw new DesktopError('UNSUPPORTED', '该文件包含二进制内容。')
  let readOnly = false
  try { await fs.access(filePath, constants.W_OK) } catch { readOnly = true }
  return {
    id, path: filePath, name: path.basename(filePath), content: normalizeContent(content),
    version: hashBytes(bytes), encoding: hasBom ? 'utf8-bom' : 'utf8',
    lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF', readOnly,
  }
}

const writeQueues = new Map<string, Promise<unknown>>()

export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  writeQueues.set(key, current)
  try { return await current }
  finally { if (writeQueues.get(key) === current) writeQueues.delete(key) }
}

export async function atomicWrite(filePath: string, bytes: Uint8Array, beforeReplace?: () => Promise<void>): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await beforeReplace?.()
    await fs.rename(temporary, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(temporary).catch((error: unknown) => {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) console.error('[files] Temporary file cleanup failed')
    })
  }
}

export async function atomicWriteNew(filePath: string, bytes: Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    // Linking a complete same-directory temporary file publishes it atomically and
    // fails when the destination already exists, including a competing writer.
    await fs.link(temporary, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(temporary).catch(() => undefined)
  }
}

export async function saveMarkdown(record: DocumentRecord, destination: string, content: string, checkVersion: boolean): Promise<DocumentRecord> {
  return serialized(path.resolve(destination).toLowerCase(), async () => {
    let current: Buffer | null = null
    try {
      const stat = await fs.lstat(destination)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new DesktopError('PERMISSION_DENIED', '不能替换符号链接或非普通文件。')
      if (stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('CONFLICT', '目标文件过大，未执行替换。')
      current = await fs.readFile(destination)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (checkVersion && (current === null || hashBytes(current) !== record.version)) {
      throw new DesktopError('CONFLICT', '磁盘文件已被外部修改或删除。请先重新加载、比较内容，或另存为其他文件。')
    }
    if (checkVersion && current !== null && normalizeContent(content) === record.content) {
      // A normalized editor buffer cannot reconstruct mixed line endings byte-for-byte.
      // Saving an untouched document must retain the verified disk bytes instead.
      return { ...record, path: destination, name: path.basename(destination), readOnly: false }
    }
    const bytes = encodedDocument(content, record.encoding, record.lineEnding)
    await atomicWrite(destination, bytes, checkVersion ? async () => {
      try {
        const stat = await fs.lstat(destination)
        if (!stat.isFile() || stat.isSymbolicLink() || hashBytes(await fs.readFile(destination)) !== record.version) {
          throw new DesktopError('CONFLICT', '磁盘文件在保存过程中发生变化，未执行覆盖。')
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new DesktopError('CONFLICT', '磁盘文件在保存过程中被删除，未执行覆盖。')
        throw error
      }
    } : undefined)
    return { ...record, path: destination, name: path.basename(destination), content: normalizeContent(content), version: hashBytes(bytes), readOnly: false }
  })
}

export async function listDirectory(directory: string): Promise<FileEntry[]> {
  const names = await fs.readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(names.filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink() &&
    (entry.isDirectory() || (entry.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())))).map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    const stat = await fs.stat(entryPath)
    return { name: entry.name, path: entryPath, kind: entry.isDirectory() ? 'directory' as const : 'file' as const, modifiedAt: stat.mtimeMs }
  }))
  return entries.sort((a, b) => a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

export function insidePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)
}

export async function canonicalInside(candidate: string, root: string, mayCreate = false): Promise<string> {
  const resolvedRoot = await canonicalPath(root)
  let resolved: string
  if (mayCreate) {
    const parent = await canonicalPath(path.dirname(candidate))
    resolved = path.join(parent, path.basename(candidate))
  } else resolved = await canonicalPath(candidate)
  if (!insidePath(resolved, resolvedRoot)) throw new DesktopError('PERMISSION_DENIED', '此路径位于已授权目录之外。')
  return resolved
}

export function safeName(name: string): string {
  if (!name || name.length > 200 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..') invalid('文件名称包含无效字符或 Windows 保留名称。')
  return name
}

export async function duplicateMarkdown(source: string): Promise<FileEntry> {
  const stat = await fs.lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink() || !MARKDOWN_EXTENSIONS.has(path.extname(source).toLowerCase()) || stat.size > MAX_DOCUMENT_BYTES) {
    throw new DesktopError('UNSUPPORTED', '只能为不超过 16 MB 的普通 Markdown 或文本文件创建副本。')
  }
  const parsed = path.parse(source)
  for (let index = 1; index <= 1000; index++) {
    const name = `${parsed.name} - 副本${index === 1 ? '' : ` (${index})`}${parsed.ext}`
    safeName(name)
    const destination = path.join(parsed.dir, name)
    try {
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL)
      const copied = await fs.stat(destination)
      return { name, path: destination, kind: 'file', modifiedAt: copied.mtimeMs }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  throw new DesktopError('CONFLICT', '副本名称已被占用，请先重命名已有副本。')
}

export async function searchMarkdown(request: SearchRequest): Promise<SearchHit[]> {
  if (request.query.length > 256) invalid('搜索关键字最长 256 字符。')
  const needle = request.caseSensitive ? request.query : request.query.toLocaleLowerCase()
  const hits: SearchHit[] = []
  let visited = 0
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 24 || visited >= 10000 || hits.length >= 1000) return
    for (const entry of await listDirectory(directory)) {
      if (++visited > 10000 || hits.length >= 1000) return
      if (entry.kind === 'directory') { await walk(entry.path, depth + 1); continue }
      if ((await fs.stat(entry.path)).size > MAX_DOCUMENT_BYTES) continue
      const lines = (await fs.readFile(entry.path, 'utf8')).split(/\r?\n/)
      for (let index = 0; index < lines.length && hits.length < 1000; index++) {
        const line = lines[index]
        if ((request.caseSensitive ? line : line.toLocaleLowerCase()).includes(needle)) hits.push({ path: entry.path, name: entry.name, line: index + 1, text: line.trim().slice(0, 2000) })
      }
    }
  }
  await walk(request.root, 0)
  return hits
}
