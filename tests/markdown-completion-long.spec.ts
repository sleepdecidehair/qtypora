import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, stopDesktop, openFixture, type DesktopSession } from './desktop-helpers'

let session: DesktopSession

test.beforeEach(async () => {
  session = await launchDesktop()
  await session.page.evaluate(async () => {
    const result = await window.desktop.bootstrap()
    if (!result.ok) throw new Error(result.error.message)
    const update = await window.desktop.updatePreferences({ ...result.data.preferences, sourceMode: true })
    if (!update.ok) throw new Error(update.error.message)
  })
  await session.page.reload()
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'source')
})

test.afterEach(async () => { if (session) await stopDesktop(session) })

test('长文档代码块输入不弹 Emoji 候选，正文补全仍可用', async () => {
  const prefix = 'text\n\n'.repeat(1800)
  const filePath = await openFixture(session, 'completion-long.md', prefix + '```js\n:sm')
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.type('i')
  await session.page.waitForTimeout(700)
  await expect(session.page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + '```js\n:smi')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + '```js\n:sm')
  const plainPath = await openFixture(session, 'completion-plain.md', prefix + 'Text :sm')
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.type('i')
  await expect(session.page.getByRole('option').filter({ hasText: ':smile:' }).first()).toBeVisible()
  await session.page.keyboard.press('Escape')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(plainPath, 'utf8')).toBe(prefix + 'Text :smi')
  expect(session.errors).toEqual([])
})
