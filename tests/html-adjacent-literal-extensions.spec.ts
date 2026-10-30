import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

test('HTML 相邻普通扩展标记保留文字', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'adjacent-literal.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>$5$$6$ ^a^^b^</p><p><sup>real</sup> <del>removed</del></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('\\$5\\$\\$6\\$ \\^a\\^\\^b\\^\n\n^real^ ~~removed~~')
    await expect(session.page.getByRole('math')).toHaveCount(0)
    await expect(editor).toContainText('$5$$6$ ^a^^b^')
    await expect(editor.locator('.cm-live-superscript')).toHaveCount(1)
    await expect(editor.locator('.cm-live-strike')).toHaveCount(1)
    const output = path.join(session.root, 'adjacent-literal.html')
    await setSaveDialog(session, output)
    await clickNativeMenu(session, 'HTML…')
    await expect.poll(async () => { try { return await readFile(output, 'utf8') } catch { return '' } }).toContain('$5$$6$ ^a^^b^')
    const exported = await readFile(output, 'utf8')
    expect(exported).toContain('<sup>real</sup>')
    expect(exported).toContain('<s>removed</s>')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
