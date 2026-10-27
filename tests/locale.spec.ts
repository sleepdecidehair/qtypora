import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('语言切换同步原生菜单及多窗口、重启后保留，源码和选区不改变', async () => {
  let session = await launchDesktop()
  try {
    const original = '# 标题\n\n**Hello 语言**\n'
    const filename = await openFixture(session, 'locale.md', original)
    await session.page.locator('.cm-content').click()
    await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view
      view.dispatch({ selection: { anchor: 2, head: 4 } })
      Reflect.set(window, 'qtyporaLocaleTestView', view)
    })
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByLabel('语言 / Language').selectOption('en-US')
    await expect(session.page.getByRole('dialog', { name: 'Preferences' })).toBeVisible()
    await expect(session.page.getByText('English is a preview.', { exact: false })).toBeVisible()
    await session.page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0)
    await expect(session.page.getByTestId('preferences-button')).toHaveAttribute('aria-label', 'Preferences')
    await expect.poll(() => session.page.evaluate(() => document.documentElement.lang)).toBe('en-US')
    await expect.poll(async () => { const state = await session.page.evaluate(() => window.desktop.bootstrap()); return state.ok ? state.data.preferences.locale : null }).toBe('en-US')
    await expect.poll(() => session.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => item.label).join('|') ?? '')).toContain('File')
    const selection = await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view
      return { sameView: Reflect.get(window, 'qtyporaLocaleTestView') === view, from: view.state.selection.main.from, to: view.state.selection.main.to, content: view.state.doc.toString() }
    })
    expect(selection).toEqual({ sameView: true, from: 2, to: 4, content: original })
    expect(await readFile(filename, 'utf8')).toBe(original)
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await opening
    await expect(second.getByTestId('preferences-button')).toHaveAttribute('aria-label', 'Preferences')
    await second.getByTestId('preferences-button').click()
    await second.getByLabel('Language / 语言').selectOption('zh-CN')
    await expect(session.page.getByTestId('preferences-button')).toHaveAttribute('aria-label', '偏好设置')
    await second.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(async () => { const state = await session.page.evaluate(() => window.desktop.bootstrap()); return state.ok ? state.data.preferences.locale : null }).toBe('zh-CN')
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByLabel('语言 / Language').selectOption('en-US')
    await session.page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect.poll(async () => { const state = await session.page.evaluate(() => window.desktop.bootstrap()); return state.ok ? state.data.preferences.locale : null }).toBe('en-US')
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    await expect(session.page.getByTestId('preferences-button')).toHaveAttribute('aria-label', 'Preferences')
    await expect.poll(() => session.page.evaluate(() => document.documentElement.lang)).toBe('en-US')
    expect(await readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
