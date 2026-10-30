import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 跨行高亮粘贴保留格式及撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'mark-multiline.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><mark>foo<br>bar</mark></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('==foo\\\nbar==')
    await expect(editor.locator('.cm-live-highlight')).toHaveCount(2)
    await expect(editor).toContainText('foo')
    await expect(editor).toContainText('bar')
    await expect(editor).not.toContainText('==')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 3 } }); view.focus()
    })
    await expect(editor).toContainText('==foo')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
