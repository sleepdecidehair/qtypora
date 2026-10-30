import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import type { DocumentSnapshot } from '../shared/contracts'
import type { DocumentSession } from './documents'
import { DesktopError } from './errors'
import { hashBytes, MAX_DOCUMENT_BYTES, serialized } from './files'
import { withWorkspaceStructure } from './workspace-lock'

/** Validate a saved snapshot and open the system chooser. The chooser itself performs sharing. */
export async function showNativeShare(
  platform: NodeJS.Platform,
  documents: Pick<DocumentSession, 'get'>,
  snapshot: DocumentSnapshot,
  isActive: (id: string) => boolean,
  openChooser: (filePath: string) => void,
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
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES || hashBytes(await handle.readFile()) !== version) {
        throw new DesktopError('CONFLICT', '磁盘文件已改变，请重新加载或保存后再分享。')
      }
    } catch (error) {
      if (error instanceof DesktopError) throw error
      throw new DesktopError('CONFLICT', '磁盘文件不可用或已改变，请重新加载或保存后再分享。')
    } finally { await handle?.close() }
    const latest = documents.get(snapshot.id)
    if (!isActive(snapshot.id) || latest.record.path !== path || latest.record.version !== version || latest.revision !== snapshot.revision || latest.currentContent !== snapshot.content || latest.savedContent !== snapshot.content || latest.fileMissing || latest.pendingLineEnding) {
      throw new DesktopError('CONFLICT', '文档在打开分享面板前发生变化，请重试。')
    }
    openChooser(path)
  }))
}
