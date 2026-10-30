import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

test('HTML 普通文字中的扩展标记不变成格式，真实格式保持', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'plain-extensions.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>Cost $5$ ==word== ~~old~~ :smile: ^top^ :unknown: $9</p><p><mark>marked</mark> <del>deleted</del> <sup>up</sup></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Cost \\$5\\$ \\=\\=word\\=\\= \\~\\~old\\~\\~ \\:smile\\: \\^top\\^ :unknown: $9\n\n==marked== ~~deleted~~ ^up^')
    await expect(session.page.getByRole('math')).toHaveCount(0)
    await expect(editor).toContainText('Cost $5$ ==word== ~~old~~ :smile: ^top^ :unknown: $9')
    await expect(editor.locator('.cm-live-highlight')).toHaveCount(1)
    await expect(editor.locator('.cm-live-strike')).toHaveCount(1)
    const output = path.join(session.root, 'literal-extensions.html')
    await setSaveDialog(session, output)
    await clickNativeMenu(session, 'HTML…')
    await expect.poll(async () => { try { return await readFile(output, 'utf8') } catch { return '' } }).toContain('~~old~~')
    const html = await readFile(output, 'utf8')
    expect(html).not.toContain('<sub>old</sub>')
    expect(html).toContain('<s>deleted</s>')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
  } finally { await stopDesktop(session) }
})
