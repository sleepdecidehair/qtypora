import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdir, readFile, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

async function softBreakMenu(app: ElectronApplication, click = false) {
  return app.evaluate(({ Menu, BrowserWindow }, shouldClick) => {
    const edit = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('编辑'))
    const menu = edit?.submenu?.items.find(item => item.label === '空白与换行')?.submenu
    const item = menu?.items.find(entry => entry.label === '保留软换行')
    if (!item) throw new Error('soft break menu missing')
    const before = item.checked
    if (shouldClick) {
      item.checked = !before
      item.click(undefined, BrowserWindow.getAllWindows()[0], { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
    }
    return before
  }, click)
}

test('软换行菜单同步窗口并保持原文', async () => {
  const session = await launchDesktop()
  try {
    const text = 'first\nsecond'
    const file = await openFixture(session, 'soft-break-menu.md', text)
    const next = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await next
    await second.locator('.cm-content').waitFor()
    expect(await softBreakMenu(session.app)).toBe(false)
    await softBreakMenu(session.app, true)
    await expect.poll(() => softBreakMenu(session.app)).toBe(true)
    await second.getByTestId('preferences-button').click()
    await expect(second.getByLabel('保留软换行')).toBeChecked()
    expect(await readFile(file, 'utf8')).toBe(text)
  } finally { await stopDesktop(session) }
})

test('软换行菜单保存失败后恢复已确认的勾选状态', async () => {
  const session = await launchDesktop()
  const settings = path.join(session.userData, 'settings.json'), backup = path.join(session.userData, 'settings.soft-break-backup')
  let replaced = false
  try {
    await session.page.evaluate(() => window.desktop.patchPreferences({ zoomFactor: 1.1 }))
    await rename(settings, backup)
    await mkdir(settings)
    replaced = true
    await softBreakMenu(session.app, true)
    await expect(session.page.getByRole('alert')).toBeVisible()
    expect(await softBreakMenu(session.app)).toBe(false)
    await session.page.getByTestId('preferences-button').click()
    await expect(session.page.getByLabel('保留软换行')).not.toBeChecked()
  } finally {
    if (replaced) { await rmdir(settings); await rename(backup, settings) }
    await stopDesktop(session)
  }
})
