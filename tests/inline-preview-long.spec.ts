import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, stopDesktop, openFixture, type DesktopSession } from './desktop-helpers'

let session: DesktopSession

test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => { if (session) await stopDesktop(session) })

test('长文档代码块保持原文，正文扩展在解析后正常显示', async () => {
  const prefix = 'text\n\n'.repeat(1800)
  const content = prefix + '```js\n:smile: ==highlight== $x$\nsecond\n```\n\n:smile: ==highlight=='
  const filePath = await openFixture(session, 'inline-preview-long.md', content)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await session.page.keyboard.press('ControlOrMeta+End')
  await expect(editor.locator('.cm-live-highlight').last()).toHaveText('highlight')
  await expect(editor).toContainText('😄')
  await expect(editor.locator('.cm-live-code-body').first()).toContainText(':smile: ==highlight== $x$')
  await session.page.keyboard.press('ControlOrMeta+Home')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(content)
  expect(session.errors).toEqual([])
})
