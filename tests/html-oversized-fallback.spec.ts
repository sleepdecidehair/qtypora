import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('超大 HTML 的纯文本回退不能绕过文档大小限制', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    await openFixture(session, 'oversized-fallback.md', 'Before')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const text = 'x'.repeat(16777216)
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob(['<p>' + text + '</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['ok'], { type: 'text/plain' }), 'text/html': new Blob(['<p>' + 'x'.repeat(16777216) + '</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(content).toBe('Beforeok')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
