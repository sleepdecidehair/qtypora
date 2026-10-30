import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('行内代码中的 HTML 换行保留内容并可撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'inline-code-break.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>Before <code>A<br>B</code> After</p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before `A`\\\n`B` After')
    await expect(editor.locator('.cm-live-code')).toHaveCount(2)
    await expect(editor).toContainText('Before A')
    await expect(editor).toContainText('B After')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('行内代码连续换行、反引号及表格单元格可安全粘贴', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'inline-code-break-table.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><code>A`<br><br>B</code></p><table><tr><th>H</th></tr><tr><td><code>C<br>D</code></td></tr></table>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('`` A` ``\\\n\\\n`B`\n\n| H |\n| --- |\n| `C`<br>`D` |')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
