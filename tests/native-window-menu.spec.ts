import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('检查 macOS 原生窗口角色与自定义子菜单的兼容性', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生窗口菜单')
  const session = await launchDesktop()
  try {
    const secondWindow = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    await (await secondWindow).locator('.cm-content').waitFor()
    const result = await session.app.evaluate(({ Menu }) => {
      const original = Menu.getApplicationMenu()
      try {
        return ['window', 'windowMenu'].map(role => {
          const menu = Menu.buildFromTemplate([{ role: 'appMenu' }, { role: role as 'window' | 'windowMenu', label: '窗口', submenu: [{ label: '自定义文档切换' }, { role: 'minimize', label: '最小化' }] }])
          Menu.setApplicationMenu(menu)
          return { role, items: Menu.getApplicationMenu()?.items[1].submenu?.items.map(item => ({ label: item.label, role: item.role })) }
        })
      } finally { Menu.setApplicationMenu(original) }
    })
    expect(result).toEqual([
      { role: 'window', items: [{ label: '自定义文档切换', role: null }, { label: '最小化', role: 'minimize' }] },
      { role: 'windowMenu', items: [{ label: '自定义文档切换', role: null }, { label: '最小化', role: 'minimize' }] },
    ])
  } finally { await stopDesktop(session) }
})

test('macOS 原生窗口菜单暴露缩放和前置全部窗口，同时保留文档切换', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生窗口菜单')
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'native-window-menu.md', '原文保持不变')
    const roles = await session.app.evaluate(({ Menu }) => {
      const windowMenu = Menu.getApplicationMenu()?.items.find(item => item.label.replace(/&/g, '').replace(/\([^)]*\)/g, '') === '窗口')
      return windowMenu?.submenu?.items.map(item => ({ label: item.label, role: item.role, enabled: item.enabled, accelerator: item.accelerator }))
    })
    expect(roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '最小化', role: 'minimize', enabled: true }),
      expect.objectContaining({ label: '缩放', role: 'zoom', enabled: true }),
      expect.objectContaining({ label: '前置全部窗口', role: 'front', enabled: true }),
      expect.objectContaining({ label: '切换文档', accelerator: 'Cmd+`', enabled: true }),
    ]))
    expect(await session.page.locator('.cm-content').innerText()).toBe('原文保持不变')
    expect(await readFile(filename, 'utf8')).toBe('原文保持不变')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('全部最小化仅处理应用文档窗口，不触及辅助窗口或内容', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 原生窗口菜单')
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'minimize-all.md', '原始内容')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('未保存')
    const next = session.app.waitForEvent('window')
    const result = await session.page.evaluate(() => window.desktop.newWindow())
    expect(result.ok).toBe(true)
    const second = await next
    await second.locator('.cm-content').waitFor()
    const firstWindow = await session.app.browserWindow(session.page), secondWindow = await session.app.browserWindow(second)
    const ids = [await firstWindow.evaluate(window => window.id), await secondWindow.evaluate(window => window.id)]
    const helperId = await session.app.evaluate(({ BrowserWindow }) => {
      const helper = new BrowserWindow({ show: false })
      const prototype = BrowserWindow.prototype
      Reflect.set(globalThis, 'minimizeAllOriginals', { visible: prototype.isVisible, minimized: prototype.isMinimized, minimizable: prototype.isMinimizable, minimize: prototype.minimize })
      Reflect.set(globalThis, 'minimizeAllCalls', [])
      prototype.isVisible = () => true
      prototype.isMinimized = () => false
      prototype.isMinimizable = () => true
      prototype.minimize = function () { (Reflect.get(globalThis, 'minimizeAllCalls') as number[]).push(this.id) }
      return helper.id
    })
    await clickNativeMenu(session, '全部最小化')
    const calls = await session.app.evaluate(() => Reflect.get(globalThis, 'minimizeAllCalls') as number[])
    expect(calls.sort()).toEqual(ids.sort())
    expect(calls).not.toContain(helperId)
    expect(await session.page.locator('.cm-content').innerText()).toBe('原始内容未保存')
    expect(await readFile(filename, 'utf8')).toBe('原始内容')
  } finally {
    await session.app.evaluate(({ BrowserWindow }) => {
      const original = Reflect.get(globalThis, 'minimizeAllOriginals') as { visible: typeof BrowserWindow.prototype.isVisible; minimized: typeof BrowserWindow.prototype.isMinimized; minimizable: typeof BrowserWindow.prototype.isMinimizable; minimize: typeof BrowserWindow.prototype.minimize } | undefined
      if (!original) return
      Object.assign(BrowserWindow.prototype, { isVisible: original.visible, isMinimized: original.minimized, isMinimizable: original.minimizable, minimize: original.minimize })
    }).catch(() => undefined)
    await stopDesktop(session)
  }
})
