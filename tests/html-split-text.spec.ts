import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('跨无语义 span 的普通文本不触发数学和 Emoji', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'split-html.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>$<span>5</span>$ :<span>smile</span>: <strong>bold</strong> <em>italic</em></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('\\$5\\$ \\:smile\\: **bold** *italic*')
    await expect(session.page.getByRole('math')).toHaveCount(0)
    await expect(editor).toContainText('$5$ :smile: bold italic')
    await expect(editor.locator('.cm-live-strong')).toContainText('bold')
    await expect(editor.locator('.cm-live-emphasis')).toContainText('italic')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
