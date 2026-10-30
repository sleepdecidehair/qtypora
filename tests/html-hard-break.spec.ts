import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 换行粘贴保留单个与连续断行', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'hard-break.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>one<br>two<br><br><br>three</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n\none\\\ntwo\\\n\\\n\\\nthree')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n\n')
  } finally { await stopDesktop(session) }
})

test('表格和代码块的 HTML 换行按上下文保存', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'context-breaks.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<table><tr><th>H</th></tr><tr><td>one<br><br>two</td></tr></table><pre>alpha<br><br>beta</pre><p>After</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n\n| H |\n| --- |\n| one<br><br>two |\n\n```\nalpha\n\nbeta\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('启用软换行后 HTML 硬换行仍以硬换行保存', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'soft-breaks.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const patched = await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { softBreaks: true } }))
    expect(patched.ok).toBe(true)
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>one<br>two</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before\n\none\\\ntwo')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
