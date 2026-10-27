import { test, expect, type Page } from '@playwright/test'
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, setOpenDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

async function openWorkspace(directory: string): Promise<void> {
  await setOpenDialog(session, [directory])
  await session.page.getByTestId('export-menu').click()
  await session.page.getByTestId('open-folder').click()
  await session.page.getByTestId('files-tab').click()
  await expect(session.page.getByTestId('workspace-folder')).toContainText(path.basename(directory))
}

async function editorSource(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())
}

async function append(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(text)
}

test('目录移动和撤销跨窗口保留脏稿、资源与磁盘原字节', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '仅 macOS 和 Windows 有独占目录重命名原生桥')
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, 'source'), target = path.join(workspace, 'target')
  await mkdir(path.join(source, 'nested'), { recursive: true }); await mkdir(target)
  const original = '\ufeff# Folder note\r\n\r\n![image](pixel.png)\r\n'
  const oldDocument = path.join(source, 'nested', 'note.md'), newDocument = path.join(target, 'source', 'nested', 'note.md')
  await writeFile(oldDocument, original)
  await writeFile(path.join(source, 'nested', 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVj8AAAAASUVORK5CYII=', 'base64'))
  const canonicalDocument = await realpath(oldDocument)
  await openWorkspace(workspace)
  await session.page.getByRole('treeitem', { name: 'source', exact: true }).click()
  await session.page.getByRole('treeitem', { name: 'nested', exact: true }).click()
  await session.page.getByRole('treeitem', { name: 'note.md', exact: true }).click()
  await expect(session.page.getByTestId('document-name')).toHaveText('note.md')
  await append(session.page, ' first-unsaved')
  const firstContent = await editorSource(session.page)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(path => window.desktop.newWindow(path), oldDocument)
  const second = await opening
  second.on('pageerror', error => session.errors.push(error.message))
  await expect(second.getByTestId('document-name')).toHaveText('note.md')
  await second.getByTestId('files-tab').click()
  await append(second, ' second-unsaved')
  const secondContent = await editorSource(second)
  for (const [page, expected] of [[session.page, firstContent], [second, secondContent]] as const) {
    await expect.poll(async () => { const state = await page.evaluate(() => window.desktop.bootstrap()); return state.ok ? state.data.documents.find(doc => doc.path === canonicalDocument)?.content : '' }).toBe(expected)
  }
  const token = await second.evaluate(async documentPath => {
    const result = await window.desktop.resolveResource('pixel.png', documentPath)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }, canonicalDocument)
  expect((await second.evaluate(async url => (await fetch(url)).status, token))).toBe(200)
  await session.page.getByRole('treeitem', { name: 'source', exact: true }).click()
  await session.page.getByRole('button', { name: '移动所选文件夹', exact: true }).click()
  await session.page.getByLabel('移动目标文件夹').fill(target)
  await session.page.getByRole('button', { name: '移动', exact: true }).click()
  await expect(session.page.getByRole('dialog', { name: '移动文件夹' })).toHaveCount(0)
  await expect.poll(() => readFile(newDocument, 'utf8').catch(() => '')).toBe(original)
  await expect(access(oldDocument)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(session.page.locator('.open-document-row').filter({ hasText: 'note.md' })).toHaveAttribute('title', await realpath(newDocument))
  await expect(second.locator('.open-document-row').filter({ hasText: 'note.md' })).toHaveAttribute('title', await realpath(newDocument))
  expect(await editorSource(session.page)).toBe(firstContent)
  expect(await editorSource(second)).toBe(secondContent)
  expect(await second.evaluate(async url => (await fetch(url)).status, token)).toBe(200)
  await session.page.getByRole('button', { name: '撤销文件操作', exact: true }).click()
  await expect.poll(() => readFile(oldDocument, 'utf8').catch(() => '')).toBe(original)
  await expect(second.locator('.open-document-row').filter({ hasText: 'note.md' })).toHaveAttribute('title', await realpath(oldDocument))
  expect(await editorSource(session.page)).toBe(firstContent)
  expect(await editorSource(second)).toBe(secondContent)
  expect(await second.evaluate(async url => (await fetch(url)).status, token)).toBe(200)
})

test('其他窗口以待移动目录为工作区时拒绝操作，目录和文件保持原位', async () => {
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, 'source'), target = path.join(workspace, 'target')
  await mkdir(source, { recursive: true }); await mkdir(target)
  await writeFile(path.join(source, 'note.md'), 'do not move')
  await openWorkspace(workspace)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(path => window.desktop.newWindow(path), source)
  const second = await opening
  await expect(second.locator('.cm-content')).toBeVisible()
  await expect.poll(async () => { const state = await second.evaluate(() => window.desktop.bootstrap()); return state.ok ? state.data.workspace?.path : '' }).toBe(await realpath(source))
  const result = await session.page.evaluate(input => window.desktop.moveFile(input), { path: source, destinationDirectory: target })
  expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('工作区') } })
  expect(await readFile(path.join(source, 'note.md'), 'utf8')).toBe('do not move')
  await expect(access(path.join(target, 'source'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('保存对话框等待时目录移动立即拒绝，取消后仍可移动并撤销', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '仅 macOS 和 Windows 有独占目录重命名原生桥')
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, 'source'), target = path.join(workspace, 'target')
  await mkdir(source, { recursive: true }); await mkdir(target)
  const file = path.join(source, 'note.md')
  await writeFile(file, '# Original')
  await openWorkspace(workspace)
  await session.page.getByRole('treeitem', { name: 'source', exact: true }).click()
  await session.page.getByRole('treeitem', { name: 'note.md', exact: true }).click()
  await expect(session.page.getByTestId('document-name')).toHaveText('note.md')
  const record = await session.page.evaluate(async () => { const state = await window.desktop.bootstrap(); if (!state.ok) throw new Error(state.error.message); return state.data.documents.find(doc => doc.name === 'note.md')! })
  await session.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'directoryTestSaveDialog', resolve) })
  })
  const saving = session.page.evaluate(record => window.desktop.saveDocument({ id: record.id, content: record.content, revision: 0, saveAs: true }), record)
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'directoryTestSaveDialog'))).toBe('function')
  try {
    const blocked = await session.page.evaluate(input => window.desktop.moveFile(input), { path: source, destinationDirectory: target })
    expect(blocked).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('正在进行') } })
    expect(await readFile(file, 'utf8')).toBe('# Original')
  } finally {
    await session.app.evaluate(() => {
      const done = Reflect.get(globalThis, 'directoryTestSaveDialog') as (result: Electron.SaveDialogReturnValue) => void
      done({ canceled: true, filePath: '' })
      Reflect.deleteProperty(globalThis, 'directoryTestSaveDialog')
    })
    expect(await saving).toEqual({ ok: true, data: null })
  }
  expect((await session.page.evaluate(input => window.desktop.moveFile(input), { path: source, destinationDirectory: target })).ok).toBe(true)
  expect((await session.page.evaluate(() => window.desktop.undoFileOperation())).ok).toBe(true)
  expect(await readFile(file, 'utf8')).toBe('# Original')
})

test('新建目录只有在未替换且为空时可撤销', async () => {
  const workspace = path.join(session.root, 'project')
  await mkdir(workspace)
  await openWorkspace(workspace)
  await session.page.getByRole('button', { name: '在文件夹中新建文件夹', exact: true }).click()
  await session.page.getByLabel('文件或文件夹名称').fill('created')
  await session.page.getByRole('button', { name: '确定', exact: true }).click()
  const created = path.join(workspace, 'created')
  await expect(session.page.getByRole('treeitem', { name: 'created', exact: true })).toBeVisible()
  await writeFile(path.join(created, '.hidden'), 'preserve')
  await session.page.getByRole('button', { name: '撤销文件操作', exact: true }).click()
  await expect(session.page.getByTestId('error-notification')).toContainText('目录非空')
  expect(await readFile(path.join(created, '.hidden'), 'utf8')).toBe('preserve')
  await unlink(path.join(created, '.hidden'))
  await session.page.getByRole('button', { name: '撤销文件操作', exact: true }).click()
  await expect.poll(() => access(created).then(() => true, () => false)).toBe(false)
})

test('回收站确认期间所选目录被替换时拒绝操作，原目录和替换目录都保留', async () => {
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, 'selected'), original = path.join(workspace, 'original')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, 'old.md'), 'original contents')
  await openWorkspace(workspace)
  await session.app.evaluate(({ dialog, shell }) => {
    dialog.showMessageBox = async () => new Promise(resolve => { Reflect.set(globalThis, 'directoryTestTrashDialog', resolve) })
    shell.trashItem = async item => { Reflect.set(globalThis, 'directoryTestTrashed', item) }
  })
  const trashing = session.page.evaluate(item => window.desktop.fileAction({ action: 'trash', path: item }), source)
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'directoryTestTrashDialog'))).toBe('function')
  await rename(source, original)
  await mkdir(source)
  await writeFile(path.join(source, 'new.md'), 'replacement contents')
  await session.app.evaluate(() => {
    const done = Reflect.get(globalThis, 'directoryTestTrashDialog') as (result: Electron.MessageBoxReturnValue) => void
    done({ response: 0, checkboxChecked: false })
  })
  expect(await trashing).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  expect(await session.app.evaluate(() => Reflect.get(globalThis, 'directoryTestTrashed'))).toBeUndefined()
  expect(await readFile(path.join(original, 'old.md'), 'utf8')).toBe('original contents')
  expect(await readFile(path.join(source, 'new.md'), 'utf8')).toBe('replacement contents')
})

test('英文文件树和目录移动对话框保留原始文件名与目标路径', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '仅 macOS 和 Windows 有独占目录重命名原生桥')
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, '原文件夹'), target = path.join(workspace, 'target')
  await mkdir(source, { recursive: true }); await mkdir(target)
  await writeFile(path.join(source, '笔记.md'), '原始内容')
  await openWorkspace(workspace)
  expect((await session.page.evaluate(() => window.desktop.patchPreferences({ locale: 'en-US' }))).ok).toBe(true)
  await expect(session.page.getByLabel('File view')).toBeVisible()
  await session.page.getByRole('treeitem', { name: '原文件夹', exact: true }).click()
  await session.page.getByRole('button', { name: 'Move selected folder', exact: true }).click()
  const dialog = session.page.getByRole('dialog', { name: 'Move folder' })
  await expect(dialog).toContainText('Move “原文件夹”')
  await dialog.getByLabel('Move destination folder').fill(target)
  await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await readFile(path.join(target, '原文件夹', '笔记.md'), 'utf8')).toBe('原始内容')
  await session.page.getByRole('button', { name: 'Undo file operation', exact: true }).click()
  await expect.poll(() => readFile(path.join(source, '笔记.md'), 'utf8').catch(() => '')).toBe('原始内容')
  const document = await session.page.evaluate(() => window.desktop.createDocument())
  expect(document).toMatchObject({ ok: true, data: { name: expect.stringMatching(/^Untitled\d+\.md$/) } })
})

test('大小写敏感磁盘上的同名目录互不影响，另一个窗口保存到原路径', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '仅 macOS 和 Windows 有独占目录重命名原生桥')
  const workspace = path.join(session.root, 'project'), upper = path.join(workspace, 'Foo'), lower = path.join(workspace, 'foo'), target = path.join(workspace, 'target')
  await mkdir(upper, { recursive: true })
  try { await mkdir(lower) } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') test.skip(true, '需要大小写敏感的文件系统')
    throw error
  }
  await mkdir(target)
  await writeFile(path.join(upper, 'note.md'), 'same original')
  await writeFile(path.join(lower, 'note.md'), 'same original')
  await openWorkspace(workspace)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(file => window.desktop.newWindow(file), path.join(lower, 'note.md'))
  const second = await opening
  await expect(second.getByTestId('document-name')).toHaveText('note.md')
  await append(second, ' lower edit')
  expect((await session.page.evaluate(input => window.desktop.moveFile(input), { path: upper, destinationDirectory: target })).ok).toBe(true)
  await expect(second.locator('.open-document-row').filter({ hasText: 'note.md' })).toHaveAttribute('title', await realpath(path.join(lower, 'note.md')))
  await second.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(path.join(lower, 'note.md'), 'utf8')).toBe('same original lower edit')
  expect(await readFile(path.join(target, 'Foo', 'note.md'), 'utf8')).toBe('same original')
})

test('已移入回收站的打开文档占用目标时拒绝目录移动', async () => {
  const workspace = path.join(session.root, 'project'), source = path.join(workspace, 'source', 'Foo'), target = path.join(workspace, 'target'), old = path.join(target, 'Foo')
  await mkdir(source, { recursive: true }); await mkdir(old, { recursive: true })
  await writeFile(path.join(source, 'note.md'), 'same original')
  await writeFile(path.join(old, 'note.md'), 'same original')
  await openWorkspace(workspace)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(file => window.desktop.newWindow(file), path.join(old, 'note.md'))
  const second = await opening
  await expect(second.getByTestId('document-name')).toHaveText('note.md')
  await append(second, ' preserved draft')
  await session.app.evaluate(({ dialog, shell }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    shell.trashItem = async () => new Promise(resolve => { Reflect.set(globalThis, 'completeTrashMove', resolve) })
  })
  const trashing = session.page.evaluate(item => window.desktop.fileAction({ action: 'trash', path: item }), old)
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'completeTrashMove'))).toBe('function')
  await rename(old, path.join(workspace, 'recovered-trash'))
  await session.app.evaluate(() => { (Reflect.get(globalThis, 'completeTrashMove') as () => void)() })
  const trashed = await trashing
  expect(trashed.ok, JSON.stringify(trashed)).toBe(true)
  const blocked = await session.page.evaluate(input => window.desktop.moveFile(input), { path: source, destinationDirectory: target })
  expect(blocked).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('目标路径') } })
  expect(await readFile(path.join(source, 'note.md'), 'utf8')).toBe('same original')
  expect(await readFile(path.join(workspace, 'recovered-trash', 'note.md'), 'utf8')).toBe('same original')
  expect(await editorSource(second)).toContain('preserved draft')
  await expect(access(path.join(target, 'Foo'))).rejects.toMatchObject({ code: 'ENOENT' })
  // Even an external replacement with identical bytes must not be silently overwritten.
  await mkdir(old)
  await writeFile(path.join(old, 'note.md'), 'same original')
  await session.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      Reflect.set(globalThis, 'missingFileSavePrompted', true)
      return { canceled: true, filePath: '' }
    }
  })
  await second.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'missingFileSavePrompted'))).toBe(true)
  expect(await readFile(path.join(old, 'note.md'), 'utf8')).toBe('same original')
  expect(await editorSource(second)).toContain('preserved draft')
})
