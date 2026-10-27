import { describe, expect, it } from 'vitest'
import { compareWorkspaceEntries, DEFAULT_WORKSPACE_OPTIONS, excludesSearchDirectory, isSearchDocumentInScope, matchesFileFilter, normalizeWorkspaceOptions, parseSearchExclusions } from './workspace-options'

describe('workspace display settings', () => {
  it('migrates missing settings and validates values without sharing mutable defaults', () => {
    const migrated = normalizeWorkspaceOptions()
    expect(migrated).toEqual(DEFAULT_WORKSPACE_OPTIONS)
    migrated.pinnedFolders.push('/notes')
    expect(DEFAULT_WORKSPACE_OPTIONS.pinnedFolders).toEqual([])
    expect(() => normalizeWorkspaceOptions({ showHidden: 'true' })).toThrow()
    expect(() => normalizeWorkspaceOptions({ sort: ['natural'] })).toThrow()
    expect(() => normalizeWorkspaceOptions({ pinnedFolders: ['relative'] })).toThrow()
    expect(normalizeWorkspaceOptions({ pinnedFolders: ['/notes', '/notes'] }).pinnedFolders).toEqual(['/notes'])
  })
  it('filters wildcard inclusions and exclusions without interpreting regex syntax', () => {
    expect(matchesFileFilter('note.md', '*.md,!draft*')).toBe(true)
    expect(matchesFileFilter('draft-note.md', '*.md,!draft*')).toBe(false)
    expect(matchesFileFilter('Readme.TXT', '*.md,*.txt')).toBe(true)
    expect(matchesFileFilter('a[1].md', '[1]')).toBe(true)
    expect(matchesFileFilter('ab.txt', 'a?.txt')).toBe(true)
  })
  it('validates relative directory exclusions and matches names or wildcard paths', () => {
    const patterns = parseSearchExclusions('cache, projects/*/generated, drafts/')
    expect(patterns).toEqual(['cache', 'projects/*/generated', 'drafts'])
    expect(excludesSearchDirectory('deep/CACHE', patterns)).toBe(true)
    expect(excludesSearchDirectory('projects/one/generated', patterns)).toBe(true)
    expect(excludesSearchDirectory('projects/one/source', patterns)).toBe(false)
    expect(isSearchDocumentInScope('/notes', '/notes/projects/one/generated/file.md', 'projects/*/generated')).toBe(false)
    expect(isSearchDocumentInScope('/notes', '/notes/projects/one/source/file.md', 'projects/*/generated')).toBe(true)
    expect(isSearchDocumentInScope('/notes', '/notes-elsewhere/file.md', '')).toBe(false)
    expect(isSearchDocumentInScope('C:\\notes', 'C:\\notes\\cache\\file.md', 'cache')).toBe(false)
    expect(normalizeWorkspaceOptions({ searchExclude: 'cache' }).searchExclude).toBe('cache')
    for (const value of ['/absolute', '../outside', 'a/../b', 'C:\\outside', 'x\0y', 'x'.repeat(257)]) expect(() => parseSearchExclusions(value)).toThrow()
  })
  it('sorts naturally, by timestamps and in reverse while preserving folder grouping', () => {
    const first = { name: '2.md', kind: 'file' as const, modifiedAt: 10, createdAt: 2 }
    const second = { name: '10.md', kind: 'file' as const, modifiedAt: 5, createdAt: 4 }
    expect(compareWorkspaceEntries(first, second, DEFAULT_WORKSPACE_OPTIONS)).toBeLessThan(0)
    expect(compareWorkspaceEntries(first, second, { ...DEFAULT_WORKSPACE_OPTIONS, sort: 'modified' })).toBeGreaterThan(0)
    expect(compareWorkspaceEntries(first, second, { ...DEFAULT_WORKSPACE_OPTIONS, sort: 'created' })).toBeLessThan(0)
    expect(compareWorkspaceEntries({ ...first, kind: 'directory' }, second, { ...DEFAULT_WORKSPACE_OPTIONS, descending: true })).toBeLessThan(0)
  })
})
