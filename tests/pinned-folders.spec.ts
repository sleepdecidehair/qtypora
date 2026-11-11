import { expect, test } from '@playwright/test'
import { mkdir, readFile, realpath, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureDesktop, clickNativeMenu, launchDesktop, openFixture, setOpenDialog, stopDesktop } from './desktop-helpers'

test('固定目录显示在原生最近菜单与快速打开中，并以工作区打开且保留当前文档', async () => {
  const session = await launchDesktop()
  try {
    const pinnedPath = path.join(session.root, 'Pinned.md')
    const otherPath = path.join(session.root, 'Other')
    await mkdir(pinnedPath)
    await mkdir(otherPath)
    const pinned = await realpath(pinnedPath)
    const other = await realpath(otherPath)
    await writeFile(path.join(pinned, 'inside.md'), '# Inside\n')
    const file = await openFixture(session, 'active.md', '# Active document\n')
    await setOpenDialog(session, [pinned])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Pinned.md')
    await session.page.getByRole('button', { name: '固定目录', exact: true }).click()
    await expect.poll(async () => {
      const state = await session.page.evaluate(() => window.desktop.bootstrap())
      return state.ok ? state.data.preferences.workspace.pinnedFolders : []
    }).toEqual([pinned])
    await setOpenDialog(session, [other])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Other')
    const entries = await session.app.evaluate(({ Menu }, folder) => {
      const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('文件'))
      const recent = fileMenu?.submenu?.items.find(item => item.label === '最近使用的文件与目录')
      return recent?.submenu?.items.filter(item => item.label === folder).length
    }, pinned)
    expect(entries).toBe(1)
    await clickNativeMenu(session, pinned)
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Pinned.md')
    await expect(session.page.getByTestId('file-tree').getByRole('treeitem', { name: 'inside.md' })).toBeVisible()
    await expect(session.page.getByTestId('document-name')).toHaveText('active.md')
    await clickNativeMenu(session, other)
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Other')
    await clickNativeMenu(session, '快速打开…')
    const quick = session.page.getByRole('dialog', { name: '快速打开' })
    await quick.getByTestId('quick-open-input').fill('Pinned.md')
    const option = quick.getByRole('option', { name: /Pinned\.md.*固定目录/ })
    await expect(option).toBeVisible()
    await session.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await captureDesktop(session, path.join(process.cwd(), '.debug', 'typora-parity-2026-11-11', 'pinned-quick-open.png'), { presentInactive: true })
    await quick.getByTestId('quick-open-input').press('Enter')
    await expect(quick).toHaveCount(0)
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Pinned.md')
    await expect(session.page.getByTestId('document-name')).toHaveText('active.md')
    expect(await readFile(file, 'utf8')).toBe('# Active document\n')
    const nextWindow = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await nextWindow
    await second.locator('.cm-content').waitFor()
    await second.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+o' : 'Control+p')
    await second.getByTestId('quick-open-input').fill('Pinned.md')
    await second.getByTestId('quick-open-input').press('Enter')
    await expect(second.getByTestId('workspace-folder')).toHaveText('Pinned.md')
    await expect(second.getByTestId('file-tree').getByRole('treeitem', { name: 'inside.md' })).toBeVisible()
    await session.page.getByRole('button', { name: '取消固定', exact: true }).click()
    await expect.poll(async () => {
      const state = await second.evaluate(() => window.desktop.bootstrap())
      return state.ok ? state.data.preferences.workspace.pinnedFolders : [pinned]
    }).toEqual([])
    await second.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+o' : 'Control+p')
    await second.getByTestId('quick-open-input').fill('Pinned.md')
    await expect(second.getByRole('dialog', { name: '快速打开' }).getByRole('option').filter({ hasText: '固定目录' })).toHaveCount(0)
    await expect(second.getByRole('dialog', { name: '快速打开' }).getByRole('option', { name: /Pinned\.md.*最近/ })).toBeVisible()
    await second.getByTestId('quick-open-input').press('Enter')
    await expect(second.getByTestId('workspace-folder')).toHaveText('Pinned.md')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('快速打开已删除的固定目录会报告失败，不改变当前工作区和文档', async () => {
  const session = await launchDesktop()
  try {
    const pinned = path.join(session.root, 'Removed folder')
    const current = path.join(session.root, 'Current folder')
    await mkdir(pinned)
    await mkdir(current)
    const file = await openFixture(session, 'retained.md', '# Keep this document\n')
    await setOpenDialog(session, [pinned])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Removed folder')
    await session.page.getByRole('button', { name: '固定目录', exact: true }).click()
    const pinnedPath = await realpath(pinned)
    await expect.poll(async () => {
      const state = await session.page.evaluate(() => window.desktop.bootstrap())
      return state.ok ? state.data.preferences.workspace.pinnedFolders : []
    }).toEqual([pinnedPath])
    await setOpenDialog(session, [current])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Current folder')
    await rmdir(pinned)
    await clickNativeMenu(session, '快速打开…')
    await session.page.getByTestId('quick-open-input').fill('Removed folder')
    await session.page.getByTestId('quick-open-input').press('Enter')
    await expect(session.page.getByRole('dialog', { name: '快速打开' })).toHaveCount(0)
    await expect(session.page.getByTestId('error-notification')).toBeVisible()
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('Current folder')
    await expect(session.page.getByTestId('document-name')).toHaveText('retained.md')
    expect(await readFile(file, 'utf8')).toBe('# Keep this document\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
