import { test, expect } from '@playwright/test'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

const sourceText = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())

async function openLinks(source: string): Promise<string> {
  const file = await openFixture(session, 'links.md', source)
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  return file
}

async function follow(target: string): Promise<void> {
  const link = session.page.locator(`.cm-live-link[data-href="${target}"]`)
  await expect(link).toBeVisible()
  await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
}

async function holdCreationDialog(): Promise<void> {
  await session.app.evaluate(({ dialog }) => {
    Reflect.deleteProperty(globalThis, 'qtyporaPendingLinkCreation')
    dialog.showMessageBox = async () => new Promise(resolve => {
      Reflect.set(globalThis, 'qtyporaPendingLinkCreation', resolve)
    })
  })
}

async function waitForCreationDialog(): Promise<void> {
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaPendingLinkCreation'))).toBe('function')
}

async function finishCreation(response: number): Promise<void> {
  await session.app.evaluate((_electron, answer) => {
    const finish = Reflect.get(globalThis, 'qtyporaPendingLinkCreation') as (result: Electron.MessageBoxReturnValue) => void
    finish({ response: answer, checkboxChecked: false })
    Reflect.deleteProperty(globalThis, 'qtyporaPendingLinkCreation')
  }, response)
}

test('缺失 Markdown 链接取消不创建，确认后独占创建并保持源文档', async () => {
  const original = '# Links\n\n[Create a note](new-note.md)\n'
  const source = await openLinks(original)
  const destination = path.join(session.root, 'new-note.md')
  await holdCreationDialog()
  await follow('new-note.md')
  await waitForCreationDialog()
  await finishCreation(1)
  await expect(session.page.getByTestId('document-name')).toHaveText('links.md')
  await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await sourceText()).toBe(original)
  await follow('new-note.md')
  await waitForCreationDialog()
  await finishCreation(0)
  await expect(session.page.getByTestId('document-name')).toHaveText('new-note.md')
  await expect.poll(async () => readFile(destination, 'utf8').catch(() => 'missing')).toBe('')
  expect(await sourceText()).toBe('')
  expect(await readFile(source, 'utf8')).toBe(original)
})

test('创建链接确认期间出现的同名文件不会被覆盖', async () => {
  const original = '[Create](race.md)\n'
  await openLinks(original)
  await holdCreationDialog()
  await follow('race.md')
  await waitForCreationDialog()
  const destination = path.join(session.root, 'race.md')
  await writeFile(destination, '# External writer\r\n')
  await finishCreation(0)
  await expect(session.page.getByTestId('error-notification')).toContainText('已经存在')
  await expect(session.page.getByTestId('document-name')).toHaveText('links.md')
  expect(await sourceText()).toBe(original)
  expect(await readFile(destination, 'utf8')).toBe('# External writer\r\n')
})

test('跨文件显式锚点跳转至可见源码位置，不修改任一文件', async () => {
  const targetSource = `# Target\n\n${'Paragraph before destination.\n\n'.repeat(80)}<a id="explicit-anchor"></a>\n\n## Destination\n\nTarget body.\n`
  const target = path.join(session.root, 'target.md')
  await writeFile(target, targetSource)
  const original = '# Links\n\n[Go to explicit anchor](target.md#explicit-anchor)\n'
  const source = await openLinks(original)
  await follow('target.md#explicit-anchor')
  await expect(session.page.getByTestId('document-name')).toHaveText('target.md')
  await expect.poll(sourceText).toBe(targetSource)
  const targetLine = targetSource.split('\n').findIndex(line => line.includes('<a id=')) + 1
  await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view
    return view.state.doc.lineAt(view.state.selection.main.head).number
  })).toBe(targetLine)
  const location = await session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view
    return { point: view.coordsAtPos(view.state.selection.main.head), viewport: view.scrollDOM.getBoundingClientRect().toJSON() }
  })
  expect(location.point.top).toBeGreaterThanOrEqual(location.viewport.top)
  expect(location.point.bottom).toBeLessThanOrEqual(location.viewport.bottom)
  expect(await readFile(source, 'utf8')).toBe(original)
  expect(await readFile(target, 'utf8')).toBe(targetSource)
})

test('等待创建链接时切换文档，完成响应不会抢回当前编辑文档', async () => {
  await openLinks('[Create later](later.md)\n')
  await holdCreationDialog()
  await follow('later.md')
  await waitForCreationDialog()
  await clickNativeMenu(session, '新建')
  await expect(session.page.getByTestId('document-name')).not.toHaveText('links.md')
  const currentName = await session.page.getByTestId('document-name').innerText()
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.insertText('Current draft stays here')
  await expect.poll(sourceText).toBe('Current draft stays here')
  await finishCreation(0)
  await expect.poll(async () => readFile(path.join(session.root, 'later.md'), 'utf8').catch(() => 'missing')).toBe('')
  await expect(session.page.getByTestId('document-name')).toHaveText(currentName)
  await expect.poll(sourceText).toBe('Current draft stays here')
  await session.page.getByTestId('files-tab').click()
  await expect(session.page.locator('.open-document-row').filter({ hasText: 'later.md' })).toHaveCount(1)
})

test('未同步的目标文档编辑仍用于跨文件新标题锚点解析', async () => {
  const disk = '# Target\n\n## Old heading\n'
  const target = await openFixture(session, 'target.md', disk)
  // Hold the background store at its old snapshot while exercising the actual link IPC.
  await session.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('qtypora:syncDocument')
    ipcMain.handle('qtypora:syncDocument', () => ({ ok: true, data: undefined }))
  })
  const edited = '# Target\n\n## New heading\n'
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await session.page.keyboard.insertText(edited)
  await expect.poll(sourceText).toBe(edited)
  await openLinks('[New title](target.md#new-heading)\n')
  await follow('target.md#new-heading')
  await expect(session.page.getByTestId('document-name')).toHaveText('target.md')
  await expect.poll(sourceText).toBe(edited)
  await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view
    return view.state.doc.lineAt(view.state.selection.main.head).number
  })).toBe(3)
  await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
  await expect(session.page.getByTestId('error-notification')).toHaveCount(0)
  expect(await readFile(target, 'utf8')).toBe(disk)
})

test('文件操作 IPC 拒绝数组枚举且不创建文件', async () => {
  await openFixture(session, 'authorize.md', '# Authorized')
  const result = await session.page.evaluate(async folder => {
    await window.desktop.openFolder(folder)
    return window.desktop.fileAction({ action: ['create-file'] as unknown as 'create-file', path: folder, name: 'invalid-action.md' })
  }, session.root)
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  await expect(access(path.join(session.root, 'invalid-action.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('慢导入结束后后台保留导入草稿，不抢回用户已新建的文档', async () => {
  const executable = process.env.QTYPORA_TEST_PANDOC
  test.skip(!executable, '需要 QTYPORA_TEST_PANDOC 才验证实际导入与导航竞态')
  const input = path.join(session.root, 'imported.html')
  await writeFile(input, '<h1>Imported in background</h1><p>Converted text.</p>')
  await session.page.evaluate(pandocPath => window.desktop.patchPreferences({ export: { pandocPath } }), executable!)
  await openFixture(session, 'before-import.md', '# Before')
  await session.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'qtyporaPendingImport', resolve) })
  })
  await clickNativeMenu(session, '导入文档…')
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaPendingImport'))).toBe('function')
  await clickNativeMenu(session, '新建')
  await expect(session.page.getByTestId('document-name')).not.toHaveText('before-import.md')
  const currentName = await session.page.getByTestId('document-name').innerText()
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.insertText('Do not replace this current draft')
  await expect.poll(sourceText).toBe('Do not replace this current draft')
  await session.app.evaluate((_electron, file) => {
    const finish = Reflect.get(globalThis, 'qtyporaPendingImport') as (result: Electron.OpenDialogReturnValue) => void
    finish({ canceled: false, filePaths: [file] })
    Reflect.deleteProperty(globalThis, 'qtyporaPendingImport')
  }, input)
  await expect.poll(async () => {
    const result = await session.page.evaluate(() => window.desktop.bootstrap())
    return result.ok && result.data.documents.some(document => document.unsaved && document.content.includes('Imported in background'))
  }).toBe(true)
  await session.page.getByTestId('files-tab').click()
  await expect.poll(async () => {
    const result = await session.page.evaluate(() => window.desktop.bootstrap())
    const imported = result.ok && result.data.documents.find(document => document.unsaved && document.content.includes('Imported in background'))
    return imported ? session.page.locator('.open-document-row').filter({ hasText: imported.name }).count() : 0
  }).toBe(1)
  await expect(session.page.getByTestId('document-name')).toHaveText(currentName)
  expect(await sourceText()).toBe('Do not replace this current draft')
  expect(await readFile(input, 'utf8')).toBe('<h1>Imported in background</h1><p>Converted text.</p>')
})
