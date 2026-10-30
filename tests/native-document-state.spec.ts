import { test, expect } from '@playwright/test'
import { realpath } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('macOS 原生文档路径与编辑标记跟随当前文档', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生窗口状态')
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'native-state.md', '原始内容')
    const canonical = await realpath(filename)
    const native = async () => {
      const window = await session.app.browserWindow(session.page)
      return window.evaluate(win => ({ path: win.getRepresentedFilename(), edited: win.isDocumentEdited() }))
    }
    await expect.poll(native).toEqual({ path: canonical, edited: false })
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('修改')
    await expect.poll(native).toEqual({ path: canonical, edited: true })
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(native).toEqual({ path: canonical, edited: false })
    await session.page.keyboard.press('ControlOrMeta+n')
    await expect.poll(native).toEqual({ path: '', edited: false })
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
