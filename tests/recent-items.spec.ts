import { expect, test } from '@playwright/test'
import { mkdir, readFile, realpath, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setMessageResponse, setOpenDialog, stopDesktop } from './desktop-helpers'

test('最近目录移除与清空会同步所有窗口并在重启后保留，默认保留固定目录', async () => {
  let session = await launchDesktop()
  try {
    await mkdir(path.join(session.root, 'pinned-notes'))
    const folder = await realpath(path.join(session.root, 'pinned-notes'))
    const file = await openFixture(session, 'recent-note.md', '# Keep this content\n')
    await setOpenDialog(session, [folder])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('workspace-folder')).toHaveText('pinned-notes')
    await session.page.getByRole('button', { name: '固定目录', exact: true }).click()
    await expect.poll(async () => {
      const state = await session.page.evaluate(() => window.desktop.bootstrap())
      return state.ok ? state.data.preferences.workspace.pinnedFolders : []
    }).toEqual([folder])
    const nextWindow = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await nextWindow
    await second.locator('.cm-content').waitFor()
    await second.getByTestId('files-tab').click()
    await second.getByRole('button', { name: '管理最近记录…', exact: true }).click()
    await clickNativeMenu(session, '管理最近记录…')
    const firstHistory = session.page.getByRole('dialog', { name: '管理最近记录' })
    const secondHistory = second.getByRole('dialog', { name: '管理最近记录' })
    await expect(firstHistory.getByRole('button', { name: `移除最近目录 ${folder}`, exact: true })).toBeVisible()
    await firstHistory.getByRole('button', { name: `移除最近目录 ${folder}`, exact: true }).click()
    await expect(firstHistory.getByText('暂无最近目录')).toBeVisible()
    await expect(secondHistory.getByText('暂无最近目录')).toBeVisible()
    const settings = path.join(session.userData, 'settings.json')
    await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).recentFolders).toEqual([])
    await setMessageResponse(session, 0)
    await firstHistory.getByRole('button', { name: '清除最近记录…' }).click()
    await expect(firstHistory.getByText('最近文件 · 0')).toBeVisible()
    await expect(secondHistory.getByText('最近文件 · 0')).toBeVisible()
    expect(JSON.parse(await readFile(settings, 'utf8')).preferences.workspace.pinnedFolders).toEqual([folder])
    expect(await readFile(file, 'utf8')).toBe('# Keep this content\n')
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    const restarted = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(restarted.ok && restarted.data.recentFiles).toEqual([])
    expect(restarted.ok && restarted.data.recentFolders).toEqual([])
    expect(restarted.ok && restarted.data.preferences.workspace.pinnedFolders).toEqual([folder])
    await clickNativeMenu(session, '管理最近记录…')
    const history = session.page.getByRole('dialog', { name: '管理最近记录' })
    await history.getByLabel('同时清除固定目录').check()
    await setMessageResponse(session, 0)
    await history.getByRole('button', { name: '清除最近记录…' }).click()
    await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).preferences.workspace.pinnedFolders).toEqual([])
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('取消或持久化失败不会清除最近记录和固定目录', async () => {
  const session = await launchDesktop()
  try {
    const folder = await realpath(session.root)
    const file = await realpath(await openFixture(session, 'preserved.md', '# Preserved\n'))
    await setOpenDialog(session, [session.root])
    await clickNativeMenu(session, '打开文件夹…')
    await expect(session.page.getByTestId('file-tree')).toBeVisible()
    await session.page.getByRole('button', { name: '固定目录', exact: true }).click()
    const settings = path.join(session.userData, 'settings.json')
    await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).preferences.workspace.pinnedFolders).toEqual([folder])
    await clickNativeMenu(session, '管理最近记录…')
    const history = session.page.getByRole('dialog', { name: '管理最近记录' })
    await history.getByLabel('同时清除固定目录').check()
    const before = await readFile(settings, 'utf8')
    await setMessageResponse(session, 1)
    await history.getByRole('button', { name: '清除最近记录…' }).click()
    await expect(history.getByRole('button', { name: '清除最近记录…' })).toBeEnabled()
    expect(await readFile(settings, 'utf8')).toBe(before)
    const backup = path.join(session.userData, 'settings.before-failure.json')
    await rename(settings, backup)
    await mkdir(settings)
    try {
      await setMessageResponse(session, 0)
      await history.getByRole('button', { name: '清除最近记录…' }).click()
      await expect(history.getByRole('alert')).toBeVisible()
      const current = await session.page.evaluate(() => window.desktop.bootstrap())
      expect(current.ok && current.data.recentFiles).toEqual([file])
      expect(current.ok && current.data.recentFolders).toEqual([folder])
      expect(current.ok && current.data.preferences.workspace.pinnedFolders).toEqual([folder])
      await history.getByRole('button', { name: `移除最近目录 ${folder}`, exact: true }).click()
      await expect(history.getByRole('alert')).toBeVisible()
      await expect(history.getByRole('button', { name: `移除最近目录 ${folder}`, exact: true })).toBeVisible()
    } finally {
      await rmdir(settings)
      await rename(backup, settings)
    }
    expect(await readFile(settings, 'utf8')).toBe(before)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
