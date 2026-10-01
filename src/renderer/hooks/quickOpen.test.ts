import { describe, expect, it } from 'vitest'
import { filterQuickOpenItems, quickOpenItems } from './quickOpen'

describe('quick open candidates', () => {
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
