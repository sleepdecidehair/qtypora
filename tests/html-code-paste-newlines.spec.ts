import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 代码粘贴保留内部空行、前后段落与撤销', async () => {
  const session = await launchDesktop()
  try {
    const initial = 'Existing\n\n'
    const file = await openFixture(session, 'html-code-newlines.md', initial)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>Before</p><pre><code>A\n\n\nB\uE000\n\n</code></pre><p>After</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe(initial + 'Before\n\n```\nA\n\n\nB\uE000\n\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(initial + 'Before\n\n```\nA\n\n\nB\uE000\n\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(initial)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(initial)
  } finally { await stopDesktop(session) }
})
