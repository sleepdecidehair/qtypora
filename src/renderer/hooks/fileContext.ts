import type { ContextMenuAction, FileEntry, Workspace } from '../../shared/contracts'
import { filePathKey } from './workspaceFiles'

export interface FileContextDocument { id: string; path: string | null }
export interface FileContextTarget {
  origin: 'tree' | 'document'
  entry: FileEntry
  workspacePath: string | null
  documentId?: string
}

export function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (index < 0) return ''
  if (index === 0 || (index === 2 && /^[a-z]:/i.test(path))) return path.slice(0, index + 1)
  return path.slice(0, index)
}

export function isFileContextScopeCurrent(target: FileContextTarget, workspace: Workspace | null, documents: readonly FileContextDocument[]): boolean {
  if (filePathKey(target.workspacePath ?? '') !== filePathKey(workspace?.path ?? '')) return false
  if (target.origin === 'document') {
    const document = documents.find(item => item.id === target.documentId)
    return !!document?.path && filePathKey(document.path) === filePathKey(target.entry.path)
  }
  if (!workspace) return false
  const root = filePathKey(workspace.path)
  const path = filePathKey(target.entry.path)
  return path === root || path.startsWith(root + '/')
}

export function isFileContextTargetCurrent(
  target: FileContextTarget,
  workspace: Workspace | null,
  children: Record<string, FileEntry[]>,
  documents: readonly FileContextDocument[],
): boolean {
  if (!isFileContextScopeCurrent(target, workspace, documents)) return false
  if (target.origin === 'document') return true
  if (!workspace) return false
  if (filePathKey(target.entry.path) === filePathKey(workspace.path)) return target.entry.kind === 'directory'
  const cache = new Map(Object.entries(children).map(([path, entries]) => [filePathKey(path), entries]))
  const queue = [...workspace.entries]
  const seen = new Set<string>()
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index]
    const key = filePathKey(entry.path)
    if (seen.has(key)) continue
    seen.add(key)
    if (key === filePathKey(target.entry.path)) return entry.kind === target.entry.kind
    if (entry.kind === 'directory') queue.push(...(cache.get(key) ?? []))
  }
  return false
}

export function fileContextActions(target: FileContextTarget): ContextMenuAction[] {
  const actions: ContextMenuAction[] = ['file-open', 'file-new-window']
  const root = target.workspacePath === null ? null : filePathKey(target.workspacePath)
  const path = filePathKey(target.entry.path)
  const isInWorkspace = root !== null && (path === root || path.startsWith(root + '/'))
  const isWorkspaceRoot = target.entry.kind === 'directory' && target.workspacePath !== null && filePathKey(target.entry.path) === filePathKey(target.workspacePath)
  if (isInWorkspace) {
    actions.push('file-new-file', 'file-new-folder')
    if (target.entry.kind === 'file') actions.push('file-duplicate')
    if (!isWorkspaceRoot) actions.push('file-rename', 'file-trash')
  }
  actions.push('file-copy-path', 'file-reveal')
  if (isInWorkspace) actions.push('file-refresh')
  return actions
}
