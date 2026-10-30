import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDirectory, MAX_DOCUMENT_BYTES, searchMarkdown, searchMarkdownDetailed } from './files'
import { DEFAULT_WORKSPACE_OPTIONS } from '../shared/workspace-options'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-workspace-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('workspace file list and search', () => {
  it('shows hidden and non-markdown files only when enabled and applies file filters', async () => {
    await Promise.all(['2.md', '10.md', '.hidden.md', 'pic.png'].map(name => fs.writeFile(path.join(root, name), 'data')))
    await fs.mkdir(path.join(root, 'folder'))
    expect((await listDirectory(root)).map(item => item.name)).toEqual(['folder', '2.md', '10.md'])
    expect((await listDirectory(root, { ...DEFAULT_WORKSPACE_OPTIONS, showAllFiles: true, showHidden: true })).map(item => item.name)).toContain('pic.png')
    expect((await listDirectory(root, { ...DEFAULT_WORKSPACE_OPTIONS, showHidden: true, filter: '*.md,!10*' })).map(item => item.name)).toEqual(['folder', '.hidden.md', '2.md'])
  })
  it('searches whole words, regex and case while retaining late excerpts', async () => {
    await fs.writeFile(path.join(root, 'notes.md'), `cat scatter CAT\nTASK-12\n${'prefix '.repeat(400)}TASK-99\n`)
    expect((await searchMarkdown({ root, query: 'cat', wholeWord: true })).map(hit => hit.line)).toEqual([1])
    expect((await searchMarkdown({ root, query: 'TASK-\\d+', regex: true, caseSensitive: true })).map(hit => hit.line)).toEqual([2, 3])
    const last = (await searchMarkdown({ root, query: 'TASK-99' }))[0]
    expect(last.text).toContain('TASK-99')
    expect(last.text.length).toBeLessThan(2002)
    await expect(searchMarkdown({ root, query: '(', regex: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('prunes excluded directory names and relative wildcard paths before searching', async () => {
    const files = ['visible.md', 'cache/hidden.md', 'projects/one/generated/hidden.md', 'projects/one/source/visible.md', 'other/cache/hidden.md']
    for (const name of files) {
      const target = path.join(root, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, 'needle\n')
    }
    const result = await searchMarkdown({ root, query: 'needle', excludeDirectories: 'cache,projects/*/generated' })
    expect(result.map(hit => path.relative(root, hit.path)).sort()).toEqual(['projects/one/source/visible.md', 'visible.md'])
    await expect(searchMarkdown({ root, query: 'needle', excludeDirectories: '../outside' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('searches deeply nested files and reports size or result limits', async () => {
    const large = await fs.open(path.join(root, 'large.md'), 'w')
    try { await large.truncate(MAX_DOCUMENT_BYTES + 1) } finally { await large.close() }
    let deep = root
    for (let i = 0; i < 25; i++) { deep = path.join(deep, `d${i}`); await fs.mkdir(deep) }
    await fs.writeFile(path.join(deep, 'hidden.md'), 'needle')
    await fs.writeFile(path.join(root, 'many.md'), 'needle\n'.repeat(1001))
    const detailed = await searchMarkdownDetailed({ root, query: 'needle' })
    expect(detailed.hits).toHaveLength(1000)
    expect(detailed.hits[0].path).toBe(path.join(deep, 'hidden.md'))
    expect(detailed.limitations).toEqual({ resultLimit: true, entryLimit: false, oversizedFiles: 1 })
    expect((await searchMarkdownDetailed({ root, query: 'needle', excludeDirectories: 'd0' })).hits.some(hit => hit.path === path.join(deep, 'hidden.md'))).toBe(false)
  })
  it('does not report limitations when all eligible files were searched', async () => {
    await fs.writeFile(path.join(root, 'notes.md'), 'needle\n')
    const result = await searchMarkdownDetailed({ root, query: 'needle' })
    expect(result.hits).toHaveLength(1)
    expect(result.limitations).toEqual({ resultLimit: false, entryLimit: false, oversizedFiles: 0 })
  })
})
