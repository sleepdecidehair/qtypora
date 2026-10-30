import { test, expect } from '@playwright/test'
import { mkdir, readFile, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, stopDesktop } from './desktop-helpers'

test('页面设置取消不保存，确认合并其他窗口的新设置', async () => {
  const session = await launchDesktop()
  try {
    const before = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!before.ok) throw new Error(before.error.message)
    await clickNativeMenu(session, '页面设置…')
    const dialog = session.page.getByRole('dialog', { name: '页面设置' })
    await dialog.getByLabel('纸张尺寸').selectOption('Letter')
    await dialog.getByRole('button', { name: '取消' }).click()
    const afterCancel = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(afterCancel.ok && afterCancel.data.preferences.export.pageSize).toBe(before.data.preferences.export.pageSize)
    await clickNativeMenu(session, '页面设置…')
    await dialog.getByLabel('纸张尺寸').selectOption('Letter')
    const other = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await other
    await second.locator('.cm-content').waitFor()
    const changed = await second.evaluate(() => window.desktop.patchPreferences({ export: { marginMm: 23, header: 'other window' } }))
    expect(changed.ok).toBe(true)
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(dialog).toHaveCount(0)
    const after = await second.evaluate(() => window.desktop.bootstrap())
    expect(after.ok && after.data.preferences.export).toMatchObject({ pageSize: 'Letter', marginMm: 23, header: 'other window' })
    await session.app.evaluate(({ BrowserWindow }) => {
      const prototype = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents)
      Reflect.set(prototype, 'print', function (options: Electron.WebContentsPrintOptions, callback: (success: boolean, reason: string) => void) {
        Reflect.set(globalThis, 'pageSetupPrintOptions', options)
        callback(true, '')
      })
    })
    await clickNativeMenu(session, '打印…')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'pageSetupPrintOptions'))).toMatchObject({ pageSize: 'Letter', landscape: false, margins: { marginType: 'custom' } })
    const printOptions = await session.app.evaluate(() => Reflect.get(globalThis, 'pageSetupPrintOptions') as Electron.WebContentsPrintOptions)
    expect(printOptions.margins?.top).toBeCloseTo(23 * 96 / 25.4, 8)
  } finally { await stopDesktop(session) }
})

test('页面设置写入失败保留输入，修复后可重试', async () => {
  const session = await launchDesktop()
  try {
    const settings = path.join(session.userData, 'settings.json'), backup = path.join(session.userData, 'settings.page-backup')
    const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    await session.page.evaluate(() => window.desktop.patchPreferences({ zoomFactor: 1.1 }))
    await readFile(settings)
    await rename(settings, backup)
    await mkdir(settings)
    await clickNativeMenu(session, '页面设置…')
    const dialog = session.page.getByRole('dialog', { name: '页面设置' })
    await dialog.getByLabel('纸张尺寸').selectOption('Letter')
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(session.page.getByRole('alert')).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('纸张尺寸')).toHaveValue('Letter')
    await rmdir(settings)
    await rename(backup, settings)
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(dialog).toHaveCount(0)
    const after = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(after.ok && after.data.preferences.export.pageSize).toBe('Letter')
  } finally { await stopDesktop(session) }
})
