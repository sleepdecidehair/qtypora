import { test, expect } from '@playwright/test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

test('仅更换换行符也提示未保存，取消关闭后保存混合换行并保留 BOM', async () => {
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufefffirst\r\nsecond\nthird')
    const filename = await openFixture(session, 'mixed-line.md', original)
    await expect.poll(() => session.app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('编辑'))
      return edit?.submenu?.items.find(item => item.label === '换行符')?.submenu?.items.find(item => item.label.includes('CRLF'))?.enabled
    })).toBe(true)
    await clickNativeMenu(session, 'Windows 换行符')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    expect(await readFile(filename)).toEqual(original)
    await session.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { Reflect.set(globalThis, 'lineEndingClosePrompt', true); return { response: 2, checkboxChecked: false } } })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'lineEndingClosePrompt'))).toBe(true)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename)).toEqual(Buffer.from('\ufefffirst\r\nsecond\r\nthird'))
    await expect(session.page.getByTestId('dirty-indicator')).toHaveCount(0)
    expect(await session.page.locator('.cm-content').innerText()).toBe('first\nsecond\nthird')
  } finally { await stopDesktop(session) }
})

test('换行符草稿跨重启恢复并在保存时保留编码', async () => {
  let session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'recover-lines.md', Buffer.from('\ufefffirst\r\nsecond'))
    await clickNativeMenu(session, 'Unix 换行符')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => {
      const files = await readdir(folder).catch(() => [])
      const drafts = await Promise.all(files.map(file => readFile(path.join(folder, file), 'utf8').then(text => JSON.parse(text))))
      return drafts.some(draft => draft.pendingLineEnding === 'LF' && draft.encoding === 'utf8-bom')
    }).toBe(true)
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    await expect(session.page.getByRole('dialog', { name: '恢复草稿' })).toBeVisible()
    await session.page.getByRole('button', { name: '恢复', exact: true }).first().click()
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename)).toEqual(Buffer.from('\ufefffirst\nsecond'))
  } finally { await stopDesktop(session) }
})

test('换行转换遇外部修改不覆盖磁盘且保留草稿', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'conflict-lines.md', Buffer.from('first\r\nsecond'))
    await clickNativeMenu(session, 'Unix 换行符')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    const directory = path.join(session.userData, 'drafts')
    await expect.poll(async () => {
      const names = await readdir(directory).catch(() => [])
      return (await Promise.all(names.map(name => readFile(path.join(directory, name), 'utf8')))).some(text => text.includes('"pendingLineEnding":"LF"'))
    }).toBe(true)
    await writeFile(filename, 'external\r\nchange')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect(session.page.getByRole('alert')).toBeVisible()
    expect(await readFile(filename, 'utf8')).toBe('external\r\nchange')
    expect(await session.page.locator('.cm-content').innerText()).toBe('first\nsecond')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
  } finally { await stopDesktop(session) }
})

test('导出 Markdown 使用待保存的换行目标且不修改源文件', async () => {
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufefffirst\r\nsecond')
    const filename = await openFixture(session, 'export-lines.md', original)
    await clickNativeMenu(session, 'Unix 换行符')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => {
      const files = await readdir(folder).catch(() => [])
      return (await Promise.all(files.map(file => readFile(path.join(folder, file), 'utf8')))).some(text => text.includes('"pendingLineEnding":"LF"'))
    }).toBe(true)
    const destination = path.join(session.root, 'export-result.md')
    await setSaveDialog(session, destination)
    const result = await session.page.evaluate(async () => {
      const bootstrap = await window.desktop.bootstrap()
      if (!bootstrap.ok) return bootstrap
      const document = bootstrap.data.documents.find(item => item.name === 'export-lines.md')!
      return window.desktop.exportDocument({ id: document.id, revision: 1, kind: 'markdown' })
    })
    expect(result.ok).toBe(true)
    expect(await readFile(destination)).toEqual(Buffer.from('\ufefffirst\nsecond'))
    expect(await readFile(filename)).toEqual(original)
  } finally { await stopDesktop(session) }
})
