import { describe, expect, it } from 'vitest'
import type { FileEntry, Result } from '../../shared/contracts'
import { indexWorkspaceFiles } from './workspaceFiles'

const file = (name: string, path: string): FileEntry => ({ name, path, kind: 'file', modifiedAt: 0 })
const folder = (name: string, path: string): FileEntry => ({ name, path, kind: 'directory', modifiedAt: 0 })

describe('bounded workspace file indexing', () => {
  it('finds nested filenames and visits a repeated directory only once', async () => {
    const calls: string[] = []
    const directories: Record<string, FileEntry[]> = {
      'C:/work': [folder('nested', 'C:/work/nested'), file('top.md', 'C:/work/top.md')],
      'C:/work/nested': [folder('cycle', 'C:/WORK'), file('deep.txt', 'C:/work/nested/deep.txt')],
    }
    const result = await indexWorkspaceFiles(async path => { calls.push(path); return { ok: true, data: directories[path] } }, 'C:/work')
    expect(calls).toEqual(['C:/work', 'C:/work/nested'])
    expect(result.files.map(item => item.name)).toEqual(['top.md', 'deep.txt'])
    expect(result.isTruncated).toBe(false)
  })

  it('reports a directory failure while preserving other matches', async () => {
    const result = await indexWorkspaceFiles(async path => path === 'root'
      ? { ok: true, data: [file('ok.md', 'root/ok.md'), folder('denied', 'root/denied')] }
      : { ok: false, error: { code: 'PERMISSION_DENIED', message: '无法访问' } }, 'root')
    expect(result.files).toHaveLength(1)
    expect(result.errors[0]).toContain('无法访问')
  })

  it('explicitly marks a directory bound as partial', async () => {
    const result = await indexWorkspaceFiles(async () => ({ ok: true, data: [folder('sub', 'root/sub')] }), 'root', { limits: { directories: 1, files: 20, entries: 20 } })
    expect(result.directories).toBe(1)
    expect(result.isTruncated).toBe(true)
  })

  it('never indexes files beyond the file count limit', async () => {
    const result = await indexWorkspaceFiles(async () => ({ ok: true, data: [file('a.md', 'root/a.md'), file('b.md', 'root/b.md')] }), 'root', { limits: { directories: 20, files: 1, entries: 20 } })
    expect(result.files.map(item => item.name)).toEqual(['a.md'])
    expect(result.isTruncated).toBe(true)
  })

  it('discards a delayed workspace response after cancellation', async () => {
    let release: ((result: Result<FileEntry[]>) => void) | undefined
    let cancelled = false
    const pending = indexWorkspaceFiles(() => new Promise(resolve => { release = resolve }), 'root', { isCancelled: () => cancelled })
    cancelled = true
    release?.({ ok: true, data: [file('stale.md', 'root/stale.md')] })
    const result = await pending
    expect(result.isCancelled).toBe(true)
    expect(result.files).toEqual([])
  })
})
