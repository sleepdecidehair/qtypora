import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 格式内部的同类定界符保留可见文字', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'format-markers.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><del>~~foo~~</del> <sup>^bar^</sup> <mark>==baz==</mark></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('~~\\~\\~foo\\~\\~~~ ^\\^bar\\^^ ==\\=\\=baz\\=\\===')
    await expect(editor).toContainText('~~foo~~ ^bar^ ==baz==')
    await expect(editor.locator('.cm-live-strike')).toHaveCount(1)
    await expect(editor.locator('.cm-live-superscript')).toHaveCount(1)
    await expect(editor.locator('.cm-live-highlight')).toHaveCount(1)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
