import { useEffect, useRef } from 'react'
import type { DesktopApi, FileEntry, Workspace } from '../../shared/contracts'
import type { PendingFileAction } from '../components/FileActionDialog'
import type { EditorDocument } from './useDocuments'
import { fileContextActions, isFileContextTargetCurrent, parentDirectory, type FileContextTarget } from './fileContext'
import { filePathKey } from './workspaceFiles'

interface FileContextMenuOptions {
  api: DesktopApi
  workspace: Workspace | null
  documents: EditorDocument[]
  getChildren: () => Record<string, FileEntry[]>
  onOpen: (path: string) => void
  onOpenFolder: (path?: string) => void
  onFileAction: (action: PendingFileAction) => void
  onError: (message: string) => void
  onRefresh: () => void
}

export function useFileContextMenu(options: FileContextMenuOptions) {
  const latest = useRef(options)
  latest.current = options
  const mounted = useRef(true)
  const requestId = useRef(0)
  const scope = useRef({ path: filePathKey(options.workspace?.path ?? ''), revision: 0 })
  const path = filePathKey(options.workspace?.path ?? '')
  if (scope.current.path !== path) scope.current = { path, revision: scope.current.revision + 1 }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++ } }, [])

  return async (entry: FileEntry, documentId?: string) => {
    const initial = latest.current
    const target: FileContextTarget = {
      origin: documentId ? 'document' : 'tree', entry: { ...entry },
      workspacePath: initial.workspace?.path ?? null, documentId,
    }
    const token = ++requestId.current
    const revision = scope.current.revision
    const inScope = () => mounted.current && requestId.current === token && scope.current.revision === revision
    const isCurrent = () => inScope() && isFileContextTargetCurrent(target, latest.current.workspace, latest.current.getChildren(), latest.current.documents)
    if (!isCurrent()) return
    const availableActions = fileContextActions(target)
    const readOnly = initial.documents.some(document => document.path && filePathKey(document.path) === filePathKey(entry.path) && document.readOnly)
    try {
      const result = await initial.api.showContextMenu({ kind: entry.kind === 'directory' ? 'folder' : 'file', readOnly, hasSelection: true, availableActions })
      if (!isCurrent()) return
      if (!result.ok) { latest.current.onError(result.error.message); return }
      const action = result.data
      if (!action || !availableActions.includes(action)) return
      const handlers = latest.current
      const targetPath = target.entry.path
      const createPath = target.entry.kind === 'directory' ? targetPath : parentDirectory(targetPath)
      switch (action) {
        case 'file-open':
          if (target.entry.kind === 'directory') handlers.onOpenFolder(targetPath)
          else handlers.onOpen(targetPath)
          return
        case 'file-new-file':
        case 'file-new-folder':
        case 'file-rename':
          handlers.onFileAction({
            action: action === 'file-rename' ? 'rename' : action === 'file-new-file' ? 'create-file' : 'create-folder',
            path: action === 'file-rename' ? targetPath : createPath,
            name: target.entry.name, isDirectory: target.entry.kind === 'directory', contextTarget: target,
          })
          return
        case 'file-new-window': {
          const response = await handlers.api.newWindow(targetPath)
          if (!response.ok && inScope()) latest.current.onError(response.error.message)
          return
        }
        case 'file-copy-path': {
          const response = await handlers.api.writeClipboard({ text: targetPath })
          if (!response.ok && inScope()) latest.current.onError(response.error.message)
          return
        }
        case 'file-reveal': {
          const response = await handlers.api.revealFile(targetPath)
          if (!response.ok && inScope()) latest.current.onError(response.error.message)
          return
        }
        case 'file-refresh': handlers.onRefresh(); return
        case 'file-duplicate':
        case 'file-trash': {
          const response = await handlers.api.fileAction({ action: action === 'file-duplicate' ? 'duplicate' : 'trash', path: targetPath })
          if (!inScope()) return
          if (!response.ok) latest.current.onError(response.error.message)
          else if (response.data) latest.current.onRefresh()
          return
        }
      }
    } catch (error) {
      if (inScope()) latest.current.onError(error instanceof Error ? error.message : '文件菜单操作失败')
    }
  }
}
