import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import path from 'node:path'
import { DesktopError } from './errors'
import { readFileSnapshot, type FileIdentity } from './file-snapshot'
import { hashBytes, MAX_DOCUMENT_BYTES } from './files'

/** Paths and identifiers from the provider never cross the renderer boundary. */
export interface NativeVersionEntry { identifier: string; modifiedAt: string; path: string }
export interface NativeVersionProvider { list(filePath: string): Promise<NativeVersionEntry[]> }
export interface VersionDocumentContext { id: string; path: string | null; version: string | null; revision: number; content: string; fileMissing: boolean; identity: FileIdentity | null }
export interface VersionSummary { token: string; modifiedAt: string }
interface VersionGrant { context: VersionDocumentContext; identity: FileIdentity; entry: NativeVersionEntry }

const unchanged = (a: VersionDocumentContext, b: VersionDocumentContext): boolean =>
  a.id === b.id && a.path === b.path && a.version === b.version && a.revision === b.revision && a.content === b.content && a.fileMissing === b.fileMissing && a.identity?.dev === b.identity?.dev && a.identity?.ino === b.identity?.ino

function validateEntries(entries: NativeVersionEntry[]): void {
  if (!Array.isArray(entries) || entries.length > 500) throw new DesktopError('IO_ERROR', '系统版本信息无效。')
  const identifiers = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry.identifier !== 'string' || !entry.identifier || entry.identifier.length > 4096 || identifiers.has(entry.identifier) || typeof entry.path !== 'string' || !entry.path.startsWith('/') || entry.path.includes('\0') || typeof entry.modifiedAt !== 'string' || !Number.isFinite(Date.parse(entry.modifiedAt))) throw new DesktopError('IO_ERROR', '系统版本信息无效。')
    identifiers.add(entry.identifier)
  }
}

/** Read-only, per-window grants. This does not restore or create system versions. */
export class SystemVersionHistory {
  private readonly grants = new Map<string, VersionGrant>()
  constructor(private readonly getDocument: (id: string) => VersionDocumentContext, private readonly provider: NativeVersionProvider) {}

  private async current(context: VersionDocumentContext, expected?: FileIdentity): Promise<FileIdentity> {
    if (!context.path || !path.isAbsolute(context.path) || context.path.includes('\0') || !context.version || !context.identity || !Number.isSafeInteger(context.identity.dev) || !Number.isSafeInteger(context.identity.ino) || context.fileMissing) throw new DesktopError('CONFLICT', '当前文档没有可验证的磁盘文件。')
    const file = await readFileSnapshot(context.path, MAX_DOCUMENT_BYTES, expected ?? context.identity)
    if (hashBytes(file.bytes) !== context.version || !unchanged(context, this.getDocument(context.id))) throw new DesktopError('CONFLICT', '文档或磁盘文件已变化，请重新查看版本历史。')
    return { dev: file.stat.dev, ino: file.stat.ino }
  }

  async list(id: string): Promise<VersionSummary[]> {
    const context = { ...this.getDocument(id) }
    if (context.id !== id) throw new DesktopError('CONFLICT', '文档状态已变化。')
    const identity = await this.current(context)
    const entries = await this.provider.list(context.path!)
    validateEntries(entries)
    await this.current(context, identity)
    for (const [token, grant] of this.grants) if (grant.context.id === id) this.grants.delete(token)
    return entries.map(entry => {
      const token = randomUUID()
      this.grants.set(token, { context, identity, entry: { ...entry } })
      if (this.grants.size > 2000) this.grants.delete(this.grants.keys().next().value!)
      return { token, modifiedAt: entry.modifiedAt }
    })
  }

  async read(id: string, token: string): Promise<Buffer> {
    const grant = this.grants.get(token)
    if (!grant || grant.context.id !== id) throw new DesktopError('NOT_FOUND', '版本已失效，请重新查看版本历史。')
    await this.current(grant.context, grant.identity)
    const entries = await this.provider.list(grant.context.path!)
    validateEntries(entries)
    const matching = entries.filter(entry => entry.identifier === grant.entry.identifier && entry.path === grant.entry.path && entry.modifiedAt === grant.entry.modifiedAt)
    if (matching.length !== 1) throw new DesktopError('CONFLICT', '系统版本已变化，请重新查看版本历史。')
    const file = await readFileSnapshot(matching[0].path, MAX_DOCUMENT_BYTES)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
      if (text.includes('\0')) throw new Error('binary')
    } catch { throw new DesktopError('UNSUPPORTED', '历史版本不是有效 UTF-8 文本。') }
    const latest = await this.provider.list(grant.context.path!)
    validateEntries(latest)
    if (latest.filter(entry => entry.identifier === grant.entry.identifier && entry.path === grant.entry.path && entry.modifiedAt === grant.entry.modifiedAt).length !== 1) throw new DesktopError('CONFLICT', '系统版本已变化，请重新查看版本历史。')
    await this.current(grant.context, grant.identity)
    return file.bytes
  }

  dispose(): void { this.grants.clear() }
}
