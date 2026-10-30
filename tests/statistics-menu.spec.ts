import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('隐藏状态栏时统计菜单仍可查看选区统计且不改变偏好', async () => {
  const session = await launchDesktop()
  try {
    const original = '# Title\n\nHello world\n'
    const file = await openFixture(session, 'statistics-menu.md', original)
    await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 9, head: 14 } })
      view.focus()
    })
    await clickNativeMenu(session, '显示 / 隐藏状态栏')
    await expect(session.page.locator('.statusbar')).toBeHidden()
    await clickNativeMenu(session, '字数统计')
    await expect(session.page.getByLabel('文章统计详情')).toBeVisible()
    await expect(session.page.getByLabel('文章统计详情').getByRole('columnheader', { name: '选中' })).toBeVisible()
    await expect(session.page.getByLabel('文章统计详情').getByRole('row').filter({ has: session.page.getByRole('rowheader', { name: '字数', exact: true }) }).getByRole('cell').first()).toHaveText('1')
    await session.page.keyboard.press('Escape')
    await expect(session.page.getByLabel('文章统计详情')).toHaveCount(0)
    await expect(session.page.locator('.cm-content')).toBeFocused()
    const selection = await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return { from: view.state.selection.main.from, to: view.state.selection.main.to }
    })
    expect(selection).toEqual({ from: 9, to: 14 })
    await expect(session.page.locator('.statusbar')).toBeHidden()
    await expect.poll(async () => {
      const state = await session.page.evaluate(() => window.desktop.bootstrap())
      return state.ok && state.data.preferences.showStatusBar
    }).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(original)
    await clickNativeMenu(session, '显示 / 隐藏状态栏')
    await expect(session.page.locator('.statusbar')).toBeVisible()
    await clickNativeMenu(session, '字数统计')
    await expect(session.page.getByLabel('文章统计详情')).toBeVisible()
  } finally { await stopDesktop(session) }
})
