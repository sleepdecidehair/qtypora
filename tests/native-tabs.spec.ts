import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('macOS 原生标签是独立窗口，默认布局不变且启用在新窗口生效', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生标签页')
  const session = await launchDesktop()
  try {
    await openFixture(session, 'original.md', '保留原文')
    const original = await session.page.locator('.cm-content').innerText()
    const initial = await session.page.evaluate(async () => {
      const state = await window.desktop.bootstrap()
      const tab = await window.desktop.newNativeTab()
      return { state, tab }
    })
    expect(initial.state.ok && initial.state.data.nativeTabsEnabled).toBe(false)
    expect(initial.tab.ok).toBe(false)
    if (!initial.tab.ok) expect(initial.tab.error.message).toContain('偏好设置')
    await expect(session.page.getByTestId('mac-titlebar')).toBeVisible()
    expect(session.app.windows()).toHaveLength(1)
    const changed = await session.page.evaluate(() => window.desktop.patchPreferences({ macNativeTabs: true }))
    expect(changed.ok).toBe(true)
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    await expect.poll(() => session.app.windows().length).toBe(2)
    const parentPage = session.app.windows().find(page => page !== session.page)!
    await expect(parentPage.locator('.cm-content')).toBeVisible()
    const actual = await parentPage.evaluate(() => window.desktop.bootstrap())
    expect(actual.ok && actual.data.nativeTabsEnabled).toBe(true)
    await expect(parentPage.getByTestId('mac-titlebar')).toHaveCount(0)
    const nativeParent = await session.app.browserWindow(parentPage)
    expect(await nativeParent.evaluate(window => window.tabbingIdentifier)).toBe('com.qtypora.document')
    await session.app.evaluate(({ BrowserWindow }) => {
      const prototype = BrowserWindow.prototype
      const original = prototype.addTabbedWindow
      Reflect.set(globalThis, 'nativeTabAttachCount', 0)
      prototype.addTabbedWindow = function (child) {
        Reflect.set(globalThis, 'nativeTabAttachCount', Number(Reflect.get(globalThis, 'nativeTabAttachCount')) + 1)
        return original.call(this, child)
      }
    })
    expect((await parentPage.evaluate(() => window.desktop.patchPreferences({ macNativeTabs: false }))).ok).toBe(true)
    expect((await parentPage.evaluate(() => window.desktop.newNativeTab())).ok).toBe(true)
    await expect.poll(() => session.app.windows().length).toBe(3)
    const child = session.app.windows().find(page => page !== session.page && page !== parentPage)!
    await expect(child.locator('.cm-content')).toBeVisible()
    const childState = await child.evaluate(() => window.desktop.bootstrap())
    expect(childState.ok && childState.data.nativeTabsEnabled).toBe(true)
    expect(await child.locator('.cm-content').innerText()).not.toContain('保留原文')
    expect(await session.page.locator('.cm-content').innerText()).toBe(original)
    await nativeParent.evaluate(window => { window.emit('new-window-for-tab') })
    await expect.poll(() => session.app.windows().length).toBe(4)
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'nativeTabAttachCount'))).toBe(2)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('原生标签菜单随当前窗口类型切换，不影响独立文档', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生标签页')
  const session = await launchDesktop()
  try {
    await openFixture(session, 'tab-menu-original.md', '原文保留')
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ macNativeTabs: true }))).ok).toBe(true)
    const created = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const nativePage = await created
    await nativePage.locator('.cm-content').waitFor()
    const originalWindow = await session.app.browserWindow(session.page)
    const nativeWindow = await session.app.browserWindow(nativePage)
    const originalId = await originalWindow.evaluate(window => window.id)
    const nativeId = await nativeWindow.evaluate(window => window.id)
    const roleState = async (id: number) => session.app.evaluate(({ BrowserWindow, Menu }, targetId) => {
      const original = BrowserWindow.getFocusedWindow
      try {
        const window = BrowserWindow.fromId(targetId)
        if (!window) throw new Error('document window missing')
        BrowserWindow.getFocusedWindow = () => window
        window.emit('focus')
        const menu = Menu.getApplicationMenu()?.items.find(item => item.label.replace(/&/g, '').replace(/\([^)]*\)/g, '') === '窗口')
        return menu?.submenu?.items.filter(item => ['toggletabbar', 'selectprevioustab', 'selectnexttab', 'showalltabs', 'movetabtonewwindow'].includes(item.role?.toLowerCase() ?? '')).map(item => ({ role: item.role?.toLowerCase(), enabled: item.enabled }))
      } finally { BrowserWindow.getFocusedWindow = original }
    }, id)
    const roles = ['toggletabbar', 'selectprevioustab', 'selectnexttab', 'showalltabs', 'movetabtonewwindow']
    expect(await roleState(originalId)).toEqual([])
    expect(await roleState(nativeId)).toEqual(roles.map(role => ({ role, enabled: true })))
    expect(await session.page.locator('.cm-content').innerText()).toBe('原文保留')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('窗口关闭确认期间隐藏原生标签菜单，取消后恢复', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生标签页')
  const session = await launchDesktop()
  try {
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ macNativeTabs: true }))).ok).toBe(true)
    const created = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const page = await created
    await page.locator('.cm-content').click()
    await page.keyboard.insertText('保留未保存内容')
    const nativeWindow = await session.app.browserWindow(page)
    const id = await nativeWindow.evaluate(window => window.id)
    await session.app.evaluate(({ BrowserWindow, dialog }, windowId) => {
      const original = BrowserWindow.getFocusedWindow
      Reflect.set(globalThis, 'nativeTabsOriginalFocus', original)
      BrowserWindow.getFocusedWindow = () => BrowserWindow.fromId(windowId)
      dialog.showMessageBox = async () => new Promise(resolve => { Reflect.set(globalThis, 'nativeTabsResolveClose', resolve) })
      BrowserWindow.fromId(windowId)?.emit('focus')
    }, id)
    const count = () => session.app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()?.items.find(item => item.label.replace(/&/g, '').replace(/\([^)]*\)/g, '') === '窗口')
      return menu?.submenu?.items.filter(item => ['toggletabbar', 'selectprevioustab', 'selectnexttab', 'showalltabs', 'movetabtonewwindow'].includes(item.role?.toLowerCase() ?? '')).length
    })
    expect(await count()).toBe(5)
    await nativeWindow.evaluate(window => window.close())
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'nativeTabsResolveClose'))).toBe('function')
    expect(await count()).toBe(0)
    await session.app.evaluate(() => { const resolve = Reflect.get(globalThis, 'nativeTabsResolveClose') as (value: unknown) => void; resolve({ response: 2, checkboxChecked: false }) })
    await expect.poll(count).toBe(5)
    await expect(page.locator('.cm-content')).toContainText('保留未保存内容')
  } finally {
    await session.app.evaluate(({ BrowserWindow }) => {
      const original = Reflect.get(globalThis, 'nativeTabsOriginalFocus') as typeof BrowserWindow.getFocusedWindow | undefined
      if (original) BrowserWindow.getFocusedWindow = original
    }).catch(() => undefined)
    await stopDesktop(session)
  }
})
