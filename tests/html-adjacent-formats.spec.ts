import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('相邻格式粘贴保持显示和撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'adjacent-formats.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><strong>x</strong><strong>y</strong> <em>a</em><em>b</em></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('**xy** *ab*')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
  } finally { await stopDesktop(session) }
})

test('相邻嵌套格式合并，异类格式和不同链接保留', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'nested-adjacent.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><strong><em>m</em></strong><strong><em>n</em></strong> <strong>z</strong><em>w</em> <a href="https://a.example">x</a><a href="https://b.example">y</a></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('***mn*** **z***w* [x](https://a.example)[y](https://b.example)')
    await expect(editor).toContainText('mn zw xy')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
