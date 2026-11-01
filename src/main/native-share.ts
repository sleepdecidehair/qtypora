import * as fs from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { DocumentSnapshot } from '../shared/contracts'
import type { DocumentSession } from './documents'
import { DesktopError } from './errors'
import { hashBytes, MAX_DOCUMENT_BYTES, serialized } from './files'
import { readFileSnapshot } from './file-snapshot'
import { withWorkspaceStructure } from './workspace-lock'

const SHARE_SNAPSHOT_PATTERN = /^qtypora-share-(\d+)-([a-f0-9]{32})$/
const SHARE_SNAPSHOT_MARKER = '.qtypora-share.json'
const shareSnapshotDirectories = new Set<string>()
const shareSnapshotSlots = new Map<string, string>()

type ProcessIdentity = { state: 'alive'; value: string } | { state: 'dead' | 'unknown' }

function processIdentity(pid: number): ProcessIdentity {
  if (process.platform === 'darwin') {
    const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 })
    const value = result.status === 0 ? result.stdout.trim() : ''
    if (value) return { state: 'alive', value }
    return result.error ? { state: 'unknown' } : { state: 'dead' }
  }
  try { process.kill(pid, 0); return { state: 'alive', value: `pid:${pid}` } }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? { state: 'dead' } : { state: 'unknown' } }
}

const shareOwnerIdentity = processIdentity(process.pid)

async function removeShareSnapshot(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true })
  shareSnapshotDirectories.delete(directory)
  for (const [slot, retained] of shareSnapshotSlots) if (retained === directory) shareSnapshotSlots.delete(slot)
}

async function retainShareSnapshot(directory: string, slot: string): Promise<void> {
  const previous = shareSnapshotSlots.get(slot)
  shareSnapshotDirectories.add(directory)
  shareSnapshotSlots.set(slot, directory)
  if (previous && previous !== directory) {
    try { await removeShareSnapshot(previous) }
    catch { /* Keep the failed deletion tracked for shutdown cleanup. */ }
  }
}

export async function disposeNativeShareSnapshots(): Promise<void> {
  await Promise.allSettled([...shareSnapshotDirectories].map(removeShareSnapshot))
}

/** Remove snapshots whose owning process has exited without touching a concurrently running instance. */
export async function cleanupStaleNativeShareSnapshots(root = os.tmpdir(), identityFor: (pid: number) => ProcessIdentity = processIdentity): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(root, { withFileTypes: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await Promise.allSettled(entries.filter(entry => entry.isDirectory() && SHARE_SNAPSHOT_PATTERN.test(entry.name)).map(async entry => {
    const match = SHARE_SNAPSHOT_PATTERN.exec(entry.name)
    const owner = Number(match?.[1])
    if (!Number.isSafeInteger(owner) || owner < 1) return
    const directory = path.join(root, entry.name)
    const markerPath = path.join(directory, SHARE_SNAPSHOT_MARKER)
    const markerStat = await fs.lstat(markerPath)
    if (!markerStat.isFile()) return
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as { format?: unknown; ownerPid?: unknown; ownerIdentity?: unknown; token?: unknown }
    if (marker.format !== 1 || marker.ownerPid !== owner || typeof marker.ownerIdentity !== 'string' || marker.token !== match?.[2]) return
    const current = identityFor(owner)
    if (current.state === 'unknown' || (current.state === 'alive' && current.value === marker.ownerIdentity)) return
    await fs.rm(directory, { recursive: true, force: true })
  }))
}

/** `will-quit` cannot await promises, so delete only the exact directories tracked by this process synchronously. */
export function disposeNativeShareSnapshotsSync(): void {
  for (const directory of shareSnapshotDirectories) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
      shareSnapshotDirectories.delete(directory)
      for (const [slot, retained] of shareSnapshotSlots) if (retained === directory) shareSnapshotSlots.delete(slot)
    }
    catch { /* A later startup sweep handles an OS-level deletion failure. */ }
  }
}

export function disposeNativeShareSlotSync(slot: string): void {
  const directory = shareSnapshotSlots.get(slot)
  if (!directory) return
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
    shareSnapshotDirectories.delete(directory)
  } catch { /* Keep the directory tracked for final shutdown cleanup. */ }
  shareSnapshotSlots.delete(slot)
}

async function createShareSnapshot(source: string, bytes: Buffer): Promise<{ directory: string; filename: string }> {
  const token = randomUUID().replaceAll('-', '')
  const directory = path.join(os.tmpdir(), `qtypora-share-${process.pid}-${token}`)
  await fs.mkdir(directory, { mode: 0o700 })
  shareSnapshotDirectories.add(directory)
  try {
    if (shareOwnerIdentity.state !== 'alive') throw new Error('无法确认分享进程身份。')
    await fs.chmod(directory, 0o700)
    await fs.writeFile(path.join(directory, SHARE_SNAPSHOT_MARKER), JSON.stringify({ format: 1, ownerPid: process.pid, ownerIdentity: shareOwnerIdentity.value, token }), { flag: 'wx', mode: 0o600 })
    const filename = path.join(directory, path.basename(source))
    await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 })
    return { directory, filename }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    shareSnapshotDirectories.delete(directory)
    throw error
  }
}

/** Validate a saved snapshot and open the system chooser. The chooser itself performs sharing. */
export async function showNativeShare(
  platform: NodeJS.Platform,
  documents: Pick<DocumentSession, 'get'>,
  snapshot: DocumentSnapshot,
  isActive: (id: string) => boolean,
  openChooser: (filePath: string) => void,
  shareSlot = snapshot.id,
): Promise<void> {
  if (platform !== 'darwin') throw new DesktopError('UNSUPPORTED', '系统分享仅在 macOS 上可用。')
  await withWorkspaceStructure(() => serialized('save-document:' + snapshot.id, async () => {
    if (!isActive(snapshot.id)) throw new DesktopError('CONFLICT', '当前文档已切换，请重试分享。')
    const current = documents.get(snapshot.id)
    const { path, version } = current.record
    if (!path || !version || current.savedContent === null) throw new DesktopError('INVALID_INPUT', '请先保存文档，再使用系统分享。')
    if (current.fileMissing || current.pendingLineEnding || current.savedContent !== snapshot.content || current.currentContent !== snapshot.content || current.revision !== snapshot.revision) {
      throw new DesktopError('CONFLICT', '文档有未保存的修改或已变化，请先保存后再分享。')
    }
    let shareSnapshot: { directory: string; filename: string } | undefined
    try {
      const { bytes } = await readFileSnapshot(path, MAX_DOCUMENT_BYTES)
      if (hashBytes(bytes) !== version) throw new DesktopError('CONFLICT', '磁盘文件已改变，请重新加载或保存后再分享。')
      shareSnapshot = await createShareSnapshot(path, bytes)
    } catch (error) {
      if (error instanceof DesktopError && error.message.startsWith('磁盘文件已改变')) throw error
      throw new DesktopError('CONFLICT', '磁盘文件不可用或已改变，请重新加载或保存后再分享。')
    }
    let retained = false
    try {
      const latest = documents.get(snapshot.id)
      if (!isActive(snapshot.id) || latest.record.path !== path || latest.record.version !== version || latest.revision !== snapshot.revision || latest.currentContent !== snapshot.content || latest.savedContent !== snapshot.content || latest.fileMissing || latest.pendingLineEnding) {
        throw new DesktopError('CONFLICT', '文档在打开分享面板前发生变化，请重试。')
      }
      openChooser(shareSnapshot.filename)
      await retainShareSnapshot(shareSnapshot.directory, shareSlot)
      retained = true
    } finally { if (!retained) await removeShareSnapshot(shareSnapshot.directory) }
  }))
}
