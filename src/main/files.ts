import { createHash, randomUUID } from 'node:crypto'
import { constants, realpath } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { DocumentRecord, FileEntry, LineEnding, SearchHit, SearchRequest, SearchResults } from '../shared/contracts'
import { DesktopError, invalid } from './errors'
import { compareWorkspaceEntries, excludesSearchDirectory, matchesFileFilter, normalizeWorkspaceOptions, parseSearchExclusions, type WorkspaceOptions } from '../shared/workspace-options'
import { createTextSearch } from '../shared/search'
import { readFileSnapshot, type FileIdentity } from './file-snapshot'

import { MAX_DOCUMENT_BYTES } from '../shared/document-size'
export { MAX_DOCUMENT_BYTES } from '../shared/document-size'
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

export async function readMarkdown(filePath: string, id: string = randomUUID(), onIdentity?: (identity: FileIdentity) => void): Promise<DocumentRecord> {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new DesktopError('UNSUPPORTED', '仅支持打开 Markdown 或 UTF-8 文本文件。')
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) invalid('请选择文件。')
  if (stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '当前开发版支持最大 16 MB 的文档。')
  const file = onIdentity ? await readFileSnapshot(filePath, MAX_DOCUMENT_BYTES) : null
  const bytes = file ? file.bytes : await fs.readFile(filePath)
  if (file) onIdentity?.({ dev: file.stat.dev, ino: file.stat.ino })
  return parseMarkdownBytes(filePath, id, bytes)
}

async function parseMarkdownBytes(filePath: string, id: string, bytes: Buffer): Promise<DocumentRecord> {
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

function sameCanonicalPath(first: string, second: string): boolean {
  if (process.platform === 'win32') return first.toLowerCase() === second.toLowerCase()
  if (process.platform === 'darwin') return first.normalize('NFD') === second.normalize('NFD')
  return first === second
}

/** Reopen a previously authorized canonical path without following a replacement symlink. */
export async function readClosedMarkdown(filePath: string, onIdentity?: (identity: FileIdentity) => void): Promise<DocumentRecord> {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new DesktopError('UNSUPPORTED', '仅支持打开 Markdown 或 UTF-8 文本文件。')
  const before = await fs.lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink() || !sameCanonicalPath(await canonicalPath(filePath), filePath)) throw new DesktopError('CONFLICT', '关闭的文件路径已变化，请重新选择文件。')
  if (before.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '当前开发版支持最大 16 MB 的文档。')
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW))
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs || opened.size > MAX_DOCUMENT_BYTES) throw new DesktopError('CONFLICT', '关闭的文件在打开时发生变化，请重试。')
    const buffer = Buffer.alloc(opened.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    const bytes = buffer.subarray(0, offset)
    const after = await handle.stat()
    const current = await fs.lstat(filePath)
    if (current.isSymbolicLink() || !current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs || bytes.length !== opened.size || !sameCanonicalPath(await canonicalPath(filePath), filePath)) {
      throw new DesktopError('CONFLICT', '关闭的文件在读取时发生变化，请重试。')
    }
    const record = await parseMarkdownBytes(filePath, randomUUID(), bytes)
    onIdentity?.({ dev: opened.dev, ino: opened.ino })
    return record
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'ELOOP' || error.code === 'ENOENT')) throw new DesktopError('CONFLICT', '关闭的文件不可用或路径已变化，请重新选择文件。')
    throw error
  } finally { await handle?.close() }
}

const writeQueues = new Map<string, Promise<unknown>>()

export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  writeQueues.set(key, current)
  try { return await current }
  finally { if (writeQueues.get(key) === current) writeQueues.delete(key) }
}

export async function atomicWrite(filePath: string, bytes: Uint8Array, beforeReplace?: () => Promise<void>, onIdentity?: (identity: FileIdentity) => void): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    const written = onIdentity ? await handle.stat() : null
    await handle.close()
    handle = undefined
    await beforeReplace?.()
    await fs.rename(temporary, filePath)
    if (written) onIdentity?.({ dev: written.dev, ino: written.ino })
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

export async function saveMarkdown(record: DocumentRecord, destination: string, content: string, checkVersion: boolean, onIdentity?: (identity: FileIdentity) => void, convertLineEnding?: LineEnding): Promise<DocumentRecord> {
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
    if (checkVersion && current !== null && convertLineEnding === undefined && normalizeContent(content) === record.content) {
      if (onIdentity) {
        const verified = await readFileSnapshot(destination, MAX_DOCUMENT_BYTES)
        if (hashBytes(verified.bytes) !== record.version) throw new DesktopError('CONFLICT', '磁盘文件在保存过程中发生变化，未执行覆盖。')
        onIdentity({ dev: verified.stat.dev, ino: verified.stat.ino })
      }
      // A normalized editor buffer cannot reconstruct mixed line endings byte-for-byte.
      // Saving an untouched document must retain the verified disk bytes instead.
      return { ...record, path: destination, name: path.basename(destination), readOnly: false }
    }
    const lineEnding = convertLineEnding ?? record.lineEnding
    const bytes = encodedDocument(content, record.encoding, lineEnding)
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '保存后的文件超过 16 MB，未执行保存。')
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
    } : undefined, onIdentity)
    return { ...record, path: destination, name: path.basename(destination), content: normalizeContent(content), version: hashBytes(bytes), lineEnding, readOnly: false }
  })
}

export async function listDirectory(directory: string, input?: WorkspaceOptions): Promise<FileEntry[]> {
  const options = normalizeWorkspaceOptions(input)
  const names = await fs.readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(names.filter((entry) => (options.showHidden || !entry.name.startsWith('.')) && !entry.isSymbolicLink() &&
    (entry.isDirectory() || (entry.isFile() && (options.showAllFiles || MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) && matchesFileFilter(entry.name, options.filter)))).map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    const stat = await fs.stat(entryPath)
    return { name: entry.name, path: entryPath, kind: entry.isDirectory() ? 'directory' as const : 'file' as const, modifiedAt: stat.mtimeMs, createdAt: stat.birthtimeMs }
  }))
  return entries.sort((first, second) => compareWorkspaceEntries(first, second, options))
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
  return (await searchMarkdownDetailed(request)).hits
}

export async function searchMarkdownDetailed(request: SearchRequest): Promise<SearchResults> {
  const limitations: SearchResults['limitations'] = { resultLimit: false, entryLimit: false, oversizedFiles: 0 }
  if (request.query.length > 256) invalid('搜索关键字最长 256 字符。')
  if (!request.query.trim()) return { hits: [], limitations }
  let search: ReturnType<typeof createTextSearch>
  let excluded: string[]
  try { search = createTextSearch(request.query, request); excluded = parseSearchExclusions(request.excludeDirectories ?? '') }
  catch (error) { throw new DesktopError('INVALID_INPUT', error instanceof Error ? error.message : '搜索条件无效。') }
  const hits: SearchHit[] = []
  let visited = 0
  // Iterative DFS keeps directory order without a recursion-depth ceiling.
  const stack: { entries: FileEntry[]; index: number }[] = [{ entries: await listDirectory(request.root), index: 0 }]
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.index >= frame.entries.length) { stack.pop(); continue }
    if (visited >= 10000) { limitations.entryLimit = true; break }
    if (hits.length >= 1000) { limitations.resultLimit = true; break }
    const entry = frame.entries[frame.index++]
    visited++
    if (entry.kind === 'directory') {
      if (!excludesSearchDirectory(path.relative(request.root, entry.path), excluded)) stack.push({ entries: await listDirectory(entry.path), index: 0 })
      continue
    }
    if ((await fs.stat(entry.path)).size > MAX_DOCUMENT_BYTES) { limitations.oversizedFiles++; continue }
    const lines = (await fs.readFile(entry.path, 'utf8')).split(/\r?\n/)
    for (let index = 0; index < lines.length && hits.length < 1000; index++) {
      const line = lines[index]
      const match = search.find(line, 1)[0]
      if (match) {
        // Retain a late match rather than returning an excerpt that cannot show the hit.
        const from = Math.max(0, match.from - 40)
        const start = from && (line.codePointAt(from - 1) ?? 0) > 0xffff ? from - 1 : from
        hits.push({ path: entry.path, name: entry.name, line: index + 1, text: (start ? '…' : '') + line.slice(start, start + 2000) })
        if (hits.length === 1000) limitations.resultLimit = true
      }
    }
  }
  return { hits, limitations }
}
