import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { FileEntry } from '../shared/contracts'
import { canonicalInside, canonicalPath, hashBytes, MARKDOWN_EXTENSIONS, MAX_DOCUMENT_BYTES, safeName, serialized } from './files'
import { DesktopError } from './errors'
import { readFileSnapshot, type FileIdentity } from './file-snapshot'
import { moveDirectoryExclusive } from './directory-move'
import { isPathWithin } from './workspace-lock'

interface MoveRecord { kind: 'move'; root: string; source: string; destination: string; identity: FileIdentity; nodeKind: 'file' | 'directory' }
interface CreationRecord { kind: 'create'; root: string; destination: string; identity: FileIdentity; hash: string }
interface DirectoryCreationRecord { kind: 'create-directory'; root: string; destination: string; identity: FileIdentity }
export interface FileMoveHooks {
  withDocumentLocks: <T>(source: string, operation: () => Promise<T>, destination?: string) => Promise<T>
  updatePaths: (source: string, destination: string | null) => Promise<void>
}

function sameIdentity(first: FileIdentity, second: FileIdentity): boolean { return first.dev === second.dev && first.ino === second.ino }

async function moveExclusive(source: string, destination: string, expected?: FileIdentity): Promise<FileIdentity> {
  const before = await fs.lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw new DesktopError('UNSUPPORTED', '目前只能移动普通文件；文件夹请通过系统文件管理器移动。')
  if (expected && !sameIdentity(before, expected)) throw new DesktopError('CONFLICT', '文件已被替换，不能撤销此移动。')
  // link() creates exclusively: unlike rename(), it cannot overwrite an existing target.
  await fs.link(source, destination)
  let removedSource = false
  try {
    const linked = await fs.lstat(destination)
    const current = await fs.lstat(source)
    if (!sameIdentity(before, linked) || !sameIdentity(before, current) || current.isSymbolicLink()) throw new DesktopError('CONFLICT', '文件在移动过程中发生变化，原文件未删除。')
    await fs.unlink(source)
    removedSource = true
    return { dev: linked.dev, ino: linked.ino }
  } finally {
    if (!removedSource) {
      try {
        const linked = await fs.lstat(destination)
        if (sameIdentity(before, linked)) await fs.unlink(destination)
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      }
    }
  }
}

async function entry(filePath: string): Promise<FileEntry> {
  const stat = await fs.stat(filePath)
  return { name: path.basename(filePath), path: filePath, kind: stat.isDirectory() ? 'directory' : 'file', modifiedAt: stat.mtimeMs, createdAt: stat.birthtimeMs }
}

export class FileMoveHistory {
  private records: (MoveRecord | CreationRecord | DirectoryCreationRecord)[] = []
  private readonly queue = `file-moves:${randomUUID()}`
  constructor(private readonly hooks: FileMoveHooks) {}

  async move(workspace: string, sourcePath: string, destinationDirectory: string, newName?: string): Promise<FileEntry> {
    return serialized(this.queue, async () => {
      const root = await canonicalPath(workspace)
      const sourceStat = await fs.lstat(path.resolve(sourcePath))
      if (sourceStat.isSymbolicLink()) throw new DesktopError('PERMISSION_DENIED', '不能移动符号链接。')
      if (!sourceStat.isFile() && !sourceStat.isDirectory()) throw new DesktopError('UNSUPPORTED', '只能移动普通文件或目录。')
      if (sourceStat.isDirectory() && (!sourceStat.ino || !sourceStat.dev)) throw new DesktopError('UNSUPPORTED', '当前文件系统无法可靠识别目录，不能安全移动。')
      const source = await canonicalInside(path.resolve(sourcePath), root)
      if (source.toLowerCase() === root.toLowerCase()) throw new DesktopError('PERMISSION_DENIED', '不能移动工作区根目录。')
      const parent = await canonicalInside(path.resolve(destinationDirectory), root)
      if (!(await fs.stat(parent)).isDirectory()) throw new DesktopError('INVALID_INPUT', '目标必须是当前工作区中的文件夹。')
      if (sourceStat.isDirectory() && isPathWithin(parent, source)) throw new DesktopError('INVALID_INPUT', '不能将目录移动到其自身或子目录中。')
      const destination = await canonicalInside(path.join(parent, newName === undefined ? path.basename(source) : safeName(newName)), root, true)
      if (source === destination) return entry(source)
      return this.hooks.withDocumentLocks(source, async () => {
        // Recheck path traversal after waiting for every document lock.
        if (await canonicalInside(source, root) !== source || await canonicalInside(parent, root) !== parent) throw new DesktopError('CONFLICT', '目录路径已改变，请重试。')
        const nodeKind = sourceStat.isDirectory() ? 'directory' : 'file'
        const identity = nodeKind === 'directory' ? await moveDirectoryExclusive(source, destination, sourceStat) : await moveExclusive(source, destination, sourceStat)
        this.remember({ kind: 'move', root, source, destination, identity, nodeKind })
        await this.hooks.updatePaths(source, destination)
        return entry(destination)
      }, destination)
    })
  }

  rename(workspace: string, source: string, name: string): Promise<FileEntry> {
    return this.move(workspace, source, path.dirname(source), name)
  }

  private remember(record: MoveRecord | CreationRecord | DirectoryCreationRecord): void {
    this.records.push(record)
    if (this.records.length > 20) this.records.shift()
  }

  private async createExclusive(root: string, destination: string, bytes: Uint8Array): Promise<FileEntry> {
    const handle = await fs.open(destination, 'wx', 0o600)
    let identity: FileIdentity | undefined
    let finished = false
    try {
      identity = await handle.stat()
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      const current = await fs.lstat(destination)
      if (current.isSymbolicLink() || !sameIdentity(current, identity)) throw new DesktopError('CONFLICT', '新文件已被替换，请重试。')
      this.remember({ kind: 'create', root, destination, identity: { dev: identity.dev, ino: identity.ino }, hash: hashBytes(bytes) })
      finished = true
    } finally {
      await handle.close().catch(() => undefined)
      if (!finished && identity) {
        try {
          const current = await fs.lstat(destination)
          if (!current.isSymbolicLink() && sameIdentity(current, identity)) await fs.unlink(destination)
        } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
      }
    }
    return entry(destination)
  }

  async create(workspace: string, directory: string, name: string): Promise<FileEntry> {
    return serialized(this.queue, async () => {
      const root = await canonicalPath(workspace)
      safeName(name)
      if (!MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new DesktopError('INVALID_INPUT', '文档名称需要 Markdown 或 .txt 扩展名。')
      const parent = await canonicalInside(path.resolve(directory), root)
      if (!(await fs.stat(parent)).isDirectory()) throw new DesktopError('INVALID_INPUT', '请在文件夹内创建文件。')
      const destination = await canonicalInside(path.join(parent, name), root, true)
      return this.hooks.withDocumentLocks(destination, () => this.createExclusive(root, destination, Buffer.alloc(0)), destination)
    })
  }

  async createDirectory(workspace: string, directory: string, name: string): Promise<FileEntry> {
    return serialized(this.queue, async () => {
      const root = await canonicalPath(workspace)
      const parent = await canonicalInside(path.resolve(directory), root)
      if (!(await fs.stat(parent)).isDirectory()) throw new DesktopError('INVALID_INPUT', '请在文件夹内创建目录。')
      const destination = await canonicalInside(path.join(parent, safeName(name)), root, true)
      return this.hooks.withDocumentLocks(destination, async () => {
        if (await canonicalInside(parent, root) !== parent) throw new DesktopError('CONFLICT', '目标文件夹已改变，请重试。')
        await fs.mkdir(destination)
        const stat = await fs.lstat(destination)
        if (!stat.isDirectory() || stat.isSymbolicLink() || !stat.dev || !stat.ino) throw new DesktopError('CONFLICT', '目录已创建，但无法确认其身份；请手动检查。')
        this.remember({ kind: 'create-directory', root, destination, identity: { dev: stat.dev, ino: stat.ino } })
        return entry(destination)
      }, destination)
    })
  }

  async duplicate(workspace: string, sourcePath: string): Promise<FileEntry> {
    return serialized(this.queue, async () => {
      const root = await canonicalPath(workspace)
      if ((await fs.lstat(path.resolve(sourcePath))).isSymbolicLink()) throw new DesktopError('PERMISSION_DENIED', '不能复制符号链接。')
      const source = await canonicalInside(path.resolve(sourcePath), root)
      const bytes = await this.hooks.withDocumentLocks(source, async () => {
        const stat = await fs.lstat(source)
        if (!stat.isFile() || stat.isSymbolicLink() || !MARKDOWN_EXTENSIONS.has(path.extname(source).toLowerCase()) || stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '只能为不超过 16 MB 的普通 Markdown 或文本文件创建副本。')
        return (await readFileSnapshot(source, MAX_DOCUMENT_BYTES, stat)).bytes
      })
      const parsed = path.parse(source)
      for (let index = 1; index <= 1000; index++) {
        const name = safeName(`${parsed.name} - 副本${index === 1 ? '' : ` (${index})`}${parsed.ext}`)
        const destination = await canonicalInside(path.join(parsed.dir, name), root, true)
        try { return await this.hooks.withDocumentLocks(destination, () => this.createExclusive(root, destination, bytes), destination) }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error }
      }
      throw new DesktopError('CONFLICT', '副本名称已被占用，请先重命名已有副本。')
    })
  }

  async undo(workspace: string): Promise<FileEntry | null> {
    return serialized(this.queue, async () => {
      const record = this.records.at(-1)
      if (!record) return null
      const root = await canonicalPath(workspace)
      if (root !== record.root) throw new DesktopError('CONFLICT', '请切回执行操作时的工作区，再撤销文件操作。')
      if ((await fs.lstat(record.destination)).isSymbolicLink()) throw new DesktopError('CONFLICT', '文件已被替换，不能撤销此操作。')
      const source = await canonicalInside(record.destination, root)
      if (record.kind === 'create-directory') {
        if (source !== record.destination) throw new DesktopError('CONFLICT', '目录路径已改变，不能撤销此操作。')
        return this.hooks.withDocumentLocks(source, async () => {
          const current = await fs.lstat(source)
          if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, record.identity)) throw new DesktopError('CONFLICT', '目录已被替换，不能撤销创建。')
          // rmdir is atomic and refuses a directory containing any file, including hidden entries.
          try { await fs.rmdir(source) }
          catch (error) { if (error && typeof error === 'object' && 'code' in error && ['ENOTEMPTY', 'EEXIST'].includes(String(error.code))) throw new DesktopError('CONFLICT', '目录非空，不能撤销创建。'); throw error }
          this.records.pop()
          return entry(path.dirname(source))
        })
      }
      if (record.kind === 'create') {
        if (source !== record.destination) throw new DesktopError('CONFLICT', '目录路径已改变，不能撤销此操作。')
        return this.hooks.withDocumentLocks(source, async () => {
          const { stat: before, bytes } = await readFileSnapshot(source, MAX_DOCUMENT_BYTES, record.identity)
          if (hashBytes(bytes) !== record.hash) throw new DesktopError('CONFLICT', '文件已被修改或替换，不能撤销创建。')
          const current = await fs.lstat(source)
          if (current.isSymbolicLink() || !sameIdentity(before, current) || before.mtimeMs !== current.mtimeMs || before.ctimeMs !== current.ctimeMs) throw new DesktopError('CONFLICT', '文件在撤销过程中发生变化，未删除。')
          await fs.unlink(source)
          this.records.pop()
          // Open editor buffers survive removal and are persisted as missing-file drafts.
          await this.hooks.updatePaths(source, null)
          return entry(path.dirname(source))
        })
      }
      const destination = await canonicalInside(record.source, root, true)
      if (source !== record.destination || destination !== record.source) throw new DesktopError('CONFLICT', '目录路径已改变，不能撤销此移动。')
      return this.hooks.withDocumentLocks(source, async () => {
        if (record.nodeKind === 'directory') await moveDirectoryExclusive(source, destination, record.identity)
        else await moveExclusive(source, destination, record.identity)
        this.records.pop()
        await this.hooks.updatePaths(source, destination)
        return entry(destination)
      }, destination)
    })
  }
}
