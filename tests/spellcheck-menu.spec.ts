import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdir, readFile, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop } from './desktop-helpers'

async function spellingMenu(app: ElectronApplication, click = false) {
  return app.evaluate(({ Menu, BrowserWindow }, shouldClick) => {
    const edit = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('编辑'))
    const menu = edit?.submenu?.items.find(item => item.label === '拼写和语法检查')?.submenu
    const item = menu?.items.find(entry => entry.label === '键入时检查拼写')
    if (!item) throw new Error('spelling menu missing')
    const before = item.checked
    if (shouldClick) {
      item.checked = !before
      item.click(undefined, BrowserWindow.getAllWindows()[0], { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
    }
    return before
  }, click)
}

test('拼写菜单同步窗口并在重启后保留', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 拼写菜单')
  let session = await launchDesktop()
  try {
    const next = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await next
    await second.locator('.cm-content').waitFor()
    expect(await spellingMenu(session.app)).toBe(false)
    await spellingMenu(session.app, true)
    await expect.poll(() => spellingMenu(session.app)).toBe(true)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
    await expect(second.locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
    const settings = JSON.parse(await readFile(path.join(session.userData, 'settings.json'), 'utf8'))
    expect(settings.preferences.spellcheck).toBe(true)
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    await expect.poll(() => spellingMenu(session.app)).toBe(true)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
  } finally { await stopDesktop(session) }
})

test('拼写菜单偏好写入失败时勾选状态恢复', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 拼写菜单')
  const session = await launchDesktop()
  try {
    await session.page.evaluate(() => window.desktop.patchPreferences({ zoomFactor: 1.1 }))
    const settings = path.join(session.userData, 'settings.json'), backup = path.join(session.userData, 'settings.spelling-backup')
    await rename(settings, backup); await mkdir(settings)
    await spellingMenu(session.app, true)
    await expect(session.page.getByRole('alert')).toBeVisible()
    expect(await spellingMenu(session.app)).toBe(false)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false')
    await rmdir(settings); await rename(backup, settings)
    await spellingMenu(session.app, true)
    await expect.poll(() => spellingMenu(session.app)).toBe(true)
  } finally { await stopDesktop(session) }
})
