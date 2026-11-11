import { describe, expect, it } from 'vitest'
import { filterQuickOpenItems, quickOpenItems } from './quickOpen'

describe('quick open candidates', () => {
  it('keeps pinned folders distinct from documents and files while deduplicating folder spellings', () => {
    const items = quickOpenItems([{ id: 'note', name: 'Notes.md', path: null, isDirty: true }], ['C:/work/Notes.md'], [], { pinnedFolders: ['C:\\work\\Notes', 'c:/WORK/notes/', 'C:/work/Nested'] })
    expect(items.map(item => item.kind)).toEqual(['document', 'folder', 'folder', 'file'])
    expect(items.filter(item => item.kind === 'folder')).toEqual([
      { kind: 'folder', key: 'folder:c:/work/notes', name: 'Notes', path: 'C:\\work\\Notes', scope: 'pinned' },
      { kind: 'folder', key: 'folder:c:/work/nested', name: 'Nested', path: 'C:/work/Nested', scope: 'pinned' },
    ])
    expect(filterQuickOpenItems(items, 'notes')[0]?.kind).toBe('folder')
    expect(filterQuickOpenItems(items, 'work nst').map(item => item.name)).toEqual(['Nested'])
  })

  it('includes pins when no workspace is open and retains directory names with Markdown extensions', () => {
    expect(quickOpenItems([], [], [], { pinnedFolders: ['C:/Notes.md'] })).toEqual([{ kind: 'folder', key: 'folder:c:/notes.md', name: 'Notes.md', path: 'C:/Notes.md', scope: 'pinned' }])
  })

  it('includes recent folders while giving an existing pin precedence', () => {
    const items = quickOpenItems([], [], [], { pinnedFolders: ['C:/Notes'], recentFolders: ['c:\\notes', 'C:/Other'] })
    expect(items.map(item => ({ kind: item.kind, path: item.path, scope: item.scope }))).toEqual([
      { kind: 'folder', path: 'C:/Notes', scope: 'pinned' },
      { kind: 'folder', path: 'C:/Other', scope: 'recent' },
    ])
    expect(quickOpenItems([], [], [], { pinnedFolders: [], recentFolders: ['C:/Notes'] })).toEqual([
      { kind: 'folder', key: 'folder:c:/notes', name: 'Notes', path: 'C:/Notes', scope: 'recent' },
    ])
  })

  it('deduplicates Windows paths across opened buffers, recent files and workspace files', () => {
    const items = quickOpenItems([{ id: 'opened', name: 'Article.md', path: 'C:\\Work\\Article.md', isDirty: true }], ['c:/work/ARTICLE.md', 'C:/work/recent.txt'], [
      { name: 'Article.md', path: 'C:/WORK/Article.md', kind: 'file', modifiedAt: 0 },
      { name: 'Recent.txt', path: 'c:\\work\\recent.txt', kind: 'file', modifiedAt: 0 },
      { name: 'Nested.md', path: 'C:/work/sub/Nested.md', kind: 'file', modifiedAt: 0 },
    ])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ id: 'opened', isDirty: true, scope: 'open' })
  })

  it('retains separately identifiable unsaved buffers', () => {
    expect(quickOpenItems([{ id: '1', name: '未命名.md', path: null, isDirty: true }, { id: '2', name: '未命名.md', path: null, isDirty: true }], [], [])).toHaveLength(2)
  })

  it('ranks exact filenames before fuzzy matches and evaluates the latest query', () => {
    const items = quickOpenItems([], ['C:/work/Article.md', 'C:/work/Another_long_title.md', 'C:/work/Beta.md'], [])
    expect(filterQuickOpenItems(items, 'article')[0]?.name).toBe('Article.md')
    expect(filterQuickOpenItems(items, 'alt').map(item => item.name)).toContain('Another_long_title.md')
    expect(filterQuickOpenItems(items, 'Beta').map(item => item.name)).toEqual(['Beta.md'])
  })
})
