import type { BrowserWindow } from 'electron'
import { invalid, string } from './errors'

interface NativeDocumentSession {
  get(id: string): { record: { path: string | null } }
}

/** Only expose paths already associated with this window's document session. */
export function setNativeDocumentState(
  platform: NodeJS.Platform,
  window: Pick<BrowserWindow, 'setRepresentedFilename' | 'setDocumentEdited'>,
  documents: NativeDocumentSession,
  input: unknown,
  edited: unknown,
): void {
  if (typeof edited !== 'boolean' || (input === null && edited)) invalid('窗口文档状态无效。')
  const path = input === null ? '' : documents.get(string(input, '文档 ID', 100)).record.path ?? ''
  if (platform !== 'darwin') return
  window.setRepresentedFilename(path)
  window.setDocumentEdited(edited)
}
