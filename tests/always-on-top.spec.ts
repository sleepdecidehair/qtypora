import { test, expect } from '@playwright/test'
import { clickNativeMenu, launchDesktop, stopDesktop } from './desktop-helpers'

test('查看菜单置顶只影响当前窗口，并可恢复', async () => {
  const session = await launchDesktop()
  try {
    const first = await session.app.browserWindow(session.page)
    expect(await first.evaluate(window => window.isAlwaysOnTop())).toBe(false)
    await clickNativeMenu(session, '窗口置顶 / 取消置顶')
    await expect.poll(() => first.evaluate(window => window.isAlwaysOnTop())).toBe(true)
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const secondPage = await opening
    const second = await session.app.browserWindow(secondPage)
    await expect(secondPage.locator('.cm-content')).toBeVisible()
    expect(await second.evaluate(window => window.isAlwaysOnTop())).toBe(false)
    await session.page.evaluate(() => window.desktop.toggleAlwaysOnTop())
    await expect.poll(() => first.evaluate(window => window.isAlwaysOnTop())).toBe(false)
    expect(await second.evaluate(window => window.isAlwaysOnTop())).toBe(false)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
