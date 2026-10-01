import { describe, expect, it } from 'vitest'
import type { FileEntry } from '../../shared/contracts'
import { reconcileFileTree, treeKeyboardTarget, visibleFileTree } from './fileTree'

const folder: FileEntry = { name: 'sub', path: 'root/sub', kind: 'directory', modifiedAt: 0 }
const child: FileEntry = { name: 'child.md', path: 'root/sub/child.md', kind: 'file', modifiedAt: 0 }
const next: FileEntry = { name: 'next.md', path: 'root/next.md', kind: 'file', modifiedAt: 0 }

describe('file tree state and keyboard navigation', () => {
  it('keeps a surviving expansion and selected file after metadata refresh', () => {
    const refreshed = { ...child, modifiedAt: 100 }
    const result = reconcileFileTree([folder, next], { expanded: new Set([folder.path]), children: { [folder.path]: [refreshed] }, selected: child })
    expect([...result.expanded]).toEqual([folder.path])
    expect(result.selected).toEqual(refreshed)
  })

  it('prunes deleted folders together with their cache and selected descendants', () => {
    const result = reconcileFileTree([next], { expanded: new Set([folder.path]), children: { [folder.path]: [child] }, selected: child })
    expect(result.children).toEqual({})
    expect(result.expanded.size).toBe(0)
    expect(result.selected).toBeNull()
  })

  it('clears a deleted child while keeping the expanded parent', () => {
    const result = reconcileFileTree([folder], { expanded: new Set([folder.path]), children: { [folder.path]: [] }, selected: child })
    expect(result.selected).toBeNull()
    expect(result.expanded.has(folder.path)).toBe(true)
  })

  it('navigates visible depth-first rows without entering a collapsed directory', () => {
    const rows = visibleFileTree([folder, next], { [folder.path]: [child] }, new Set([folder.path])).rows
    expect(treeKeyboardTarget(rows, folder.path, 'ArrowRight')).toBe(child.path)
    expect(treeKeyboardTarget(rows, child.path, 'ArrowLeft')).toBe(folder.path)
    expect(treeKeyboardTarget(rows, child.path, 'ArrowDown')).toBe(next.path)
    expect(treeKeyboardTarget(rows, next.path, 'ArrowUp')).toBe(child.path)
    expect(visibleFileTree([folder, next], { [folder.path]: [child] }, new Set()).rows.map(row => row.entry.path)).toEqual([folder.path, next.path])
  })

  it('marks a limited visible tree as partial', () => {
    const result = visibleFileTree([folder, next], { [folder.path]: [child] }, new Set([folder.path]), 2)
    expect(result.rows).toHaveLength(2)
    expect(result.isTruncated).toBe(true)
  })
})
