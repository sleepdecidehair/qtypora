import { test, expect } from '@playwright/test'
import { launchDesktop, stopDesktop, clickNativeMenu } from './desktop-helpers'

test('第三方许可在只读隔离窗口显示，正文与桌面桥保持隔离', async () => {
  const session = await launchDesktop()
  try {
    const source = await session.page.locator('.cm-line').allTextContents()
    const opened = session.app.waitForEvent('window')
    await clickNativeMenu(session, '第三方许可')
    const notices = await opened
    await expect(notices.locator('body')).toContainText('js-sequence-diagrams')
    await expect(notices.locator('body')).toContainText('Permission is hereby granted')
    const nativeWindow = await session.app.browserWindow(notices)
    const preferences = await nativeWindow.evaluate(window => window.webContents.getLastWebPreferences())
    expect(preferences).toMatchObject({ javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false })
    await nativeWindow.evaluate(window => window.close())
    expect(await session.page.locator('.cm-line').allTextContents()).toEqual(source)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
