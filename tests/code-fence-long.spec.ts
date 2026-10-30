import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, stopDesktop, openFixture, type DesktopSession } from './desktop-helpers'

let session: DesktopSession

test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => { if (session) await stopDesktop(session) })

test('长文档预览中用键盘创建围栏并可撤销，源码模式保持普通换行', async () => {
  const prefix = 'text\n\n'.repeat(1800)
  const filePath = await openFixture(session, 'fence-long.md', prefix)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.type('```')
  await session.page.keyboard.press('Enter')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + '```\n\n```')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + '```')
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'source')
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.press('Enter')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + '```\n')
  expect(session.errors).toEqual([])
})
