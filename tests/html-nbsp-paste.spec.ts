import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 不可断空格粘贴后保留、保存并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'nbsp-paste.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>&nbsp;one&nbsp;</p><p>X<strong>&nbsp;bold&nbsp;</strong>Y</p><pre>&nbsp; X \n\n\n&nbsp;</pre>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const expected = '\u00a0one\u00a0\n\nX\u00a0**bold**\u00a0Y\n\n```\n\u00a0 X \n\n\n\u00a0\n```'
    await expect.poll(content).toBe(expected)
    await expect(editor).not.toContainText('&nbsp;')
    await expect(editor.locator('.cm-live-strong')).toContainText('bold')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(expected)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
