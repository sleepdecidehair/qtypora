import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('跨格式标签的普通标记保持文字和格式', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'semantic-boundary.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>$<strong>5</strong>$ ^<strong>up</strong>^</p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('\\$**5**\\$ \\^**up**\\^')
    await expect(session.page.getByRole('math')).toHaveCount(0)
    await expect(editor).toContainText('$5$ ^up^')
    await expect(editor.locator('.cm-live-strong')).toHaveCount(2)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
