import type { FileEntry } from '../../shared/contracts'
import { filePathKey } from './workspaceFiles'

export interface VisibleTreeEntry { entry: FileEntry; depth: number; parentPath: string | null }
export interface FileTreeState { expanded: Set<string>; children: Record<string, FileEntry[]>; selected: FileEntry | null }

export function reconcileFileTree(root: FileEntry[], state: FileTreeState): FileTreeState {
  const reachable = new Map<string, FileEntry>()
  const directories = new Set<string>()
  const cache = new Map(Object.entries(state.children).map(([path, entries]) => [filePathKey(path), entries]))
  const queue = [...root]
  while (queue.length) {
    const entry = queue.shift()!
    const key = filePathKey(entry.path)
    if (reachable.has(key)) continue
    reachable.set(key, entry)
    if (entry.kind !== 'directory') continue
    directories.add(key)
    queue.push(...(cache.get(key) ?? []))
  }
  const expanded = new Set([...state.expanded].filter(path => directories.has(filePathKey(path))).map(path => reachable.get(filePathKey(path))!.path))
  const children = Object.fromEntries(Object.entries(state.children).filter(([path]) => directories.has(filePathKey(path))).map(([path, entries]) => [reachable.get(filePathKey(path))!.path, entries]))
  const selected = state.selected ? reachable.get(filePathKey(state.selected.path)) ?? null : null
  return { expanded, children, selected }
}

export function visibleFileTree(root: FileEntry[], children: Record<string, FileEntry[]>, expanded: Set<string>, limit = 3000): { rows: VisibleTreeEntry[]; isTruncated: boolean } {
  const rows: VisibleTreeEntry[] = []
  const seen = new Set<string>()
  let isTruncated = false
  const visit = (entries: FileEntry[], depth: number, parentPath: string | null) => {
    if (entries.length > 500) isTruncated = true
    for (const entry of entries.slice(0, 500)) {
      if (rows.length >= limit) { isTruncated = true; return }
      const key = filePathKey(entry.path)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ entry, depth, parentPath })
      if (entry.kind === 'directory' && expanded.has(entry.path)) visit(children[entry.path] ?? [], depth + 1, entry.path)
    }
  }
  visit(root, 0, null)
  return { rows, isTruncated }
}

export function treeKeyboardTarget(rows: VisibleTreeEntry[], path: string, key: string): string | null {
  const index = rows.findIndex(row => filePathKey(row.entry.path) === filePathKey(path))
  if (index < 0) return null
  if (key === 'ArrowUp') return rows[Math.max(0, index - 1)]?.entry.path ?? null
  if (key === 'ArrowDown') return rows[Math.min(rows.length - 1, index + 1)]?.entry.path ?? null
  if (key === 'Home') return rows[0]?.entry.path ?? null
  if (key === 'End') return rows[rows.length - 1]?.entry.path ?? null
  if (key === 'ArrowLeft') return rows[index].parentPath
  if (key === 'ArrowRight' && rows[index + 1]?.parentPath === rows[index].entry.path) return rows[index + 1].entry.path
  return null
}
