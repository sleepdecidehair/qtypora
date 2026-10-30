import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('大 HTML 代码片段中的大量反引号可安全粘贴并撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'large-code-paste.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const text = '`x'.repeat(150000)
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>' + text + '</code></pre>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('```\n' + '`x'.repeat(150000) + '\n```')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
