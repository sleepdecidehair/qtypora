import { test, expect } from '@playwright/test'
import { realpath, unlink } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('文件菜单定位当前文件并随文档切换和外部删除更新', async () => {
  test.skip(process.platform !== 'darwin', 'macOS Finder 菜单')
  const session = await launchDesktop()
  try {
    await session.app.evaluate(({ shell }) => {
      shell.showItemInFolder = filePath => { Reflect.set(globalThis, 'revealedFile', filePath) }
    })
    const enabled = () => session.app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('文件'))
      return file?.submenu?.items.find(item => item.label === '在 Finder 中显示当前文件')?.enabled
    })
    await expect.poll(enabled).toBe(false)
    const file = await openFixture(session, 'reveal.md', 'original')
    await expect.poll(enabled).toBe(true)
    await clickNativeMenu(session, '在 Finder 中显示当前文件')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'revealedFile'))).toBe(await realpath(file))
    await session.page.keyboard.press('ControlOrMeta+n')
    await expect.poll(enabled).toBe(false)
    await session.page.keyboard.press('ControlOrMeta+o')
    await expect.poll(enabled).toBe(true)
    await unlink(file)
    await expect.poll(enabled, { timeout: 8_000 }).toBe(false)
    expect(await session.page.locator('.cm-content').innerText()).toBe('original')
  } finally { await stopDesktop(session) }
})
