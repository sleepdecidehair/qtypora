import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('macOS 系统分享只对已保存的当前快照打开选择器', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生分享')
  const session = await launchDesktop()
  try {
    const original = '测试分享\n'
    const filename = await openFixture(session, 'share-document.md', original)
    await session.app.evaluate(({ ShareMenu }) => {
      const originalPopup = ShareMenu.prototype.popup
      Reflect.set(globalThis, 'nativeShareTestOriginalPopup', originalPopup)
      Reflect.set(globalThis, 'nativeShareTestPopupCount', 0)
      ShareMenu.prototype.popup = function () { Reflect.set(globalThis, 'nativeShareTestPopupCount', Number(Reflect.get(globalThis, 'nativeShareTestPopupCount')) + 1) }
    })
    try {
      const snapshot = await session.page.evaluate(async () => {
        const result = await window.desktop.bootstrap()
        if (!result.ok) throw new Error(result.error.message)
        const document = result.data.documents.find(item => item.name === 'share-document.md')!
        return { id: document.id, content: document.content, revision: 0 }
      })
      const call = (value: typeof snapshot) => session.page.evaluate(async request => window.desktop.showNativeShare(request), value)
      expect((await call(snapshot)).ok).toBe(true)
      expect(await session.app.evaluate(() => Reflect.get(globalThis, 'nativeShareTestPopupCount'))).toBe(1)
      expect((await call({ ...snapshot, content: original + '编辑', revision: 1 })).ok).toBe(false)
      expect((await call({ ...snapshot, id: 'closed' })).ok).toBe(false)
      expect(await session.app.evaluate(() => Reflect.get(globalThis, 'nativeShareTestPopupCount'))).toBe(1)
      await clickNativeMenu(session, '共享…')
      await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'nativeShareTestPopupCount'))).toBe(2)
      await session.page.locator('.cm-content').click()
      await session.page.keyboard.press('End')
      await session.page.keyboard.insertText('改')
      await clickNativeMenu(session, '共享…')
      await expect(session.page.getByTestId('error-notification')).toContainText('请先保存文档')
      expect(await session.app.evaluate(() => Reflect.get(globalThis, 'nativeShareTestPopupCount'))).toBe(2)
      expect(await readFile(filename, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally {
      await session.app.evaluate(({ ShareMenu }) => { ShareMenu.prototype.popup = Reflect.get(globalThis, 'nativeShareTestOriginalPopup') })
    }
  } finally { await stopDesktop(session) }
})
