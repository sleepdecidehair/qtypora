import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from './documents'
import { hashBytes } from './files'
import { showNativeShare } from './native-share'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

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
  it('opens only the system chooser for the verified saved file and does not modify it', async () => {
    const { filename, content, documents, snapshot, chooser } = await fixture()
    await showNativeShare('darwin', documents, snapshot, () => true, chooser)
    expect(chooser).toHaveBeenCalledOnce()
    expect(chooser).toHaveBeenCalledWith(filename)
    expect(await readFile(filename, 'utf8')).toBe(content)
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
