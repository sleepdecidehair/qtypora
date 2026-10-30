import { test, expect } from '@playwright/test'
import { clickNativeMenu, launchDesktop, stopDesktop } from './desktop-helpers'

test('macOS 应用菜单设置与编辑菜单入口保留且快捷键只注册一次', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 应用菜单')
  const session = await launchDesktop()
  try {
    const items = await session.app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()!
      return menu.items.flatMap(parent => (parent.submenu?.items ?? []).filter(item => item.label === '设置…' || item.label === '偏好设置…').map(item => ({ label: item.label, accelerator: item.accelerator })))
    })
    expect(items).toEqual([{ label: '设置…', accelerator: 'CmdOrCtrl+,' }, { label: '偏好设置…', accelerator: null }])
    await clickNativeMenu(session, '设置…')
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toBeVisible()
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toHaveCount(0)
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('Meta+,')
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toBeVisible()
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toHaveCount(0)
    await clickNativeMenu(session, '偏好设置…')
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toBeVisible()
  } finally { await stopDesktop(session) }
})
