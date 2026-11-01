import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from './documents'
import { hashBytes } from './files'
import { cleanupStaleNativeShareSnapshots, disposeNativeShareSnapshots, disposeNativeShareSnapshotsSync, showNativeShare } from './native-share'

const roots: string[] = []
afterEach(async () => {
  await disposeNativeShareSnapshots()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'qtypora-native-share-'))
  roots.push(root)
  const filename = path.join(root, 'file.md')
  const content = '原始文档\n'
  await writeFile(filename, content)
  const state = { record: { path: filename, version: hashBytes(Buffer.from(content)) }, currentContent: content, savedContent: content as string | null, revision: 3, fileMissing: false, pendingLineEnding: undefined as 'LF' | 'CRLF' | undefined }
  const documents = { get: vi.fn((id: string) => { if (id !== 'doc') throw new Error('closed'); return state }) } as unknown as Pick<DocumentSession, 'get'>
  const snapshot = { id: 'doc', content, revision: 3 }
  const chooser = vi.fn()
  return { filename, content, state, documents, snapshot, chooser }
}

describe('native file sharing', () => {
  it('rejects an unsaved line-ending conversion', async () => {
    const { state, documents, snapshot, chooser } = await fixture()
    state.pendingLineEnding = 'CRLF'
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('未保存')
    expect(chooser).not.toHaveBeenCalled()
  })
  it('opens the system chooser for a private snapshot and does not modify the saved file', async () => {
    const { filename, content, documents, snapshot, chooser } = await fixture()
    await showNativeShare('darwin', documents, snapshot, () => true, chooser)
    expect(chooser).toHaveBeenCalledOnce()
    const shared = chooser.mock.calls[0][0]
    expect(shared).not.toBe(filename)
    expect(path.basename(shared)).toBe(path.basename(filename))
    expect(await readFile(shared, 'utf8')).toBe(content)
    await writeFile(filename, '外部替换')
    expect(await readFile(shared, 'utf8')).toBe(content)
    expect(await readFile(filename, 'utf8')).toBe('外部替换')
  })
  it('keeps an active share snapshot until deterministic shutdown cleanup', async () => {
    vi.useFakeTimers()
    const { documents, snapshot, chooser } = await fixture()
    await showNativeShare('darwin', documents, snapshot, () => true, chooser)
    const shared = chooser.mock.calls[0][0]
    vi.advanceTimersByTime(60 * 60_000)
    expect(await readFile(shared, 'utf8')).toBe(snapshot.content)
    disposeNativeShareSnapshotsSync()
    await expect(readFile(shared, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    vi.useRealTimers()
  })
  it('removes only share directories whose owning process has exited', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'qtypora-native-share-cleanup-'))
    roots.push(root)
    const deadToken = 'a'.repeat(32)
    const liveToken = 'b'.repeat(32)
    const reusedToken = 'd'.repeat(32)
    const stale = path.join(root, `qtypora-share-101-${deadToken}`)
    const recent = path.join(root, `qtypora-share-202-${liveToken}`)
    const reused = path.join(root, `qtypora-share-404-${reusedToken}`)
    const unmarked = path.join(root, `qtypora-share-303-${'c'.repeat(32)}`)
    const unrelated = path.join(root, 'other-share-Ij56Kl')
    await Promise.all([mkdir(stale), mkdir(recent), mkdir(reused), mkdir(unmarked), mkdir(unrelated)])
    await Promise.all([writeFile(path.join(stale, 'old.md'), 'old'), writeFile(path.join(recent, 'new.md'), 'new'), writeFile(path.join(reused, 'reused.md'), 'reused')])
    await Promise.all([
      writeFile(path.join(stale, '.qtypora-share.json'), JSON.stringify({ format: 1, ownerPid: 101, ownerIdentity: 'old:101', token: deadToken })),
      writeFile(path.join(recent, '.qtypora-share.json'), JSON.stringify({ format: 1, ownerPid: 202, ownerIdentity: 'start:202', token: liveToken })),
      writeFile(path.join(reused, '.qtypora-share.json'), JSON.stringify({ format: 1, ownerPid: 404, ownerIdentity: 'old:404', token: reusedToken })),
    ])
    await cleanupStaleNativeShareSnapshots(root, pid => pid === 101 ? { state: 'dead' } : { state: 'alive', value: `start:${pid}` })
    await expect(readFile(path.join(stale, 'old.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(recent, 'new.md'), 'utf8')).toBe('new')
    await expect(readFile(path.join(reused, 'reused.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(unmarked)).resolves.toBeDefined()
    await expect(stat(unrelated)).resolves.toBeDefined()
  })
  it('replaces the previous snapshot retained by the same share surface', async () => {
    const { documents, snapshot, chooser } = await fixture()
    await showNativeShare('darwin', documents, snapshot, () => true, chooser, 'window:1')
    const first = chooser.mock.calls[0][0]
    await showNativeShare('darwin', documents, snapshot, () => true, chooser, 'window:1')
    const second = chooser.mock.calls[1][0]
    expect(second).not.toBe(first)
    await expect(readFile(first, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(second, 'utf8')).toBe(snapshot.content)
  })
  it('rejects untitled, edited, stale, missing and closed documents without opening a chooser', async () => {
    const { state, documents, snapshot, chooser } = await fixture()
    state.record.path = ''
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('请先保存')
    state.record.path = '/other'
    state.currentContent += '编辑'
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('未保存')
    state.currentContent = snapshot.content
    state.revision++
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('已变化')
    state.revision--
    state.fileMissing = true
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('已变化')
    await expect(showNativeShare('darwin', documents, { ...snapshot, id: 'closed' }, () => true, chooser)).rejects.toThrow('closed')
    expect(chooser).not.toHaveBeenCalled()
  })
  it('does not share a document after the active document changes', async () => {
    const { documents, snapshot, chooser } = await fixture()
    let checks = 0
    await expect(showNativeShare('darwin', documents, snapshot, () => ++checks === 1, chooser)).rejects.toThrow('打开分享面板前')
    expect(chooser).not.toHaveBeenCalled()
  })
  it('does not follow a replacement symbolic link', async () => {
    const { filename, state, documents, snapshot, chooser } = await fixture()
    const link = filename + '.md'
    await symlink(filename, link)
    state.record.path = link
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('磁盘文件不可用')
    expect(chooser).not.toHaveBeenCalled()
  })
  it('rejects external changes, removed files and unsupported platforms', async () => {
    const { filename, documents, snapshot, chooser } = await fixture()
    await writeFile(filename, '外部修改')
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('磁盘文件已改变')
    await rm(filename)
    await expect(showNativeShare('darwin', documents, snapshot, () => true, chooser)).rejects.toThrow('磁盘文件不可用')
    await expect(showNativeShare('win32', documents, snapshot, () => true, chooser)).rejects.toThrow('仅在 macOS')
    expect(chooser).not.toHaveBeenCalled()
  })
})
