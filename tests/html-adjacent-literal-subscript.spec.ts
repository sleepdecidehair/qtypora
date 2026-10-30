import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

test('相邻纯文本波浪号预览与导出一致，真实下标保留', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'literal-subscript.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>x~a~~b~ <sub>real</sub></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('x\\~a\\~\\~b\\~ ~real~')
    await expect(editor).toContainText('x~a~~b~ real')
    const output = path.join(session.root, 'literal-subscript.html')
    await setSaveDialog(session, output)
    await clickNativeMenu(session, 'HTML…')
    await expect.poll(async () => { try { return await readFile(output, 'utf8') } catch { return '' } }).toContain('x~a~~b~')
    const html = await readFile(output, 'utf8')
    expect(html).not.toContain('<sub>a</sub>')
    expect(html).not.toContain('<sub>b</sub>')
    expect(html).toContain('<sub>real</sub>')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
