import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 普通文本中的块标记保留文字，真实标题和列表保留格式', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'plain-blocks.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>---</p><p># title</p><p>- item</p><p>1. item</p><p>~~~</p><p>===</p><h2>Heading</h2><ul><li>Real item</li></ul>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('\\---\n\n\\# title\n\n\\- item\n\n1\\. item\n\n\\~~~\n\n\\===\n\n## Heading\n\n- Real item')
    const line = editor.locator('.cm-line').first()
    await expect(line).toHaveText('---')
    await line.click({ position: { x: 10, y: 8 } })
    const caret = await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.selection.main.head)
    expect(caret).toBeGreaterThanOrEqual(1)
    expect(caret).toBeLessThanOrEqual(4)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
